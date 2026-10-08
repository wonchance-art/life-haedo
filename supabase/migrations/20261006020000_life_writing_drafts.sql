-- Explicitly selected private writing drafts; originals, composition and Auth unchanged.
-- Requires life_workspaces and 20261006010000_life_compositions.sql helpers first.
-- Run as the project administrator. Reinstalling preserves drafts and retry receipts.
begin;

create or replace function public.life_writing_draft_valid(p_data jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_number numeric; v_field text; v_result jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then return false; end if;
  if octet_length(convert_to(p_data::text,'UTF8')) > 4194304 then return false; end if;
  if not (p_data ?& array['kind','format','stageId','workspaceId','revision','state','sourceId',
      'baseSourceRevision','baseSourceVersionId','title','text','createdAt','updatedAt'])
    or p_data - array['kind','format','stageId','workspaceId','revision','state','sourceId',
      'baseSourceRevision','baseSourceVersionId','title','text','createdAt','updatedAt','appliedResult','baseChanged'] <> '{}'::jsonb
    or p_data -> 'kind' is distinct from '"writing"'::jsonb
    or p_data -> 'format' is distinct from '"life-writing-draft-v1"'::jsonb
    or p_data ->> 'state' not in ('draft','applied')
    or jsonb_typeof(p_data -> 'state') is distinct from 'string'
    or jsonb_typeof(p_data -> 'revision') is distinct from 'number'
    or not public.life_composition_text_valid(p_data -> 'title',500)
    or not public.life_composition_text_valid(p_data -> 'text',1048576)
    or octet_length(convert_to(p_data ->> 'text','UTF8')) > 1048576 then return false; end if;
  foreach v_field in array array['stageId','workspaceId'] loop
    if jsonb_typeof(p_data -> v_field) is distinct from 'string'
      or (p_data ->> v_field) !~ '^[A-Za-z0-9_-]{1,128}$' then return false; end if;
  end loop;
  v_number := (p_data ->> 'revision')::numeric;
  if v_number < 0 or v_number > 9007199254740991 or trunc(v_number) <> v_number then return false; end if;
  foreach v_field in array array['createdAt','updatedAt'] loop
    if jsonb_typeof(p_data -> v_field) is distinct from 'string'
      or (p_data ->> v_field) !~ '^\d{4}-\d{2}-\d{2}T' then return false; end if;
    -- App timestamps are ISO strings. Reject invalid date fields instead of
    -- silently accepting arbitrary strings from a caller bypassing the SDK.
    perform (p_data ->> v_field)::timestamptz;
  end loop;
  if p_data -> 'sourceId' = 'null'::jsonb then
    if p_data -> 'baseSourceRevision' is distinct from 'null'::jsonb
      or p_data -> 'baseSourceVersionId' is distinct from 'null'::jsonb then return false; end if;
  else
    if jsonb_typeof(p_data -> 'sourceId') is distinct from 'string'
      or (p_data ->> 'sourceId') !~ '^[A-Za-z0-9_-]{1,128}$'
      or jsonb_typeof(p_data -> 'baseSourceVersionId') is distinct from 'string'
      or (p_data ->> 'baseSourceVersionId') !~ '^[A-Za-z0-9_-]{1,128}$'
      or jsonb_typeof(p_data -> 'baseSourceRevision') is distinct from 'number' then return false; end if;
    v_number := (p_data ->> 'baseSourceRevision')::numeric;
    if v_number < 1 or v_number > 9007199254740991 or trunc(v_number) <> v_number then return false; end if;
  end if;
  if p_data ? 'baseChanged' and (p_data -> 'baseChanged' is distinct from 'true'::jsonb
    or p_data -> 'sourceId' = 'null'::jsonb) then return false; end if;
  if p_data ->> 'state' = 'applied' then
    -- Local legacy validation allows applied without a result. Sending a closure
    -- requires the exact saved source/version so another device cannot reopen it.
    v_result := p_data -> 'appliedResult';
    if jsonb_typeof(v_result) is distinct from 'object' then return false; end if;
    if not (v_result ?& array['sourceId','sourceVersionId']) or v_result - array['sourceId','sourceVersionId'] <> '{}'::jsonb then return false; end if;
    foreach v_field in array array['sourceId','sourceVersionId'] loop
      if jsonb_typeof(v_result -> v_field) is distinct from 'string'
        or (v_result ->> v_field) !~ '^[A-Za-z0-9_-]{1,128}$' then return false; end if;
    end loop;
  elsif p_data ? 'appliedResult' then return false;
  end if;
  return public.life_composition_json_bytes(p_data) <= 2097152;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$function$;
revoke all on function public.life_writing_draft_valid(jsonb) from public,anon,authenticated;

create table if not exists public.life_writing_drafts (
  owner_id uuid not null,
  workspace_id uuid not null,
  draft_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  source_revision bigint not null check (source_revision between 1 and 9007199254740991),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id,workspace_id,draft_id),
  foreign key (owner_id,workspace_id) references public.life_workspaces(owner_id,id) on delete cascade,
  constraint life_writing_draft_state check (
    public.life_writing_draft_valid(data)
    and (data ->> 'workspaceId') is not distinct from workspace_id::text
    and (data ->> 'stageId') is not distinct from draft_id::text
  )
);
create table if not exists public.life_writing_draft_receipts (
  owner_id uuid not null,
  workspace_id uuid not null,
  draft_id uuid not null,
  operation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash)=32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id,workspace_id,draft_id,operation_id),
  foreign key (owner_id,workspace_id,draft_id) references public.life_writing_drafts(owner_id,workspace_id,draft_id) on delete cascade
);
alter table public.life_writing_drafts enable row level security;
alter table public.life_writing_draft_receipts enable row level security;
revoke all on table public.life_writing_drafts,public.life_writing_draft_receipts from public,anon,authenticated;

