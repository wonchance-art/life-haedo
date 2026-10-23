-- Read-only structural installation check. Never reads personal snapshots or objects.
-- Runtime CAS/ownership/size/hash tests run against a synthetic local database.
begin read only;
do $check$
declare n text;signature text;fn record;bucket record;
begin
 foreach n in array array['life_library_defaults','life_library_metadata','life_library_meta_receipts','life_library_originals','life_library_original_receipts','life_library_original_tombstones'] loop
  if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname=n and c.relrowsecurity) then raise exception 'life_library_rls_missing: %',n;end if;
  if has_table_privilege('anon',format('public.%I',n),'SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated',format('public.%I',n),'INSERT,UPDATE,DELETE') then raise exception 'life_library_direct_grant: %',n;end if;
 end loop;
 foreach signature in array array[
  'public.life_library_capabilities()', 'public.life_library_open(uuid)', 'public.life_library_catalog(uuid,integer)',
  'public.life_library_meta_get(uuid)', 'public.life_library_meta_put(uuid,bigint,uuid,bigint,jsonb)',
  'public.life_library_originals_list(uuid,integer)', 'public.life_library_original_get(uuid)', 'public.life_library_original_put(uuid,uuid,jsonb)'
 ] loop
  select p.prosecdef,p.proconfig into fn from pg_proc p where p.oid=signature::regprocedure;
  if not fn.prosecdef or fn.proconfig is distinct from array['search_path=pg_catalog'] then raise exception 'life_library_rpc_security: %',signature;end if;
  if has_function_privilege('anon',signature,'EXECUTE') or not has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'life_library_rpc_grant: %',signature;end if;
 end loop;
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and left(p.proname,13)='life_library_'
 and p.proname not in ('life_library_capabilities','life_library_open','life_library_catalog','life_library_meta_get','life_library_meta_put','life_library_originals_list','life_library_original_get','life_library_original_put') loop
  if has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE') then raise exception 'life_library_helper_grant: %',fn.proname;end if;
 end loop;
 select public,file_size_limit into bucket from storage.buckets where id='life-library-originals';
 if not found or bucket.public or bucket.file_size_limit<>8388608 then raise exception 'life_library_bucket_configuration';end if;
 if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='storage' and c.relname='objects' and c.relrowsecurity) then raise exception 'life_library_storage_rls';end if;
 foreach n in array array['life_library_originals_read_guard','life_library_originals_insert_guard','life_library_originals_update_guard','life_library_originals_delete_guard'] loop
  if not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname=n and not polpermissive) then raise exception 'life_library_storage_restrictive_guard: %',n;end if;
 end loop;
 if not exists(select 1 from pg_policy where polrelid='public.life_library_metadata'::regclass and polname='life_library_metadata_owner_read') then raise exception 'life_library_metadata_owner_policy';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.life_library_originals'::regclass and tgname='life_library_original_tombstone' and not tgisinternal) then raise exception 'life_library_tombstone_trigger';end if;
end;
$check$;
rollback;
