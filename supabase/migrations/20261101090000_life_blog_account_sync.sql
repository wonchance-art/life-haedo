-- Account-wide blog sync (2026-11-01 owner directive): every saved post and
-- draft of the signed-in owner is kept on all of their devices. Extends
-- 20261017144744_life_blog_originals without rewriting stored documents.
--  * documents may be drafts; drafts are never listed, read or published publicly
--  * HEIC/HEIF originals carry a required JPEG view rendition (separate asset)
--  * an owner can delete a private post; its originals become removable through
--    the Storage API only after that deletion (RLS on the exact deleted path)
begin;

-- HEIC/HEIF originals plus soft-deleted asset rows awaiting object removal.
do $$ declare c text; begin
 for c in select conname from pg_constraint where conrelid='haedo_blog_private.assets'::regclass and contype='c' and pg_get_constraintdef(oid) like '%mime%' loop
  execute format('alter table haedo_blog_private.assets drop constraint %I',c);
 end loop;
end $$;
alter table haedo_blog_private.assets add constraint blog_assets_mime check(mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif'));
alter table haedo_blog_private.assets add column if not exists deleted_at timestamptz;

update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id='haedo-blog-originals';
do $$ begin
 if not exists(select 1 from storage.buckets where id='haedo-blog-originals' and not public and file_size_limit=67108864
  and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/heic','image/heif']
  and allowed_mime_types <@ array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
 then raise exception 'life_blog_bucket_configuration_mismatch'; end if;
end $$;

create or replace function haedo_blog_private.photo_media(p jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object' and jsonb_typeof(p->'type')='string'
  and jsonb_typeof(p->'digest')='string' and p->>'digest' ~ '^[a-f0-9]{64}$'
  and haedo_blog_private.intval(p->'size',1,67108864) and haedo_blog_private.intval(p->'width',1,2147483647)
  and haedo_blog_private.intval(p->'height',1,2147483647),false)
$$;

create or replace function haedo_blog_private.valid_document(j jsonb,p_id uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v2 boolean; draft boolean; p jsonb; o jsonb; a jsonb; k text; value jsonb; ids text[]:='{}'; used text[]:='{}'; total bigint:=0; chars integer:=0; s text;
begin
 v2:=j->>'format'='life-photo-post-v2';
 if not haedo_blog_private.keys(j,array['format','id','revision','title','status','replaces','createdAt','updatedAt','ops','photos','attachments','archived'],
   array['format','id','revision','title','status','replaces','createdAt','updatedAt','ops','photos'])
 or jsonb_typeof(j->'format') is distinct from 'string' or j->>'format' not in ('life-photo-post-v1','life-photo-post-v2') or j->>'id' is distinct from p_id::text
 or jsonb_typeof(j->'status') is distinct from 'string' or j->>'status' not in ('saved','draft') or not haedo_blog_private.intval(j->'revision',0,9007199254740991)
 or not haedo_blog_private.txt(j->'title',500) or octet_length(convert_to(j::text,'UTF8'))>2097152 then return false; end if;
 draft:=j->>'status'='draft';
 if v2 then
   if not(j ?& array['attachments','archived']) or jsonb_typeof(j->'archived') is distinct from 'boolean' then return false; end if;
 elsif j ?| array['attachments','archived'] then return false; end if;
 foreach k in array array['createdAt','updatedAt'] loop
   if jsonb_typeof(j->k) is distinct from 'string' or j->>k !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' then return false; end if;
   if to_char((j->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>j->>k then return false; end if;
 end loop;
 if j->>'updatedAt'<j->>'createdAt' then return false; end if;
 if j->'replaces'<>'null'::jsonb then
   if not haedo_blog_private.keys(j->'replaces',array['id','revision'],array['id','revision']) or jsonb_typeof(j->'replaces'->'id') is distinct from 'string' or (j->'replaces'->>'id') !~ '^[A-Za-z0-9_-]{1,128}$'
   or j->'replaces'->>'id'=j->>'id' or not haedo_blog_private.intval(j->'replaces'->'revision',0,9007199254740991) then return false; end if;
 end if;
 if jsonb_typeof(j->'photos') is distinct from 'array' or jsonb_array_length(j->'photos')>20 then return false; end if;
 for p in select * from jsonb_array_elements(j->'photos') loop
   if not haedo_blog_private.keys(p,array['id','name','type','width','height','size','digest','view'],array['id','name','type','width','height','size','digest'])
   or jsonb_typeof(p->'id') is distinct from 'string' or p->>'id' !~ '^[A-Za-z0-9_-]{1,128}$' or (p->>'id')=any(ids) or not haedo_blog_private.txt(p->'name',500)
   or not haedo_blog_private.photo_media(p) or p->>'type' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif') then return false; end if;
   -- A HEIC/HEIF original is always paired with exactly one JPEG view; other
   -- originals never carry one. The view is a separate, immutable asset.
   if p->>'type' in ('image/heic','image/heif') then
     if not haedo_blog_private.keys(p->'view',array['type','size','digest','width','height'],array['type','size','digest','width','height'])
     or not haedo_blog_private.photo_media(p->'view') or p->'view'->>'type' is distinct from 'image/jpeg' or p->'view'->>'digest'=p->>'digest' then return false; end if;
     total:=total+(p->'view'->>'size')::bigint;
   elsif p ? 'view' then return false; end if;
   ids:=array_append(ids,p->>'id'); total:=total+(p->>'size')::bigint;
 end loop;
 if total>268435456 or jsonb_typeof(j->'ops') is distinct from 'array' or jsonb_array_length(j->'ops') not between 1 and 5000 then return false; end if;
 for o in select * from jsonb_array_elements(j->'ops') loop
   if not haedo_blog_private.keys(o,array['insert','attributes'],array['insert']) then return false; end if;
   if jsonb_typeof(o->'insert')='string' then
     if not haedo_blog_private.txt(o->'insert',50000) then return false; end if;
     chars:=chars+haedo_blog_private.utf16(o->>'insert'); s:=coalesce(s,'')||(o->>'insert');
   else
     p:=o->'insert'->'photo';
     if not haedo_blog_private.keys(o->'insert',array['photo'],array['photo']) or not haedo_blog_private.keys(p,array['id','caption','alt'],array['id','caption','alt'])
     or jsonb_typeof(p->'id') is distinct from 'string' or not((p->>'id')=any(ids)) or (p->>'id')=any(used) or not haedo_blog_private.txt(p->'caption',2000) or not haedo_blog_private.txt(p->'alt',2000) then return false; end if;
     used:=array_append(used,p->>'id');
   end if;
   if o ? 'attributes' then
     a:=o->'attributes';
     if not haedo_blog_private.keys(a,array['bold','italic','underline','header','blockquote','list','align','link'],'{}') then return false; end if;
     for k,value in select * from jsonb_each(a) loop
       if k in ('bold','italic','underline','blockquote') then if value<>'true'::jsonb then return false; end if;
       elsif k='header' then if value not in ('1'::jsonb,'2'::jsonb) then return false; end if;
       elsif k='list' then if value not in ('"ordered"'::jsonb,'"bullet"'::jsonb) then return false; end if;
       elsif k='align' then if value not in ('"center"'::jsonb,'"right"'::jsonb,'"justify"'::jsonb) then return false; end if;
       elsif k='link' and not haedo_blog_private.url(value) then return false; end if;
     end loop;
   end if;
 end loop;
 if chars>50000 or jsonb_typeof(j->'ops'->-1->'insert') is distinct from 'string' or right(j->'ops'->-1->>'insert',1)<>chr(10) then return false; end if;
 if v2 then
   if jsonb_typeof(j->'attachments') is distinct from 'array' or jsonb_array_length(j->'attachments')>12 then return false; end if;
   for a in select * from jsonb_array_elements(j->'attachments') loop
     if not haedo_blog_private.keys(a,array['type','title','creator','url'],array['type','title','creator','url'])
     or jsonb_typeof(a->'type') is distinct from 'string' or a->>'type' not in ('music','book','film','video','article','artwork','tool','person','place','other')
     or not haedo_blog_private.txt(a->'title',500) or length(a->>'title')=0 or not haedo_blog_private.txt(a->'creator',500)
     or not haedo_blog_private.txt(a->'url',2048) or (a->>'url'<>'' and not haedo_blog_private.url(a->'url')) then return false; end if;
   end loop;
 end if;
 -- An empty draft is a legitimate editor state; an empty saved post is not.
 if not draft and (j->>'title') ~ '^[[:space:]]*$' and coalesce(s,'') ~ '^[[:space:]]*$' and cardinality(used)=0 and coalesce(jsonb_array_length(j->'attachments'),0)=0 then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function haedo_blog_private.asset_deletable(p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(select 1 from haedo_blog_private.assets where owner_id=(select auth.uid()) and path=p_path and deleted_at is not null)
$$;
create or replace function haedo_blog_private.ready(p_owner uuid,p_post uuid,p_data jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select not exists(select 1 from jsonb_array_elements(p_data->'photos') p
  cross join lateral (select p as m union all select p->'view' where p ? 'view') r
  where not exists(
  select 1 from haedo_blog_private.assets a join storage.objects o on o.bucket_id='haedo-blog-originals' and o.name=a.path
  where a.owner_id=p_owner and a.post_id=p_post and a.photo_id=p->>'id' and a.digest=r.m->>'digest' and a.deleted_at is null
  and a.bytes=(r.m->>'size')::bigint and a.mime=r.m->>'type' and a.width=(r.m->>'width')::integer and a.height=(r.m->>'height')::integer
  and o.metadata->>'size'=a.bytes::text and o.metadata->>'mimetype'=a.mime))
$$;

-- Restrictive guards still deny every update and every delete of a live
-- original. Only an owner's explicitly deleted post exposes its exact paths.
drop policy if exists blog_originals_delete on storage.objects;
create policy blog_originals_delete on storage.objects for delete to authenticated using(bucket_id='haedo-blog-originals' and haedo_blog_private.asset_deletable(name));
drop policy if exists blog_originals_delete_guard on storage.objects;
create policy blog_originals_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'haedo-blog-originals' or haedo_blog_private.asset_deletable(name));

create or replace function haedo_blog_private.prepare_asset(p_post_id uuid,p_photo_id text,p_digest text,p_bytes bigint,p_type text,p_width integer,p_height integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); a haedo_blog_private.assets%rowtype; object_path text;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_photo_id is null or p_photo_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 or p_bytes is null or p_bytes not between 1 and 67108864 or p_type is null or p_type not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
 or p_width is null or p_width<1 or p_height is null or p_height<1 then raise exception using errcode='22023',message='life_blog_invalid_asset'; end if;
 object_path:=who::text||'/'||p_post_id::text||'/'||p_photo_id||'/'||p_digest;
 insert into haedo_blog_private.assets(owner_id,post_id,photo_id,digest,bytes,mime,width,height,path)
 values(who,p_post_id,p_photo_id,p_digest,p_bytes,p_type,p_width,p_height,object_path) on conflict do nothing;
 select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=p_photo_id and digest=p_digest;
 if a.bytes is distinct from p_bytes or a.mime is distinct from p_type or a.width is distinct from p_width or a.height is distinct from p_height then raise exception using errcode='22023',message='life_blog_asset_mismatch'; end if;
 -- A post recreated after deletion reuses the identical immutable path.
 if a.deleted_at is not null then update haedo_blog_private.assets set deleted_at=null where owner_id=who and post_id=p_post_id and photo_id=p_photo_id and digest=p_digest; end if;
 return jsonb_build_object('bucket','haedo-blog-originals','path',object_path,'exists',exists(select 1 from storage.objects where bucket_id='haedo-blog-originals' and name=object_path));
end $$;

create or replace function haedo_blog_private.list(p_workspace_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspace_id',p.workspace_id,'revision',p.revision,'title',p.data->>'title','updated_at',p.updated_at,
  'photos',jsonb_array_length(p.data->'photos'),'archived',coalesce(p.data->'archived','false'::jsonb),'publication',haedo_blog_private.owner_publication(who,p.id)) order by p.updated_at desc,p.id),'[]'::jsonb)
 into r from haedo_blog_private.posts p where p.owner_id=who and p.data->>'status'='saved' and (p_workspace_id is null or p.workspace_id=p_workspace_id);
 return r;
end $$;
-- Owner-only device sync head list: every saved post and draft, no bodies.
create or replace function haedo_blog_private.sync_list()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspace_id',p.workspace_id,'revision',p.revision,'status',p.data->>'status','title',p.data->>'title',
  'updated_at',p.updated_at,'document_updated_at',p.data->>'updatedAt','photos',jsonb_array_length(p.data->'photos'),
  'archived',coalesce(p.data->'archived','false'::jsonb),'publication',haedo_blog_private.owner_publication(who,p.id)) order by p.updated_at desc,p.id),'[]'::jsonb)
 into r from haedo_blog_private.posts p where p.owner_id=who;
 return r;
end $$;
create or replace function haedo_blog_private.read(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); p haedo_blog_private.posts%rowtype; assets jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id;
 if not found then return null; end if;
 select coalesce(jsonb_object_agg(j->>'id',jsonb_build_object('bucket','haedo-blog-originals','path',a.path)||case when j ? 'view' then jsonb_build_object('view',
   (select jsonb_build_object('bucket','haedo-blog-originals','path',v.path) from haedo_blog_private.assets v
    where v.owner_id=who and v.post_id=p.id and v.photo_id=j->>'id' and v.digest=j->'view'->>'digest' and v.deleted_at is null)) else '{}'::jsonb end),'{}'::jsonb) into assets
 from jsonb_array_elements(p.data->'photos') j join haedo_blog_private.assets a on a.owner_id=who and a.post_id=p.id and a.photo_id=j->>'id' and a.digest=j->>'digest' and a.deleted_at is null;
 return jsonb_build_object('id',p.id,'workspace_id',p.workspace_id,'revision',p.revision,'data',p.data,'assets',assets,'updated_at',p.updated_at,'publication',haedo_blog_private.owner_publication(who,p.id));
end $$;
create or replace function haedo_blog_private.save(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; r jsonb; rev bigint;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_workspace_id is null or p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 if not haedo_blog_private.valid_document(p_data,p_post_id) then raise exception using errcode='22023',message='life_blog_invalid_document'; end if;
 h:=sha256(convert_to(jsonb_build_array('save',p_workspace_id,p_expected_revision,p_data)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
 if not found then
   if p_expected_revision<>0 then return '{"status":"missing"}'::jsonb; end if;
   rev:=1;
 else
   if p.workspace_id<>p_workspace_id then raise exception using errcode='22023',message='life_blog_workspace_mismatch'; end if;
   if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
   if p.data->>'format'='life-photo-post-v2' and p_data->>'format'='life-photo-post-v1' then raise exception using errcode='22023',message='life_blog_update_required'; end if;
   -- A saved (possibly published) post never turns back into a draft.
   if p.data->>'status'='saved' and p_data->>'status'='draft' then raise exception using errcode='22023',message='life_blog_status_regression'; end if;
   rev:=p.revision+1;
 end if;
 if not haedo_blog_private.ready(who,p_post_id,p_data) then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
 insert into haedo_blog_private.posts(owner_id,id,workspace_id,revision,data) values(who,p_post_id,p_workspace_id,rev,p_data)
 on conflict(owner_id,id) do update set revision=excluded.revision,data=excluded.data,updated_at=clock_timestamp();
 r:=jsonb_build_object('status','stored','revision',rev);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $$;
-- Explicit owner deletion. Removes the private document, its receipts and any
-- publication in one transaction, then marks its originals deletable. The
-- client removes those exact objects through the Storage API afterwards.
create or replace function haedo_blog_private.delete_post(p_post_id uuid,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); p haedo_blog_private.posts%rowtype; paths jsonb; existed boolean;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or (p_expected_revision is not null and p_expected_revision not between 1 and 9007199254740991) then raise exception using errcode='22023',message='life_invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
 existed:=found;
 if existed then
  if p_expected_revision is not null and p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
  delete from haedo_blog_private.publications where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.posts where owner_id=who and id=p_post_id;
  update haedo_blog_private.assets set deleted_at=clock_timestamp() where owner_id=who and post_id=p_post_id and deleted_at is null;
 end if;
 -- Rows whose objects are already gone carry no further information.
 delete from haedo_blog_private.assets a where a.owner_id=who and a.deleted_at is not null
  and not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path);
 select coalesce(jsonb_agg(a.path order by a.path),'[]'::jsonb) into paths from haedo_blog_private.assets a
  where a.owner_id=who and a.post_id=p_post_id and a.deleted_at is not null;
 return jsonb_build_object('status',case when existed then 'deleted' else 'missing' end,'revision',coalesce(p.revision,0),'paths',paths);
end $$;

create or replace function haedo_blog_private.publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); known text[]; mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}';
 item jsonb; src jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or p_expected_publication_revision is null or p_expected_publication_revision not between 0 and 9007199254740990
 or cardinality(chosen)>20 or cardinality(chosen)<>(select count(distinct c) from unnest(chosen)c)
 or not haedo_blog_private.keys(p_author,array['name','intro'],array['name','intro']) or not haedo_blog_private.txt(p_author->'name',500) or not haedo_blog_private.txt(p_author->'intro',2000)
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 h:=sha256(convert_to(jsonb_build_array('publish',p_expected_revision,chosen,p_author,p_expected_publication_revision)::text,'UTF8'));
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
  -- HEIC/HEIF originals are published only through their JPEG view.
  src:=case when item ? 'view' then item->'view' else item end;
  photos:=photos||jsonb_build_array(jsonb_build_object('id',public_id,'type',src->'type','width',src->'width','height',src->'height','size',src->'size','digest',src->'digest'));
  select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=src->>'digest' and deleted_at is null;
  if not found or a.mime not in ('image/jpeg','image/png','image/webp') then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
  media:=media||jsonb_build_object(public_id,jsonb_build_object('bucket','haedo-blog-originals','path',a.path,'type',a.mime,'size',a.bytes,'digest',a.digest));
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

create or replace function public.life_blog_sync_list() returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.sync_list()$$;
create or replace function public.life_blog_delete(p_post_id uuid,p_expected_revision bigint default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.delete_post(p_post_id,p_expected_revision)$$;

revoke all on function haedo_blog_private.photo_media(jsonb),haedo_blog_private.valid_document(jsonb,uuid),haedo_blog_private.ready(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function haedo_blog_private.asset_deletable(text) from public,anon,authenticated,service_role;
grant execute on function haedo_blog_private.asset_deletable(text) to anon,authenticated;
do $$ declare name text; signature text; private_name text; role_name text; begin
 for name,signature,private_name,role_name in values
  ('list','uuid','list','authenticated'),('read','uuid','read','authenticated'),
  ('save','uuid,uuid,bigint,uuid,jsonb','save','authenticated'),
  ('prepare_asset','uuid,text,text,bigint,text,integer,integer','prepare_asset','authenticated'),
  ('publish','uuid,bigint,uuid,text[],jsonb,bigint','publish','authenticated'),
  ('sync_list','','sync_list','authenticated'),('delete','uuid,bigint','delete_post','authenticated')
 loop
  execute format('revoke all on function public.life_blog_%s(%s) from public,anon,authenticated,service_role',name,signature);
  execute format('grant execute on function public.life_blog_%s(%s) to %s',name,signature,role_name);
  execute format('revoke all on function haedo_blog_private.%I(%s) from public,anon,authenticated,service_role',private_name,signature);
  execute format('grant execute on function haedo_blog_private.%I(%s) to %s',private_name,signature,role_name);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