create or replace function public.life_writing_draft_get(p_workspace_id uuid,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_row public.life_writing_drafts%rowtype;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_writing_draft_auth_required'; end if;
  if p_workspace_id is null or p_draft_id is null then raise exception using errcode='22023', message='life_writing_draft_invalid_request'; end if;
  select d.* into v_row from public.life_writing_drafts d
    where d.owner_id=v_owner and d.workspace_id=p_workspace_id and d.draft_id=p_draft_id;
  if not found then return null; end if;
  return jsonb_build_object('workspace_id',v_row.workspace_id,'draft_id',v_row.draft_id,'revision',v_row.revision,
    'source_revision',v_row.source_revision,'data',v_row.data,'updated_at',v_row.updated_at);
end;
$function$;

create or replace function public.life_writing_draft_list(p_workspace_id uuid,p_after_draft_id uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_result jsonb;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_writing_draft_auth_required'; end if;
  if p_workspace_id is null then raise exception using errcode='22023', message='life_writing_draft_invalid_request'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('draft_id',d.draft_id,'title',d.data ->> 'title',
    'state',d.data ->> 'state','revision',d.revision,'updated_at',d.updated_at) order by d.draft_id),'[]'::jsonb)
    into v_result from (select draft_id,data,revision,updated_at from public.life_writing_drafts
      where owner_id=v_owner and workspace_id=p_workspace_id and (p_after_draft_id is null or draft_id>p_after_draft_id)
      order by draft_id limit 100) d;
  return v_result;
end;
$function$;

