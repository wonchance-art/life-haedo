-- Explicit public copies of a selected local page. No private workspace reads.
-- Run once (or repeat safely) in the project's Supabase SQL Editor.
-- Existing charts, life_workspaces and Auth settings are not changed.
begin;

-- Match JavaScript UTF-16 limits and the exact whitespace/control-character rules.
create or replace function public.life_public_page_text_valid(p_value jsonb, p_limit integer, p_nonempty boolean default false)
returns boolean language sql immutable set search_path = pg_catalog
as $function$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and char_length(p_value #>> '{}') + regexp_count(p_value #>> '{}', U&'[\+010000-\+10FFFF]') <= p_limit
    and (p_value #>> '{}') !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F]'
    and (not p_nonempty or (p_value #>> '{}') !~ U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'),false)
$function$;
revoke all on function public.life_public_page_text_valid(jsonb,integer,boolean) from public, anon, authenticated;

-- JSONB's display format inserts spaces. Count compact JSON bytes instead, so
-- the server's 1 MiB boundary agrees with JSON.stringify on this string schema.
create or replace function public.life_public_page_json_bytes(p_value jsonb)
returns bigint language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_result bigint; v_count bigint;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(sum(octet_length(convert_to(to_jsonb(key)::text,'UTF8'))+1+public.life_public_page_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_each(p_value);
      return 2+v_result+greatest(v_count-1,0);
    when 'array' then
      select coalesce(sum(public.life_public_page_json_bytes(value)),0),count(*) into v_result,v_count from jsonb_array_elements(p_value);
      return 2+v_result+greatest(v_count-1,0);
    else return octet_length(convert_to(p_value::text,'UTF8'));
  end case;
end;
$function$;
revoke all on function public.life_public_page_json_bytes(jsonb) from public, anon, authenticated;

-- Validate the public wire format, including every nested key. This is not a
-- license/consent decision: the owner must review what they choose to publish.
create or replace function public.life_public_page_valid(p_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_entry jsonb; v_part jsonb; v_omission jsonb; v_value jsonb;
  v_total integer := 0; v_url text; v_authority text; v_host text; v_port text; v_address inet;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then return false; end if;
  if octet_length(convert_to(p_snapshot::text, 'UTF8')) > 2097152 then return false; end if;
  if not (p_snapshot ?& array['format','title','intro','entries'])
    or p_snapshot - array['format','title','intro','entries'] <> '{}'::jsonb
    or p_snapshot -> 'format' is distinct from '"life-share-v1"'::jsonb
    or not public.life_public_page_text_valid(p_snapshot -> 'title',500,true)
    or (p_snapshot -> 'intro' <> 'null'::jsonb and not public.life_public_page_text_valid(p_snapshot -> 'intro',50000))
    or jsonb_typeof(p_snapshot -> 'entries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_snapshot -> 'entries') > 100 then return false; end if;
  for v_entry in select value from jsonb_array_elements(p_snapshot -> 'entries') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then return false; end if;
    if not (v_entry ?& array['title','pinned','note','parts'])
      or v_entry - array['title','pinned','note','parts'] <> '{}'::jsonb
      or not public.life_public_page_text_valid(v_entry -> 'title',500,true)
      or jsonb_typeof(v_entry -> 'pinned') is distinct from 'boolean'
      or (v_entry -> 'note' <> 'null'::jsonb and not public.life_public_page_text_valid(v_entry -> 'note',50000))
      or jsonb_typeof(v_entry -> 'parts') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_entry -> 'parts') > 100 then return false; end if;
    v_total := v_total + jsonb_array_length(v_entry -> 'parts');
    if v_total > 200 then return false; end if;
    for v_part in select value from jsonb_array_elements(v_entry -> 'parts') loop
      if jsonb_typeof(v_part) is distinct from 'object' then return false; end if;
      if not (v_part ?& array['title','origin','url','author','originalCreatedAt','coverage','text','textKind'])
        or v_part - array['title','origin','url','author','originalCreatedAt','coverage','text','textKind'] <> '{}'::jsonb
        or not public.life_public_page_text_valid(v_part -> 'title',500,true)
        or jsonb_typeof(v_part -> 'origin') is distinct from 'string'
        or v_part ->> 'origin' not in ('apple_notes','obsidian','naver_blog','instagram','other')
        or jsonb_typeof(v_part -> 'textKind') is distinct from 'string'
        or v_part ->> 'textKind' not in ('none','body','excerpt') then return false; end if;
      if v_part ->> 'textKind' = 'none' then
        if v_part -> 'text' is distinct from 'null'::jsonb then return false; end if;
      elsif not public.life_public_page_text_valid(v_part -> 'text',50000,true) then return false;
      end if;
      if v_part -> 'originalCreatedAt' <> 'null'::jsonb and not public.life_public_page_text_valid(v_part -> 'originalCreatedAt',200) then return false; end if;
      if v_part -> 'url' <> 'null'::jsonb then
        if jsonb_typeof(v_part -> 'url') is distinct from 'string' then return false; end if;
        v_url := v_part ->> 'url';
        if not public.life_public_page_text_valid(v_part -> 'url',2048,true) or v_url !~* '^https?://[^/?#]+'
          or v_url ~ U&'[\0001-\0020\007F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
          or position(chr(92) in v_url) > 0 then return false; end if;
        v_authority := substring(v_url from '(?i)^https?://([^/?#]+)');
        if position('@' in v_authority) > 0 then return false; end if;
        v_port := null;
        if left(v_authority,1) = '[' then
          if v_authority !~ '^\[[0-9a-fA-F:.]+\](:[0-9]{0,5})?$' then return false; end if;
          v_host := substring(v_authority from '^\[([^]]+)\]');
          begin v_address := v_host::inet; exception when invalid_text_representation then return false; end;
          if family(v_address) <> 6 then return false; end if;
          v_port := substring(v_authority from '\]:([0-9]*)$');
        else
          if v_authority !~ '^[^:]+(:[0-9]{0,5})?$' then return false; end if;
          v_host := split_part(v_authority,':',1);
          if v_host ~ '[%<>^|\[\]]' then return false; end if;
          if v_host ~ '(^|\.)[0-9]+\.?$' then
            begin v_address := rtrim(v_host,'.')::inet; exception when invalid_text_representation then return false; end;
            if family(v_address) <> 4 then return false; end if;
          end if;
          v_port := substring(v_authority from ':([0-9]*)$');
        end if;
        if nullif(v_port,'') is not null and v_port::integer > 65535 then return false; end if;
      end if;
      v_value := v_part -> 'author';
      if jsonb_typeof(v_value) is distinct from 'object' then return false; end if;
      if not (v_value ?& array['label','relation']) or v_value - array['label','relation'] <> '{}'::jsonb
        or not public.life_public_page_text_valid(v_value -> 'label',200)
        or jsonb_typeof(v_value -> 'relation') is distinct from 'string' or v_value ->> 'relation' not in ('self','other','unknown') then return false; end if;
      v_value := v_part -> 'coverage';
      if jsonb_typeof(v_value) is distinct from 'object' then return false; end if;
      if not (v_value ?& array['status','omissions']) or v_value - array['status','omissions'] <> '{}'::jsonb
        or jsonb_typeof(v_value -> 'status') is distinct from 'string' or v_value ->> 'status' not in ('full_text','partial','link_only','unknown')
        or jsonb_typeof(v_value -> 'omissions') is distinct from 'array' then return false; end if;
      if jsonb_array_length(v_value -> 'omissions') > 20 then return false; end if;
      for v_omission in select value from jsonb_array_elements(v_value -> 'omissions') loop
        if not public.life_public_page_text_valid(v_omission,300) then return false; end if;
      end loop;
      if v_value ->> 'status' = 'link_only' and v_part ->> 'textKind' <> 'none' then return false; end if;
    end loop;
  end loop;
  return public.life_public_page_json_bytes(p_snapshot) <= 1048576;
end;
$function$;
revoke all on function public.life_public_page_valid(jsonb) from public, anon, authenticated;

create table if not exists public.life_public_pages (
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  public_id uuid unique,
  revision bigint not null check (revision between 1 and 9007199254740991),
  published boolean not null,
  snapshot jsonb,
  last_operation_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, workspace_id),
  constraint life_public_page_state check (
    (published and public_id is not null and snapshot is not null and public.life_public_page_valid(snapshot))
    or (not published and snapshot is null)
  )
);
create table if not exists public.life_public_page_receipts (
  owner_id uuid not null,
  workspace_id uuid not null,
  operation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, workspace_id, operation_id),
  foreign key (owner_id, workspace_id) references public.life_public_pages(owner_id, workspace_id) on delete cascade
);
alter table public.life_public_pages enable row level security;
alter table public.life_public_page_receipts enable row level security;
revoke all on table public.life_public_pages, public.life_public_page_receipts from public, anon, authenticated;

create or replace function public.life_public_page_get(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_page public.life_public_pages%rowtype;
begin
  perform set_config('response.headers', '[{"Cache-Control":"no-store, max-age=0"}]', true);
  if v_owner is null then raise exception using errcode = '42501', message = 'life_share_auth_required'; end if;
  if p_workspace_id is null then raise exception using errcode = '22023', message = 'life_share_invalid_request'; end if;
  select * into v_page from public.life_public_pages where owner_id = v_owner and workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('status','missing','revision',0,'publicId',null,'updatedAt',null,'lastOperationId',null); end if;
  return jsonb_build_object('status',case when v_page.published then 'published' else 'revoked' end,
    'revision',v_page.revision,'publicId',case when v_page.published then v_page.public_id else null end,'updatedAt',v_page.updated_at,'lastOperationId',v_page.last_operation_id);
end;
$function$;

create or replace function public.life_public_page_put(
  p_workspace_id uuid, p_expected_revision bigint, p_operation_id uuid, p_action text, p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_page public.life_public_pages%rowtype;
  v_receipt public.life_public_page_receipts%rowtype; v_hash bytea; v_result jsonb;
  v_exists boolean; v_public_id uuid; v_revision bigint; v_updated_at timestamptz;
begin
  perform set_config('response.headers', '[{"Cache-Control":"no-store, max-age=0"}]', true);
  if v_owner is null then raise exception using errcode = '42501', message = 'life_share_auth_required'; end if;
  if p_workspace_id is null or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991
    or p_action is null or p_action not in ('publish','revoke') then
    raise exception using errcode = '22023', message = 'life_share_invalid_request';
  end if;
  if p_action = 'publish' then
    if p_snapshot is null or not public.life_public_page_valid(p_snapshot) then
      raise exception using errcode = '22023', message = 'life_share_invalid_snapshot';
    end if;
  elsif p_snapshot is not null and p_snapshot <> 'null'::jsonb then
    raise exception using errcode = '22023', message = 'life_share_invalid_request';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_action,p_expected_revision,p_snapshot)::text,'UTF8'));
  -- A transaction lock covers initial insertion as well as update/revoke races.
  perform pg_advisory_xact_lock(hashtextextended('life-public-page:' || v_owner::text || ':' || p_workspace_id::text,0));
  select * into v_receipt from public.life_public_page_receipts
    where owner_id=v_owner and workspace_id=p_workspace_id and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'life_share_operation_mismatch';
    end if;
    -- Historical success only: a publish retry after revoke cannot republish.
    -- The caller must GET current owner metadata after a successful/replayed PUT.
    return v_receipt.result;
  end if;
  select * into v_page from public.life_public_pages where owner_id=v_owner and workspace_id=p_workspace_id for update;
  v_exists := found;
  if not v_exists then
    if p_expected_revision <> 0 then return jsonb_build_object('status','missing'); end if;
    v_revision := 1;
  else
    if v_page.revision <> p_expected_revision then return jsonb_build_object('status','conflict','revision',v_page.revision); end if;
    if v_page.revision >= 9007199254740991 then raise exception using errcode='22003', message='life_share_revision_limit'; end if;
    v_revision := v_page.revision+1;
  end if;
  v_public_id := v_page.public_id;
  if p_action = 'publish' and (not v_exists or not v_page.published) then
    -- Revocation is permanent for the old URL. Republish receives a fresh URL.
    v_public_id := gen_random_uuid();
  end if;
  v_updated_at := clock_timestamp();
  if v_exists then
    update public.life_public_pages set public_id=v_public_id, revision=v_revision, published=(p_action='publish'),
      snapshot=case when p_action='publish' then p_snapshot else null end,
      last_operation_id=p_operation_id, updated_at=v_updated_at
      where owner_id=v_owner and workspace_id=p_workspace_id;
  else
    insert into public.life_public_pages(owner_id,workspace_id,public_id,revision,published,snapshot,last_operation_id,updated_at)
      values(v_owner,p_workspace_id,v_public_id,v_revision,p_action='publish',case when p_action='publish' then p_snapshot else null end,p_operation_id,v_updated_at);
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision,'publicId',case when p_action='publish' then v_public_id else null end,
    'published',p_action='publish','updatedAt',v_updated_at,'action',p_action);
  insert into public.life_public_page_receipts(owner_id,workspace_id,operation_id,request_hash,result)
    values(v_owner,p_workspace_id,p_operation_id,v_hash,v_result);
  return v_result;
end;
$function$;

create or replace function public.life_public_page_read(p_public_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_page public.life_public_pages%rowtype;
begin
  perform set_config('response.headers', '[{"Cache-Control":"no-store, max-age=0"}]', true);
  select * into v_page from public.life_public_pages where public_id=p_public_id and published;
  if not found then return jsonb_build_object('status','missing'); end if;
  return jsonb_build_object('status','published','publicId',v_page.public_id,'revision',v_page.revision,
    'updatedAt',v_page.updated_at,'snapshot',v_page.snapshot);
end;
$function$;

-- Account-level recovery does not require the original local workspace/backup.
-- This owner-only list exposes metadata, never the published body or private data.
create or replace function public.life_public_page_list(p_after uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_item record; v_pages jsonb := '[]'::jsonb;
  v_count integer := 0; v_cursor uuid;
begin
  perform set_config('response.headers', '[{"Cache-Control":"no-store, max-age=0"}]', true);
  if v_owner is null then raise exception using errcode='42501', message='life_share_auth_required'; end if;
  for v_item in select workspace_id, snapshot ->> 'title' as title, revision, public_id, updated_at, last_operation_id
    from public.life_public_pages where owner_id=v_owner and published and (p_after is null or workspace_id>p_after)
    order by workspace_id limit 51 loop
    v_count := v_count+1;
    if v_count>50 then return jsonb_build_object('pages',v_pages,'nextCursor',v_cursor); end if;
    v_pages := v_pages || jsonb_build_array(jsonb_build_object('workspaceId',v_item.workspace_id,'title',v_item.title,
      'revision',v_item.revision,'publicId',v_item.public_id,'updatedAt',v_item.updated_at,'lastOperationId',v_item.last_operation_id));
    v_cursor := v_item.workspace_id;
  end loop;
  return jsonb_build_object('pages',v_pages,'nextCursor',null);
end;
$function$;
revoke all on function public.life_public_page_get(uuid) from public, anon, authenticated;
revoke all on function public.life_public_page_put(uuid,bigint,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.life_public_page_read(uuid) from public, anon, authenticated;
revoke all on function public.life_public_page_list(uuid) from public, anon, authenticated;
grant execute on function public.life_public_page_get(uuid), public.life_public_page_put(uuid,bigint,uuid,text,jsonb), public.life_public_page_list(uuid) to authenticated;
grant execute on function public.life_public_page_read(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
