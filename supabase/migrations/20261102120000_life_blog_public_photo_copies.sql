-- Public photos are metadata-free copies (2026-11-02 owner decision).
-- Before: HEIC/HEIF published their JPEG view, but JPEG/PNG/WebP published the
-- private original, so EXIF/GPS/XMP could become public.
-- After:
--  * a JPEG/PNG/WebP photo is published only through a separately registered
--    public copy (canvas re-encoding, JPEG or PNG) of that photo; HEIC/HEIF
--    keep publishing their JPEG view. An original is never public media.
--  * publication media carry a copy marker; the media resolver serves only
--    marked media, so a publication made by the earlier function stops
--    serving its photos instead of serving an original.
--  * the earlier public.life_blog_publish keeps its signature and receipts for
--    text-only and HEIC-only selections and refuses JPEG/PNG/WebP photos
--    without a copy (outdated clients fail closed).
-- Functions of the 2026-11-01 install bundle (valid_document, save, ready,
-- prepare_asset, private publish, delete_post) are not redefined, so
-- re-running that bundle cannot undo this change. Originals, views, documents,
-- receipts and publications are not modified. Row guard: every table count in
-- public/haedo_*/storage.objects and the content hash of the blog asset,
-- post and publication rows are recorded first; any difference rolls back.
-- The haedo-blog-media Edge function (same change) additionally refuses any
-- served bytes that carry metadata.
begin;

create temp table blog_copy_guard(relation text primary key, n bigint not null) on commit drop;
do $$ declare r record; n bigint; begin
 for r in select format('%I.%I',ns.nspname,c.relname) relation from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where c.relkind='r' and (ns.nspname='public' or ns.nspname like 'haedo\_%' or (ns.nspname='storage' and c.relname='objects'))
 loop
  execute format('select count(*) from %s',r.relation) into n;
  insert into pg_temp.blog_copy_guard values(r.relation,n);
 end loop;
end $$;
create temp table blog_copy_hash on commit drop as select
 (select encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(a.owner_id,a.post_id,a.photo_id,a.digest,a.bytes,a.mime,a.width,a.height,a.path,a.created_at,a.deleted_at)::text,','
   order by a.owner_id,a.post_id,a.photo_id,a.digest),''),'UTF8')),'hex') from haedo_blog_private.assets a) assets_hash,
 (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,',' order by p.owner_id,p.id),''),'UTF8')),'hex') from haedo_blog_private.posts p) posts_hash,
 (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,',' order by p.owner_id,p.post_id),''),'UTF8')),'hex') from haedo_blog_private.publications p) publications_hash;

-- Existing rows are originals or HEIC views; only prepare_copy sets true.
alter table haedo_blog_private.assets add column if not exists public_copy boolean not null default false;

-- Registers the public copy of one JPEG/PNG/WebP photo of a stored post. The
-- copy is a separate immutable private object; its digest differs from the
-- original and its size is at most the original's displayed size.
create or replace function haedo_blog_private.prepare_copy(p_post_id uuid,p_photo_id text,p_digest text,p_bytes bigint,p_type text,p_width integer,p_height integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); post haedo_blog_private.posts%rowtype; item jsonb; a haedo_blog_private.assets%rowtype; object_path text;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_photo_id is null or p_photo_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 or p_bytes is null or p_bytes not between 1 and 67108864 or p_type is null or p_type not in ('image/jpeg','image/png')
 or p_width is null or p_width<1 or p_height is null or p_height<1 then raise exception using errcode='22023',message='life_blog_invalid_asset'; end if;
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into post from haedo_blog_private.posts where owner_id=who and id=p_post_id;
 if not found then raise exception using errcode='22023',message='life_blog_unknown_photo'; end if;
 select j into item from jsonb_array_elements(post.data->'photos') j where j->>'id'=p_photo_id;
 if item is null or item ? 'view' or item->>'type' not in ('image/jpeg','image/png','image/webp') then raise exception using errcode='22023',message='life_blog_unknown_photo'; end if;
 if p_digest=item->>'digest' or p_width>(item->>'width')::integer or p_height>(item->>'height')::integer then raise exception using errcode='22023',message='life_blog_invalid_asset'; end if;
 object_path:=who::text||'/'||p_post_id::text||'/'||p_photo_id||'/'||p_digest;
 insert into haedo_blog_private.assets(owner_id,post_id,photo_id,digest,bytes,mime,width,height,path,public_copy)
 values(who,p_post_id,p_photo_id,p_digest,p_bytes,p_type,p_width,p_height,object_path,true) on conflict do nothing;
 select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=p_photo_id and digest=p_digest;
 if not found or not a.public_copy or a.bytes is distinct from p_bytes or a.mime is distinct from p_type or a.width is distinct from p_width or a.height is distinct from p_height
 then raise exception using errcode='22023',message='life_blog_asset_mismatch'; end if;
 if a.deleted_at is not null then update haedo_blog_private.assets set deleted_at=null where owner_id=who and post_id=p_post_id and photo_id=p_photo_id and digest=p_digest; end if;
 return jsonb_build_object('bucket','haedo-blog-originals','path',object_path,'exists',exists(select 1 from storage.objects where bucket_id='haedo-blog-originals' and name=object_path));