create or replace function public.life_writing_draft_put(
  p_workspace_id uuid,p_draft_id uuid,p_expected_revision bigint,p_operation_id uuid,p_source_revision bigint,p_data jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_hash bytea; v_receipt public.life_writing_draft_receipts%rowtype;
  v_source_revision bigint; v_original jsonb; v_previous_source_revision bigint;
  v_revision bigint; v_state text; v_result jsonb;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_writing_draft_auth_required'; end if;
  if p_workspace_id is null or p_draft_id is null or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991 or p_source_revision is null
    or p_source_revision < 1 or p_source_revision > 9007199254740991 then
    raise exception using errcode='22023', message='life_writing_draft_invalid_request';
  end if;
  if public.life_writing_draft_valid(p_data) is not true
    or (p_data ->> 'workspaceId') is distinct from p_workspace_id::text
    or (p_data ->> 'stageId') is distinct from p_draft_id::text then
    raise exception using errcode='22023', message='life_writing_draft_invalid_snapshot';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_expected_revision,p_source_revision,p_data)::text,'UTF8'));
  -- Same owner/workspace lock as original + composition sync, including first
  -- writes. Never hold a draft lock and then acquire the original lock.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_workspace_id::text,0));
  select * into v_receipt from public.life_writing_draft_receipts
    where owner_id=v_owner and workspace_id=p_workspace_id and draft_id=p_draft_id and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode='22023', message='life_writing_draft_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;
  select revision,data into v_source_revision,v_original from public.life_workspaces
    where owner_id=v_owner and id=p_workspace_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  select revision,source_revision,data ->> 'state' into v_revision,v_previous_source_revision,v_state
    from public.life_writing_drafts where owner_id=v_owner and workspace_id=p_workspace_id and draft_id=p_draft_id for update;
  if found then
    if v_revision <> p_expected_revision or v_state='applied' then
      return jsonb_build_object('status','conflict','revision',v_revision);
    end if;
    if p_source_revision < v_previous_source_revision then
      raise exception using errcode='22023', message='life_writing_draft_source_not_ready';
    end if;
    if v_revision >= 9007199254740991 then
      raise exception using errcode='22003', message='life_writing_draft_revision_limit';
    end if;
  elsif p_expected_revision <> 0 then return jsonb_build_object('status','missing');
  end if;
  if v_source_revision < p_source_revision then
    raise exception using errcode='22023', message='life_writing_draft_source_not_ready';
  end if;
  if p_data ->> 'state'='applied' then
    -- A revision floor alone does not establish that the saved original exists.
    -- Require both the source row and this exact version belonging to that source.
    -- Missing or a different source's version never closes the shared draft.
    if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_original -> 'sources')='array'
        then v_original -> 'sources' else '[]'::jsonb end) s
        where s ->> 'id'=p_data #>> '{appliedResult,sourceId}')
      or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_original -> 'sourceVersions')='array'
        then v_original -> 'sourceVersions' else '[]'::jsonb end) sv
        where sv ->> 'id'=p_data #>> '{appliedResult,sourceVersionId}'
          and sv ->> 'sourceId'=p_data #>> '{appliedResult,sourceId}') then
      raise exception using errcode='22023', message='life_writing_draft_source_not_ready';
    end if;
  end if;
  if v_revision is null then
    v_revision := 1;
    insert into public.life_writing_drafts(owner_id,workspace_id,draft_id,revision,source_revision,data,updated_at)
      values(v_owner,p_workspace_id,p_draft_id,v_revision,p_source_revision,p_data,clock_timestamp());
  else
    v_revision := v_revision+1;
    update public.life_writing_drafts set revision=v_revision,source_revision=p_source_revision,data=p_data,updated_at=clock_timestamp()
      where owner_id=v_owner and workspace_id=p_workspace_id and draft_id=p_draft_id;
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision);
  insert into public.life_writing_draft_receipts(owner_id,workspace_id,draft_id,operation_id,request_hash,result)
    values(v_owner,p_workspace_id,p_draft_id,p_operation_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function public.life_writing_draft_get(uuid,uuid) from public,anon,authenticated;
revoke all on function public.life_writing_draft_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.life_writing_draft_put(uuid,uuid,bigint,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.life_writing_draft_get(uuid,uuid) to authenticated;
grant execute on function public.life_writing_draft_list(uuid,uuid) to authenticated;
grant execute on function public.life_writing_draft_put(uuid,uuid,bigint,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
