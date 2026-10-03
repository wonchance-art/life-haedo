-- Life tools R3: private snapshots, compare-and-swap and durable retry receipts.
-- Run as the project database administrator in Supabase SQL Editor.
-- Only the new life_* objects are affected; charts and Auth settings are unchanged.
-- Re-running this migration preserves existing snapshots and receipts.
begin;

create table if not exists public.life_workspaces (
  owner_id uuid not null,
  id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  revision bigint not null check (revision between 1 and 9007199254740991),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint life_workspace_identity check (
    data ->> 'workspaceId' = id::text and data -> 'schemaVersion' = '1'::jsonb
  )
);

create table if not exists public.life_sync_receipts (
  owner_id uuid not null,
  workspace_id uuid not null,
  operation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, workspace_id, operation_id),
  foreign key (owner_id, workspace_id)
    references public.life_workspaces (owner_id, id) on delete cascade
);

alter table public.life_workspaces enable row level security;
alter table public.life_sync_receipts enable row level security;
revoke all on table public.life_workspaces from public, anon, authenticated;
revoke all on table public.life_sync_receipts from public, anon, authenticated;
grant select on table public.life_workspaces to authenticated;
drop policy if exists life_workspaces_owner_read on public.life_workspaces;
create policy life_workspaces_owner_read on public.life_workspaces
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.life_sync_put(
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_data jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid();
  v_hash bytea;
  v_receipt public.life_sync_receipts%rowtype;
  v_revision bigint;
  v_result jsonb;
  v_title text;
begin
  -- Never accept a caller-supplied owner. EXECUTE grants are an additional boundary.
  if v_owner is null then
    raise exception using errcode = '42501', message = 'life_auth_required';
  end if;
  if p_workspace_id is null or p_operation_id is null
     or p_expected_revision is null
     or p_expected_revision < 0 or p_expected_revision > 9007199254740991 then
    raise exception using errcode = '22023', message = 'life_invalid_request';
  end if;
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object'
     or (p_data -> 'schemaVersion') is distinct from '1'::jsonb
     or (p_data ->> 'workspaceId') is distinct from p_workspace_id::text
     or jsonb_typeof(p_data -> 'title') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'life_invalid_snapshot';
  end if;
  if octet_length(convert_to(p_data::text, 'UTF8')) > 16777216 then
    raise exception using errcode = '22001', message = 'life_snapshot_too_large';
  end if;
  v_title := p_data ->> 'title';
  if char_length(v_title) < 1 or char_length(v_title) > 500 then
    raise exception using errcode = '22023', message = 'life_invalid_title';
  end if;
  -- JSONB canonicalizes object key order; include the CAS base in retry identity.
  v_hash := sha256(convert_to(p_expected_revision::text || ':' || p_data::text, 'UTF8'));

  -- Row locks alone do not serialize a row which does not yet exist.
  -- This transaction lock is scoped to this owner/workspace. Hash collisions only wait.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_workspace_id::text, 0));
  select * into v_receipt from public.life_sync_receipts
    where owner_id = v_owner and workspace_id = p_workspace_id and operation_id = p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'life_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;

  select revision into v_revision from public.life_workspaces
    where owner_id = v_owner and id = p_workspace_id for update;
  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object('status', 'missing');
    end if;
    v_revision := 1;
    insert into public.life_workspaces (owner_id, id, title, revision, data, updated_at)
      values (v_owner, p_workspace_id, v_title, v_revision, p_data, clock_timestamp());
  else
    if v_revision <> p_expected_revision then
      return jsonb_build_object('status', 'conflict', 'revision', v_revision);
    end if;
    if v_revision >= 9007199254740991 then
      raise exception using errcode = '22003', message = 'life_revision_limit';
    end if;
    v_revision := v_revision + 1;
    update public.life_workspaces
      set title = v_title, revision = v_revision, data = p_data, updated_at = clock_timestamp()
      where owner_id = v_owner and id = p_workspace_id;
  end if;
  v_result := jsonb_build_object('status', 'stored', 'revision', v_revision);
  insert into public.life_sync_receipts (owner_id, workspace_id, operation_id, request_hash, result)
    values (v_owner, p_workspace_id, p_operation_id, v_hash, v_result);
  return v_result;
end;
$function$;

revoke all on function public.life_sync_put(uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.life_sync_put(uuid, bigint, uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