end $$;

-- Same CAS, receipts and snapshot as the earlier publish, except that the
-- public bytes of every chosen photo are a copy: the HEIC/HEIF JPEG view, or
-- the registered public copy named in p_copies ({photo id: {type,size,digest,
-- width,height}}) for JPEG/PNG/WebP. p_copies names exactly those photos.
create or replace function haedo_blog_private.publish_copies(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); copies jsonb:=coalesce(p_copies,'{}'::jsonb); known text[]; named text[];
 mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}';
 item jsonb; src jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or p_expected_publication_revision is null or p_expected_publication_revision not between 0 and 9007199254740990
 or cardinality(chosen)>20 or cardinality(chosen)<>(select count(distinct c) from unnest(chosen)c)
 or not haedo_blog_private.keys(p_author,array['name','intro'],array['name','intro']) or not haedo_blog_private.txt(p_author->'name',500) or not haedo_blog_private.txt(p_author->'intro',2000)
 or jsonb_typeof(copies) is distinct from 'object'
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 select coalesce(array_agg(k),'{}') into named from jsonb_object_keys(copies) k;
 if not named <@ chosen then raise exception using errcode='22023',message='life_invalid_request'; end if;
 for src in select value from jsonb_each(copies) loop
  if not haedo_blog_private.keys(src,array['type','size','digest','width','height'],array['type','size','digest','width','height'])
  or not haedo_blog_private.photo_media(src) or src->>'type' not in ('image/jpeg','image/png') then raise exception using errcode='22023',message='life_invalid_request'; end if;
 end loop;
 -- Without copies the request hash equals the earlier publish, so a receipt
 -- of a text-only or HEIC-only request made before this migration still
 -- answers the same operation.
 h:=sha256(convert_to((case when copies='{}'::jsonb then jsonb_build_array('publish',p_expected_revision,chosen,p_author,p_expected_publication_revision)
  else jsonb_build_array('publish',p_expected_revision,chosen,p_author,p_expected_publication_revision,copies) end)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
 if not found then return '{"status":"missing"}'::jsonb; end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 if p.data->>'status' is distinct from 'saved' then raise exception using errcode='22023',message='life_blog_not_saved'; end if;
 if p.data->'archived'='true'::jsonb then raise exception using errcode='22023',message='life_blog_archived'; end if;
 select * into old from haedo_blog_private.publications where owner_id=who and post_id=p_post_id for update;
 if coalesce(old.revision,0)<>p_expected_publication_revision then return jsonb_build_object('status','conflict','revision',coalesce(old.revision,0)); end if;
 select coalesce(array_agg(j->'insert'->'photo'->>'id'),'{}') into known from jsonb_array_elements(p.data->'ops') j where jsonb_typeof(j->'insert')='object';
 if not chosen <@ known then raise exception using errcode='22023',message='life_blog_unknown_photo'; end if;
 if not haedo_blog_private.ready(who,p_post_id,p.data) then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
 insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author;
 select * into f from haedo_blog_private.profiles where owner_id=who;
 for item in select * from jsonb_array_elements(p.data->'photos') loop
  if not(item->>'id'=any(chosen)) then continue; end if;
  public_id:=gen_random_uuid()::text;
  mapping:=mapping||jsonb_build_object(item->>'id',public_id);
  if item ? 'view' then
   -- HEIC/HEIF: the JPEG view the document already carries (ready() checked its upload).
   if copies ? (item->>'id') then raise exception using errcode='22023',message='life_invalid_request'; end if;
   src:=item->'view';
   select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=src->>'digest' and deleted_at is null;
   if not found or a.mime<>'image/jpeg' then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
  else
   src:=copies->(item->>'id');
   if src is null then raise exception using errcode='22023',message='life_blog_public_copy_required'; end if;
   select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=src->>'digest' and deleted_at is null and public_copy;
   if not found or a.digest=item->>'digest' or a.mime not in ('image/jpeg','image/png') or a.mime<>src->>'type' or a.bytes<>(src->>'size')::bigint
   or a.width<>(src->>'width')::integer or a.height<>(src->>'height')::integer
   or not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path and o.metadata->>'size'=a.bytes::text and o.metadata->>'mimetype'=a.mime)
   then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
  end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('id',public_id,'type',a.mime,'width',a.width,'height',a.height,'size',a.bytes,'digest',a.digest));
  media:=media||jsonb_build_object(public_id,jsonb_build_object('bucket','haedo-blog-originals','path',a.path,'type',a.mime,'size',a.bytes,'digest',a.digest,'copy',true));
 end loop;
 for op in select * from jsonb_array_elements(p.data->'ops') loop
  if jsonb_typeof(op->'insert')='string' then ops:=ops||jsonb_build_array(op);
  elsif mapping ? (op->'insert'->'photo'->>'id') then
    ops:=ops||jsonb_build_array(jsonb_set(op,'{insert,photo,id}',mapping->(op->'insert'->'photo'->>'id')));
  end if;
 end loop;
 snapshot:=jsonb_build_object('format','life-blog-public-v1','title',p.data->'title','ops',ops,'photos',photos,'attachments',coalesce(p.data->'attachments','[]'::jsonb),'author',p_author);
 if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(snapshot->'attachments')=0
 and (select coalesce(string_agg(j->>'insert',''),'') ~ '^[[:space:]]*$' from jsonb_array_elements(ops) j) then
  raise exception using errcode='22023',message='life_blog_empty_publication';
 end if;
 if octet_length(convert_to(snapshot::text,'UTF8'))>2097152 then raise exception using errcode='22001',message='life_snapshot_too_large'; end if;
 rev:=coalesce(old.revision,0)+1; tok:=case when old.active then old.token else gen_random_uuid() end;
 created:=case when old.active then old.created_at else clock_timestamp() end;
 insert into haedo_blog_private.publications(owner_id,post_id,token,revision,source_revision,active,snapshot,media,created_at)
 values(who,p_post_id,tok,rev,p.revision,true,snapshot,media,created)
 on conflict(owner_id,post_id) do update set token=excluded.token,revision=excluded.revision,source_revision=excluded.source_revision,
 active=true,snapshot=excluded.snapshot,media=excluded.media,created_at=excluded.created_at,updated_at=clock_timestamp();
 r:=jsonb_build_object('status','stored','token',tok,'blogToken',f.token,'revision',rev);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $$;

