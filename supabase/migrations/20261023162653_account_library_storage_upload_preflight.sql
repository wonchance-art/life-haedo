-- Storage's canUpload permission probe runs before the object byte size exists.
-- Official v1.84.23 (d2836fe9e8157f4fc558af0071a7671d373ff3ef):
-- uploader.ts:84-101,142-155 passes mimetype/contentLength/contentEncoding, no size;
-- database/pg.ts:1561-1572 still sets owner_id from the verified request owner.
-- testPermission rolls back its probe; the Storage bucket enforces actual bytes.
-- Keep owner/path/immutability and validate known final sizes. The manifest RPC
-- continues to require every committed object's exact actual metadata.size.
-- Do not rewrite the already installed base migration.
begin;
drop policy if exists life_library_originals_insert_guard on storage.objects;
create policy life_library_originals_insert_guard on storage.objects as restrictive for insert to public
 with check(bucket_id<>'life-library-originals' or (owner_id=(select auth.uid())::text and
 name~('^'||(select auth.uid())::text||'/[a-f0-9]{64}/(000[0-9]|001[0-5])-[a-f0-9]{64}$') and
 (not coalesce(metadata ? 'size',false) or
 ((metadata->>'size')~'^[0-9]{1,9}$' and (metadata->>'size')::bigint between 1 and 8388608))));
drop policy if exists life_library_originals_owner_insert on storage.objects;
create policy life_library_originals_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id='life-library-originals' and owner_id=(select auth.uid())::text and
 name~('^'||(select auth.uid())::text||'/[a-f0-9]{64}/(000[0-9]|001[0-5])-[a-f0-9]{64}$') and
 (not coalesce(metadata ? 'size',false) or
 ((metadata->>'size')~'^[0-9]{1,9}$' and (metadata->>'size')::bigint between 1 and 8388608)));
commit;
