-- Storage objects retains the deprecated owner UUID column. Qualify function
-- identity through v_owner so objects.owner cannot shadow its PL/pgSQL variable.
-- Only the variable name changes; manifest/owner/path/size/tombstone/CAS behavior
-- and the already installed base and preflight migrations remain unchanged.
begin;
create or replace function public.life_library_original_put(p_id uuid,p_operation_id uuid,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid:=auth.uid();r public.life_library_originals%rowtype;receipt public.life_library_original_receipts%rowtype;digest bytea;c jsonb;result jsonb;
begin
 if v_owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 if p_id is null or p_operation_id is null then raise exception using errcode='22023',message='life_library_invalid_request';end if;
 perform pg_advisory_xact_lock(hashtextextended('life-library-original:'||v_owner::text||':'||p_id::text,0));
 if exists(select 1 from public.life_library_original_tombstones where owner_id=v_owner and id=p_id)
 or exists(select 1 from public.life_library_originals where owner_id=v_owner and id=p_id and deleted_at is not null) then return jsonb_build_object('status','missing');end if;
 if octet_length(convert_to(p_manifest::text,'UTF8'))>4194304 or public.life_composition_json_bytes(p_manifest)>2097152 then raise exception using errcode='22001',message='life_library_original_too_large';end if;
 if not public.life_library_original_valid(p_manifest,v_owner,p_id) then raise exception using errcode='22023',message='life_library_invalid_original';end if;
 digest:=sha256(convert_to(p_manifest::text,'UTF8'));
 select * into receipt from public.life_library_original_receipts where owner_id=v_owner and id=p_id and operation_id=p_operation_id;
 if found then if receipt.request_hash is distinct from digest then raise exception using errcode='22023',message='life_operation_mismatch';end if;return receipt.result;end if;
 select * into r from public.life_library_originals where owner_id=v_owner and id=p_id for update;
 if found and r.manifest is distinct from p_manifest then raise exception using errcode='22023',message='life_library_original_immutable';end if;
 -- storage metadata.size is written by the Storage service from the received object.
 -- JSON numbers/strings are both used by supported Storage versions; reject missing,
 -- negative, noninteger or wrong sizes instead of trusting caller-supplied metadata.
 for c in select * from jsonb_array_elements(p_manifest->'chunks') loop
  if not exists(select 1 from storage.objects o where o.bucket_id='life-library-originals' and o.name=c->>'path'
    and o.owner_id=v_owner::text and (o.metadata->>'size')~'^[0-9]{1,9}$' and (o.metadata->>'size')::bigint=(c->>'bytes')::bigint) then
   raise exception using errcode='22023',message='life_library_original_chunk_missing';
  end if;
 end loop;
 insert into public.life_library_originals(owner_id,id,manifest) values(v_owner,p_id,p_manifest) on conflict(owner_id,id) do nothing;
 result:=jsonb_build_object('status','stored','revision',1);
 insert into public.life_library_original_receipts values(v_owner,p_id,p_operation_id,digest,result);return result;
end $$;
commit;