-- Only media written by publish_copies (marked copies) resolve. The marker is
-- not part of the Edge contract and is removed from the answer.
create or replace function haedo_blog_private.public_media(p_token uuid,p_photo_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select (p.media->p_photo_id)-'copy' from haedo_blog_private.publications p
 where p.token=p_token and p.active and p.media ? p_photo_id and p.media->p_photo_id->'copy'='true'::jsonb
$$;

-- The earlier RPC keeps its signature, privileges and receipts; it publishes
-- text and HEIC views, and refuses JPEG/PNG/WebP photos (no copy named).
create or replace function public.life_blog_publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.publish_copies(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,'{}'::jsonb)$$;
create or replace function public.life_blog_publish_copies(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.publish_copies(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies)$$;
create or replace function public.life_blog_publish_prepare_copy(p_post_id uuid,p_photo_id text,p_digest text,p_bytes bigint,p_type text,p_width integer,p_height integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.prepare_copy(p_post_id,p_photo_id,p_digest,p_bytes,p_type,p_width,p_height)$$;

do $$ declare signature text; begin
 foreach signature in array array['publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','prepare_copy(uuid,text,text,bigint,text,integer,integer)'] loop
  execute format('revoke all on function haedo_blog_private.%s from public,anon,authenticated,service_role',signature);
  execute format('grant execute on function haedo_blog_private.%s to authenticated',signature);
 end loop;
 foreach signature in array array['life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','life_blog_publish_prepare_copy(uuid,text,text,bigint,text,integer,integer)'] loop
  execute format('revoke all on function public.%s from public,anon,authenticated,service_role',signature);
  execute format('grant execute on function public.%s to authenticated',signature);
 end loop;
end $$;

do $$ declare g record; r record; n bigint; begin
 for r in select * from pg_temp.blog_copy_guard loop
  execute format('select count(*) from %s',r.relation) into n;
  if n<>r.n then raise exception using errcode='P0001',message='life_blog_public_copy_guard_mismatch',detail=r.relation; end if;
 end loop;
 select * into g from pg_temp.blog_copy_hash;
 if (select encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(a.owner_id,a.post_id,a.photo_id,a.digest,a.bytes,a.mime,a.width,a.height,a.path,a.created_at,a.deleted_at)::text,','
   order by a.owner_id,a.post_id,a.photo_id,a.digest),''),'UTF8')),'hex') from haedo_blog_private.assets a) is distinct from g.assets_hash
 or (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,',' order by p.owner_id,p.id),''),'UTF8')),'hex') from haedo_blog_private.posts p) is distinct from g.posts_hash
 or (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,',' order by p.owner_id,p.post_id),''),'UTF8')),'hex') from haedo_blog_private.publications p) is distinct from g.publications_hash
 then raise exception using errcode='P0001',message='life_blog_public_copy_guard_mismatch',detail='blog rows'; end if;
end $$;
notify pgrst,'reload schema';
commit;
