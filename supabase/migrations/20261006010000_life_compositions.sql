-- Private, explicitly connected workbench snapshots. No original or Auth changes.
-- Requires the existing life_workspaces migration. Run as the project administrator.
-- Missing version/source references are retained; never substitute a newer original.
begin;

-- Match Workbench.validate's UTF-16 length and JavaScript trim rules. PostgreSQL
-- JSONB already rejects NUL and unpaired UTF-16 surrogate escapes.
create or replace function public.life_composition_text_valid(p_value jsonb, p_limit integer, p_nonempty boolean default false)
returns boolean language sql immutable set search_path = pg_catalog
as $function$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and char_length(p_value #>> '{}') + regexp_count(p_value #>> '{}', U&'[\+010000-\+10FFFF]') <= p_limit
    and (not p_nonempty or (p_value #>> '{}') !~ U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'), false)
$function$;
revoke all on function public.life_composition_text_valid(jsonb,integer,boolean) from public, anon, authenticated;

create or replace function public.life_composition_ids_valid(p_value jsonb, p_limit integer)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_value) > p_limit then return false; end if;
  return not exists(select 1 from jsonb_array_elements(p_value) x
    where jsonb_typeof(x) is distinct from 'string' or (x #>> '{}') !~ '^[A-Za-z0-9_-]{1,128}$')
    and (select count(*) = count(distinct x) from jsonb_array_elements(p_value) x);
end;
$function$;
revoke all on function public.life_composition_ids_valid(jsonb,integer) from public, anon, authenticated;

-- Count compact JSON, rather than JSONB display spaces, for the transport limit.
create or replace function public.life_composition_json_bytes(p_value jsonb)
returns bigint language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_result bigint; v_count bigint;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(sum(octet_length(convert_to(to_jsonb(key)::text,'UTF8'))+1+public.life_composition_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_each(p_value);
      return 2+v_result+greatest(v_count-1,0);
    when 'array' then
      select coalesce(sum(public.life_composition_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_array_elements(p_value);
      return 2+v_result+greatest(v_count-1,0);
    else return octet_length(convert_to(p_value::text,'UTF8'));
  end case;
end;
$function$;
revoke all on function public.life_composition_json_bytes(jsonb) from public, anon, authenticated;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_group jsonb; v_entry jsonb; v_part jsonb; v_pair jsonb; v_page jsonb; v_reflection jsonb;
  v_ids text[] := array[]::text[]; v_versions text[]; v_pairs jsonb[] := array[]::jsonb[];
  v_revision numeric;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then return false; end if;
  -- Bound work before nested validation. The final compact limit is independent.
  if octet_length(convert_to(p_data::text,'UTF8')) > 4194304 then return false; end if;
  if not (p_data ?& array['format','workspaceId','revision','groups','page','reflection'])
    or p_data - array['format','workspaceId','revision','groups','page','reflection','discovery'] <> '{}'::jsonb
    or p_data -> 'format' is distinct from '"life-workbench-v1"'::jsonb
    or jsonb_typeof(p_data -> 'workspaceId') is distinct from 'string'
    or (p_data ->> 'workspaceId') !~ '^[A-Za-z0-9_-]{1,128}$'
    or jsonb_typeof(p_data -> 'revision') is distinct from 'number'
    or jsonb_typeof(p_data -> 'groups') is distinct from 'array'
    or jsonb_typeof(p_data -> 'page') is distinct from 'object'
    or jsonb_typeof(p_data -> 'reflection') is distinct from 'object' then return false; end if;
  v_revision := (p_data ->> 'revision')::numeric;
  if v_revision < 0 or v_revision > 9007199254740991 or trunc(v_revision) <> v_revision then return false; end if;
  if jsonb_array_length(p_data -> 'groups') > 100 then return false; end if;
  for v_group in select value from jsonb_array_elements(p_data -> 'groups') loop
    if jsonb_typeof(v_group) is distinct from 'object' then return false; end if;
    if not (v_group ?& array['id','title','versionIds']) or v_group - array['id','title','versionIds'] <> '{}'::jsonb
      or jsonb_typeof(v_group -> 'id') is distinct from 'string' or (v_group ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
      or not public.life_composition_text_valid(v_group -> 'title',500,true)
      or not public.life_composition_ids_valid(v_group -> 'versionIds',1000) then return false; end if;
    if (v_group ->> 'id') = any(v_ids) then return false; end if;
    v_ids := array_append(v_ids,v_group ->> 'id');
  end loop;
  v_page := p_data -> 'page';
  if not (v_page ?& array['title','intro','showIntro','showRecent','entries'])
    or v_page - array['title','intro','showIntro','showRecent','entries'] <> '{}'::jsonb
    or not public.life_composition_text_valid(v_page -> 'title',500,true)
    or not public.life_composition_text_valid(v_page -> 'intro',20000)
    or jsonb_typeof(v_page -> 'showIntro') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'showRecent') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'entries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v_page -> 'entries') > 200 then return false; end if;
  for v_entry in select value from jsonb_array_elements(v_page -> 'entries') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then return false; end if;
    if not (v_entry ?& array['id','title','parts','note','pinned','enabled','showBody','showNote'])
      or v_entry - array['id','title','parts','note','pinned','enabled','showBody','showNote'] <> '{}'::jsonb
      or jsonb_typeof(v_entry -> 'id') is distinct from 'string' or (v_entry ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
      or not public.life_composition_text_valid(v_entry -> 'title',500,true)
      or not public.life_composition_text_valid(v_entry -> 'note',20000)
      or jsonb_typeof(v_entry -> 'pinned') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'enabled') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'showBody') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'showNote') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'parts') is distinct from 'array' then return false; end if;
    if (v_entry ->> 'id') = any(v_ids) then return false; end if;
    v_ids := array_append(v_ids,v_entry ->> 'id');
    if jsonb_array_length(v_entry -> 'parts') > 100 then return false; end if;
    v_versions := array[]::text[];
    for v_part in select value from jsonb_array_elements(v_entry -> 'parts') loop
      if jsonb_typeof(v_part) is distinct from 'object' then return false; end if;
      if not (v_part ?& array['versionId','enabled']) or v_part - array['versionId','enabled'] <> '{}'::jsonb
        or jsonb_typeof(v_part -> 'versionId') is distinct from 'string' or (v_part ->> 'versionId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or jsonb_typeof(v_part -> 'enabled') is distinct from 'boolean' then return false; end if;
      if (v_part ->> 'versionId') = any(v_versions) then return false; end if;
      v_versions := array_append(v_versions,v_part ->> 'versionId');
    end loop;
  end loop;
  v_reflection := p_data -> 'reflection';
  if not (v_reflection ?& array['versionIds','note']) or v_reflection - array['versionIds','note'] <> '{}'::jsonb
    or not public.life_composition_ids_valid(v_reflection -> 'versionIds',1000)
    or not public.life_composition_text_valid(v_reflection -> 'note',20000) then return false; end if;
  if p_data ? 'discovery' then
    if jsonb_typeof(p_data -> 'discovery') is distinct from 'object' then return false; end if;
    if not (p_data -> 'discovery' ? 'excludedPairs') or (p_data -> 'discovery') - 'excludedPairs' <> '{}'::jsonb
      or jsonb_typeof(p_data #> '{discovery,excludedPairs}') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_data #> '{discovery,excludedPairs}') > 1000 then return false; end if;
    for v_pair in select value from jsonb_array_elements(p_data #> '{discovery,excludedPairs}') loop
      if jsonb_typeof(v_pair) is distinct from 'object' then return false; end if;
      if not (v_pair ?& array['seedSourceId','candidateSourceId']) or v_pair - array['seedSourceId','candidateSourceId'] <> '{}'::jsonb
        or jsonb_typeof(v_pair -> 'seedSourceId') is distinct from 'string'
        or jsonb_typeof(v_pair -> 'candidateSourceId') is distinct from 'string'
        or (v_pair ->> 'seedSourceId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or (v_pair ->> 'candidateSourceId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or v_pair -> 'seedSourceId' = v_pair -> 'candidateSourceId' then return false; end if;
      if v_pair = any(v_pairs) then return false; end if;
      v_pairs := array_append(v_pairs,v_pair);
    end loop;
  end if;
  return public.life_composition_json_bytes(p_data) <= 2097152;
end;
$function$;
revoke all on function public.life_composition_valid(jsonb) from public, anon, authenticated;

create table if not exists public.life_compositions (
  owner_id uuid not null,
  workspace_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  source_revision bigint not null check (source_revision between 1 and 9007199254740991),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id,workspace_id),
  foreign key (owner_id,workspace_id) references public.life_workspaces(owner_id,id) on delete cascade,
  constraint life_composition_state check (
    public.life_composition_valid(data) and (data ->> 'workspaceId') is not distinct from workspace_id::text
  )
);
create table if not exists public.life_composition_receipts (
  owner_id uuid not null,
  workspace_id uuid not null,
  operation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash)=32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id,workspace_id,operation_id),
  foreign key (owner_id,workspace_id) references public.life_compositions(owner_id,workspace_id) on delete cascade
);
alter table public.life_compositions enable row level security;
alter table public.life_composition_receipts enable row level security;
revoke all on table public.life_compositions,public.life_composition_receipts from public,anon,authenticated;

create or replace function public.life_composition_get(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_row public.life_compositions%rowtype;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_composition_auth_required'; end if;
  if p_workspace_id is null then raise exception using errcode='22023', message='life_composition_invalid_request'; end if;
  select c.* into v_row from public.life_compositions c join public.life_workspaces w
    on w.owner_id=c.owner_id and w.id=c.workspace_id
    where c.owner_id=v_owner and c.workspace_id=p_workspace_id;
  if not found then return null; end if;
  return jsonb_build_object('workspace_id',v_row.workspace_id,'revision',v_row.revision,
    'source_revision',v_row.source_revision,'data',v_row.data,'updated_at',v_row.updated_at);
end;
$function$;

create or replace function public.life_composition_put(
  p_workspace_id uuid, p_expected_revision bigint, p_operation_id uuid, p_source_revision bigint, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_hash bytea; v_receipt public.life_composition_receipts%rowtype;
  v_source_revision bigint; v_previous_source_revision bigint; v_revision bigint; v_result jsonb;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_composition_auth_required'; end if;
  if p_workspace_id is null or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991 or p_source_revision is null
    or p_source_revision < 1 or p_source_revision > 9007199254740991 then
    raise exception using errcode='22023', message='life_composition_invalid_request';
  end if;
  if public.life_composition_valid(p_data) is not true
    or (p_data ->> 'workspaceId') is distinct from p_workspace_id::text then
    raise exception using errcode='22023', message='life_composition_invalid_snapshot';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_expected_revision,p_source_revision,p_data)::text,'UTF8'));
  -- Exactly the existing original-sync lock: no race with an initial original
  -- upload or a source revision update. Never acquire the locks in reverse order.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_workspace_id::text,0));
  select * into v_receipt from public.life_composition_receipts
    where owner_id=v_owner and workspace_id=p_workspace_id and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode='22023', message='life_composition_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;
  select revision into v_source_revision from public.life_workspaces
    where owner_id=v_owner and id=p_workspace_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_source_revision < p_source_revision then
    raise exception using errcode='22023', message='life_composition_source_not_ready';
  end if;
  select revision,source_revision into v_revision,v_previous_source_revision from public.life_compositions
    where owner_id=v_owner and workspace_id=p_workspace_id for update;
  if not found then
    if p_expected_revision <> 0 then return jsonb_build_object('status','missing'); end if;
    v_revision := 1;
    insert into public.life_compositions(owner_id,workspace_id,revision,source_revision,data,updated_at)
      values(v_owner,p_workspace_id,v_revision,p_source_revision,p_data,clock_timestamp());
  else
    if v_revision <> p_expected_revision then return jsonb_build_object('status','conflict','revision',v_revision); end if;
    -- A successful newer composition must never lower its dependency floor.
    -- Historical successful receipts were already returned above unchanged.
    if p_source_revision < v_previous_source_revision then
      raise exception using errcode='22023', message='life_composition_source_not_ready';
    end if;
    if v_revision >= 9007199254740991 then
      raise exception using errcode='22003', message='life_composition_revision_limit';
    end if;
    v_revision := v_revision+1;
    update public.life_compositions set revision=v_revision,source_revision=p_source_revision,data=p_data,updated_at=clock_timestamp()
      where owner_id=v_owner and workspace_id=p_workspace_id;
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision);
  insert into public.life_composition_receipts(owner_id,workspace_id,operation_id,request_hash,result)
    values(v_owner,p_workspace_id,p_operation_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function public.life_composition_get(uuid) from public,anon,authenticated;
revoke all on function public.life_composition_put(uuid,bigint,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.life_composition_get(uuid) to authenticated;
grant execute on function public.life_composition_put(uuid,bigint,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
