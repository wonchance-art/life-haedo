-- Small per-account documents that every signed-in device of the same owner
-- replicates automatically (settings, reading position, plans, drafts, ...).
-- Sync is not publication: nothing here is readable by anyone but the owner.
-- Run as the project administrator. Idempotent; requires the Auth schema.
begin;

-- Count compact JSON (JSON.stringify bytes), not JSONB display spacing, so the
-- client and server agree on the 2 MiB limit.
create or replace function public.life_account_document_json_bytes(p_value jsonb)
returns bigint language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_result bigint; v_count bigint;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(sum(octet_length(convert_to(to_jsonb(key)::text,'UTF8'))+1+public.life_account_document_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_each(p_value);
      return 2+v_result+greatest(v_count-1,0);
    when 'array' then
      select coalesce(sum(public.life_account_document_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_array_elements(p_value);
      return 2+v_result+greatest(v_count-1,0);
    else return octet_length(convert_to(p_value::text,'UTF8'));
  end case;
end;
$function$;
revoke all on function public.life_account_document_json_bytes(jsonb) from public, anon, authenticated;

create table if not exists public.life_account_documents (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_key text not null check (char_length(doc_key) between 1 and 512 and doc_key !~ '[[:cntrl:]]'),
  revision bigint not null check (revision between 1 and 9007199254740991),
  data jsonb,
  deleted boolean not null default false,
  client_updated_at timestamptz,
  seq bigint generated always as identity,
  updated_at timestamptz not null default now(),
  primary key (owner_id, doc_key),
  constraint life_account_document_state check ((deleted and data is null) or (not deleted and data is not null))
);
create index if not exists life_account_documents_owner_seq on public.life_account_documents(owner_id, seq);

create table if not exists public.life_account_document_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  doc_key text not null,
  request_hash bytea not null check (octet_length(request_hash)=32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

alter table public.life_account_documents enable row level security;
alter table public.life_account_document_receipts enable row level security;
revoke all on table public.life_account_documents, public.life_account_document_receipts from public, anon, authenticated;
grant select on table public.life_account_documents to authenticated;
drop policy if exists life_account_documents_owner_select on public.life_account_documents;
create policy life_account_documents_owner_select on public.life_account_documents
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.life_account_document_put(
  p_doc_key text, p_expected_revision bigint, p_operation_id uuid, p_data jsonb,
  p_deleted boolean default false, p_client_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_hash bytea; v_receipt public.life_account_document_receipts%rowtype;
  v_row public.life_account_documents%rowtype; v_revision bigint; v_seq bigint; v_result jsonb;
  v_deleted boolean := coalesce(p_deleted, false);
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_account_document_auth_required'; end if;
  if p_doc_key is null or char_length(p_doc_key) not between 1 and 512 or p_doc_key ~ '[[:cntrl:]]'
    or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991
    or (v_deleted and p_data is not null) or (not v_deleted and p_data is null) then
    raise exception using errcode='22023', message='life_account_document_invalid_request';
  end if;
  -- A cheap bound first; the exact compact size is checked after it.
  if p_data is not null and (octet_length(convert_to(p_data::text,'UTF8')) > 4194304
    or public.life_account_document_json_bytes(p_data) > 2097152) then
    raise exception using errcode='22001', message='life_account_document_too_large';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_doc_key,p_expected_revision,p_data,v_deleted,p_client_updated_at)::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('life_account_document:' || v_owner::text || ':' || p_doc_key,0));
  select * into v_receipt from public.life_account_document_receipts
    where owner_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode='22023', message='life_account_document_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;
  select * into v_row from public.life_account_documents where owner_id=v_owner and doc_key=p_doc_key for update;
  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object('status','conflict','revision',0,'seq',null,'current',null);
    end if;
    v_revision := 1;
    insert into public.life_account_documents(owner_id,doc_key,revision,data,deleted,client_updated_at,updated_at)
      values(v_owner,p_doc_key,v_revision,p_data,v_deleted,p_client_updated_at,clock_timestamp())
      returning seq into v_seq;
  else
    if v_row.revision <> p_expected_revision then
      return jsonb_build_object('status','conflict','revision',v_row.revision,'seq',v_row.seq,
        'current',jsonb_build_object('revision',v_row.revision,'data',v_row.data,'deleted',v_row.deleted,
          'client_updated_at',v_row.client_updated_at));
    end if;
    if v_row.revision >= 9007199254740991 then
      raise exception using errcode='22003', message='life_account_document_revision_limit';
    end if;
    v_revision := v_row.revision+1;
    -- DEFAULT on an identity column takes the next sequence value, so every
    -- write moves the document behind the readers' change cursors.
    update public.life_account_documents set revision=v_revision,data=p_data,deleted=v_deleted,
      client_updated_at=p_client_updated_at,seq=default,updated_at=clock_timestamp()
      where owner_id=v_owner and doc_key=p_doc_key returning seq into v_seq;
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision,'seq',v_seq);
  insert into public.life_account_document_receipts(owner_id,operation_id,doc_key,request_hash,result)
    values(v_owner,p_operation_id,p_doc_key,v_hash,v_result);
  return v_result;
end;
$function$;

-- Changes after a cursor, oldest first. A page stops early near 8 MiB so a
-- device catching up on many large drafts never asks for one huge response.
create or replace function public.life_account_document_changes(p_after_seq bigint, p_limit integer default 200)
returns table(doc_key text, revision bigint, data jsonb, deleted boolean, client_updated_at timestamptz, seq bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_row record; v_bytes bigint := 0; v_count integer := 0;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_account_document_auth_required'; end if;
  if p_after_seq is null or p_after_seq < 0 or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode='22023', message='life_account_document_invalid_request';
  end if;
  for v_row in select d.doc_key,d.revision,d.data,d.deleted,d.client_updated_at,d.seq,d.updated_at
    from public.life_account_documents d where d.owner_id=v_owner and d.seq>p_after_seq order by d.seq limit p_limit loop
    v_bytes := v_bytes + coalesce(octet_length(convert_to(v_row.data::text,'UTF8')),0);
    exit when v_count > 0 and v_bytes > 8388608;
    doc_key := v_row.doc_key; revision := v_row.revision; data := v_row.data; deleted := v_row.deleted;
    client_updated_at := v_row.client_updated_at; seq := v_row.seq; updated_at := v_row.updated_at;
    v_count := v_count + 1;
    return next;
  end loop;
end;
$function$;

revoke all on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.life_account_document_changes(bigint,integer) from public, anon, authenticated;
grant execute on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) to authenticated;
grant execute on function public.life_account_document_changes(bigint,integer) to authenticated;
notify pgrst,'reload schema';
commit;
