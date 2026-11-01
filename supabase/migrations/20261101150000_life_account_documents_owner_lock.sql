-- Owner-level ordering for life_account_document_put (follows 20261101090000).
-- Before this, puts of different keys of one owner held different advisory
-- locks: a put could take a seq, commit after a later seq became visible, and a
-- change cursor read between them skipped it. Idempotent; run as administrator.
begin;

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
  -- One lock per owner (not per key): a later put of any key waits until this
  -- one commits, so per owner the seq order equals commit order and a change
  -- cursor can never move past a lower seq that becomes visible later.
  perform pg_advisory_xact_lock(hashtextextended('life_account_document_owner:' || v_owner::text,0));
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

revoke all on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
