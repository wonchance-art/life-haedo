-- Private blog documents, immutable original assets, and explicitly selected
-- public snapshots. Does not alter existing workspaces, Auth, or public pages.
begin;
create schema if not exists haedo_blog_private;
revoke all on schema haedo_blog_private from public;
grant usage on schema haedo_blog_private to anon, authenticated, service_role;

create table if not exists haedo_blog_private.posts (
  owner_id uuid not null, id uuid not null, workspace_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  data jsonb not null, updated_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,id)
);
create index if not exists blog_posts_workspace on haedo_blog_private.posts(owner_id,workspace_id,updated_at desc,id);
create table if not exists haedo_blog_private.assets (
  owner_id uuid not null, post_id uuid not null, photo_id text not null,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check(bytes between 1 and 67108864),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  width integer not null check(width>0), height integer not null check(height>0),
  path text not null unique, created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,post_id,photo_id,digest)
);
create table if not exists haedo_blog_private.receipts (
  owner_id uuid not null, post_id uuid not null, operation_id uuid not null,
  request_hash bytea not null check(octet_length(request_hash)=32),
  result jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,post_id,operation_id)
);
create table if not exists haedo_blog_private.profiles (
  owner_id uuid primary key, token uuid not null unique default gen_random_uuid(),
  author jsonb not null default '{"name":"","intro":""}'::jsonb
);
create table if not exists haedo_blog_private.publications (
  owner_id uuid not null, post_id uuid not null, token uuid not null unique,
  revision bigint not null check(revision between 1 and 9007199254740991),
  source_revision bigint not null, active boolean not null,
  snapshot jsonb, media jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,post_id),
  foreign key(owner_id,post_id) references haedo_blog_private.posts(owner_id,id),
  check((active and snapshot is not null and media is not null) or
        (not active and snapshot is null and media is null))
);
create index if not exists blog_publications_list on haedo_blog_private.publications(owner_id,updated_at desc,token desc) where active;
alter table haedo_blog_private.posts enable row level security;
alter table haedo_blog_private.assets enable row level security;
alter table haedo_blog_private.receipts enable row level security;
alter table haedo_blog_private.profiles enable row level security;
alter table haedo_blog_private.publications enable row level security;
revoke all on all tables in schema haedo_blog_private from public,anon,authenticated;

create or replace function haedo_blog_private.keys(j jsonb, allowed text[], required text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(j)='object' and j ?& required and
   not exists(select 1 from jsonb_object_keys(case when jsonb_typeof(j)='object' then j else '{}'::jsonb end) k where not(k=any(allowed))),false)
$$;
create or replace function haedo_blog_private.utf16(v text)
returns integer language sql immutable strict set search_path=pg_catalog as $$
 select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'') c
$$;
create or replace function haedo_blog_private.txt(j jsonb,n integer)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(j)='string' and haedo_blog_private.utf16(j#>>'{}')<=n
 and (j#>>'{}') !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]',false)
$$;
create or replace function haedo_blog_private.intval(j jsonb,lo bigint,hi bigint)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(j) is distinct from 'number' or (j#>>'{}') !~ '^(0|[1-9][0-9]*)$' then return false; end if;
 return (j#>>'{}')::numeric between lo and hi;
end $$;
create or replace function haedo_blog_private.url(j jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select haedo_blog_private.txt(j,2048) and (j#>>'{}') ~ '^https?://[^/@[:space:]\\?#]+([/?#][^[:space:]\\]*)?$'
$$;
create or replace function haedo_blog_private.valid_document(j jsonb,p_id uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v2 boolean; p jsonb; o jsonb; a jsonb; k text; value jsonb; ids text[]:='{}'; used text[]:='{}'; total bigint:=0; chars integer:=0; s text;
begin
 v2:=j->>'format'='life-photo-post-v2';
 if not haedo_blog_private.keys(j,array['format','id','revision','title','status','replaces','createdAt','updatedAt','ops','photos','attachments','archived'],
   array['format','id','revision','title','status','replaces','createdAt','updatedAt','ops','photos'])
 or jsonb_typeof(j->'format') is distinct from 'string' or j->>'format' not in ('life-photo-post-v1','life-photo-post-v2') or j->>'id' is distinct from p_id::text
 or j->>'status' is distinct from 'saved' or not haedo_blog_private.intval(j->'revision',0,9007199254740991)
 or not haedo_blog_private.txt(j->'title',500) or octet_length(convert_to(j::text,'UTF8'))>2097152 then return false; end if;
 if v2 then
   if not(j ?& array['attachments','archived']) or jsonb_typeof(j->'archived') is distinct from 'boolean' then return false; end if;
 elsif j ?| array['attachments','archived'] then return false; end if;
 foreach k in array array['createdAt','updatedAt'] loop
   if jsonb_typeof(j->k) is distinct from 'string' or j->>k !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' then return false; end if;
   if to_char((j->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>j->>k then return false; end if;
 end loop;
 if j->>'updatedAt'<j->>'createdAt' then return false; end if;
 if j->'replaces'<>'null'::jsonb then
   if not haedo_blog_private.keys(j->'replaces',array['id','revision'],array['id','revision']) or (j->'replaces'->>'id') !~ '^[A-Za-z0-9_-]{1,128}$'
   or j->'replaces'->>'id'=j->>'id' or not haedo_blog_private.intval(j->'replaces'->'revision',0,9007199254740991) then return false; end if;
 end if;
 if jsonb_typeof(j->'photos') is distinct from 'array' or jsonb_array_length(j->'photos')>20 then return false; end if;
 for p in select * from jsonb_array_elements(j->'photos') loop
   if not haedo_blog_private.keys(p,array['id','name','type','width','height','size','digest'],array['id','name','type','width','height','size','digest'])
   or jsonb_typeof(p->'id') is distinct from 'string' or p->>'id' !~ '^[A-Za-z0-9_-]{1,128}$' or (p->>'id')=any(ids) or not haedo_blog_private.txt(p->'name',500)
   or jsonb_typeof(p->'type') is distinct from 'string' or p->>'type' not in ('image/jpeg','image/png','image/webp')
   or jsonb_typeof(p->'digest') is distinct from 'string' or p->>'digest' !~ '^[a-f0-9]{64}$'
   or not haedo_blog_private.intval(p->'size',1,67108864) or not haedo_blog_private.intval(p->'width',1,2147483647)
   or not haedo_blog_private.intval(p->'height',1,2147483647) then return false; end if;
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
 if (j->>'title') ~ '^[[:space:]]*$' and coalesce(s,'') ~ '^[[:space:]]*$' and cardinality(used)=0 and coalesce(jsonb_array_length(j->'attachments'),0)=0 then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function haedo_blog_private.asset_access(p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(select 1 from haedo_blog_private.assets where owner_id=(select auth.uid()) and path=p_path)
$$;
create or replace function haedo_blog_private.ready(p_owner uuid,p_post uuid,p_data jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select not exists(select 1 from jsonb_array_elements(p_data->'photos') p where not exists(
  select 1 from haedo_blog_private.assets a join storage.objects o on o.bucket_id='haedo-blog-originals' and o.name=a.path
  where a.owner_id=p_owner and a.post_id=p_post and a.photo_id=p->>'id' and a.digest=p->>'digest'
  and a.bytes=(p->>'size')::bigint and a.mime=p->>'type' and a.width=(p->>'width')::integer and a.height=(p->>'height')::integer
  and o.metadata->>'size'=a.bytes::text and o.metadata->>'mimetype'=a.mime))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('haedo-blog-originals','haedo-blog-originals',false,67108864,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='haedo-blog-originals' and not public and file_size_limit=67108864
  and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and allowed_mime_types <@ array['image/jpeg','image/png','image/webp'])
 then raise exception 'life_blog_bucket_configuration_mismatch'; end if;
end $$;
-- Restrictive guards also protect this bucket if another existing permissive
-- Storage policy grants broad access. Other buckets keep their existing rules.
drop policy if exists blog_originals_read on storage.objects;
create policy blog_originals_read on storage.objects for select to authenticated using(bucket_id='haedo-blog-originals' and haedo_blog_private.asset_access(name));
drop policy if exists blog_originals_insert on storage.objects;
create policy blog_originals_insert on storage.objects for insert to authenticated with check(bucket_id='haedo-blog-originals' and haedo_blog_private.asset_access(name));
drop policy if exists blog_originals_read_guard on storage.objects;
create policy blog_originals_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'haedo-blog-originals' or haedo_blog_private.asset_access(name));
drop policy if exists blog_originals_insert_guard on storage.objects;
create policy blog_originals_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'haedo-blog-originals' or haedo_blog_private.asset_access(name));
drop policy if exists blog_originals_update_guard on storage.objects;
create policy blog_originals_update_guard on storage.objects as restrictive for update to public using(bucket_id<>'haedo-blog-originals') with check(bucket_id<>'haedo-blog-originals');
drop policy if exists blog_originals_delete_guard on storage.objects;
create policy blog_originals_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'haedo-blog-originals');

create or replace function haedo_blog_private.prepare_asset(p_post_id uuid,p_photo_id text,p_digest text,p_bytes bigint,p_type text,p_width integer,p_height integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); a haedo_blog_private.assets%rowtype; object_path text;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_photo_id is null or p_photo_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 or p_bytes is null or p_bytes not between 1 and 67108864 or p_type is null or p_type not in ('image/jpeg','image/png','image/webp')
 or p_width is null or p_width<1 or p_height is null or p_height<1 then raise exception using errcode='22023',message='life_blog_invalid_asset'; end if;
 object_path:=who::text||'/'||p_post_id::text||'/'||p_photo_id||'/'||p_digest;
 insert into haedo_blog_private.assets(owner_id,post_id,photo_id,digest,bytes,mime,width,height,path)
 values(who,p_post_id,p_photo_id,p_digest,p_bytes,p_type,p_width,p_height,object_path) on conflict do nothing;
 select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=p_photo_id and digest=p_digest;
 if a.bytes is distinct from p_bytes or a.mime is distinct from p_type or a.width is distinct from p_width or a.height is distinct from p_height then raise exception using errcode='22023',message='life_blog_asset_mismatch'; end if;
 return jsonb_build_object('bucket','haedo-blog-originals','path',object_path,'exists',exists(select 1 from storage.objects where bucket_id='haedo-blog-originals' and name=object_path));
end $$;
create or replace function haedo_blog_private.owner_publication(p_owner uuid,p_post uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('token',p.token,'blogToken',f.token,'revision',p.revision,'active',p.active)
 from haedo_blog_private.publications p join haedo_blog_private.profiles f on f.owner_id=p.owner_id where p.owner_id=p_owner and p.post_id=p_post
$$;
create or replace function haedo_blog_private.list(p_workspace_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'workspace_id',p.workspace_id,'revision',p.revision,'title',p.data->>'title','updated_at',p.updated_at,
  'photos',jsonb_array_length(p.data->'photos'),'archived',coalesce(p.data->'archived','false'::jsonb),'publication',haedo_blog_private.owner_publication(who,p.id)) order by p.updated_at desc,p.id),'[]'::jsonb)
 into r from haedo_blog_private.posts p where p.owner_id=who and (p_workspace_id is null or p.workspace_id=p_workspace_id);
 return r;
end $$;
create or replace function haedo_blog_private.read(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); p haedo_blog_private.posts%rowtype; assets jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id;
 if not found then return null; end if;
 select coalesce(jsonb_object_agg(j->>'id',jsonb_build_object('bucket','haedo-blog-originals','path',a.path)),'{}'::jsonb) into assets
 from jsonb_array_elements(p.data->'photos') j join haedo_blog_private.assets a on a.owner_id=who and a.post_id=p.id and a.photo_id=j->>'id' and a.digest=j->>'digest';
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
   rev:=p.revision+1;
 end if;
 if not haedo_blog_private.ready(who,p_post_id,p_data) then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
 insert into haedo_blog_private.posts(owner_id,id,workspace_id,revision,data) values(who,p_post_id,p_workspace_id,rev,p_data)
 on conflict(owner_id,id) do update set revision=excluded.revision,data=excluded.data,updated_at=clock_timestamp();
 r:=jsonb_build_object('status','stored','revision',rev);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $$;

create or replace function haedo_blog_private.publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); known text[]; mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}';
 item jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
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
  photos:=photos||jsonb_build_array((item-'id'-'name')||jsonb_build_object('id',public_id));
  select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=item->>'digest';
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
create or replace function haedo_blog_private.unpublish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.publications%rowtype; r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 h:=sha256(convert_to(jsonb_build_array('unpublish',p_expected_revision)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.publications where owner_id=who and post_id=p_post_id for update;
 if not found then return '{"status":"missing"}'::jsonb; end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 update haedo_blog_private.publications set active=false,snapshot=null,media=null,revision=revision+1,updated_at=clock_timestamp() where owner_id=who and post_id=p_post_id;
 r:=jsonb_build_object('status','stored','revision',p.revision+1);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $$;
create or replace function haedo_blog_private.public_read(p_token uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('token',p.token,'blogToken',f.token,'revision',p.revision,'createdAt',p.created_at,'updatedAt',p.updated_at,'snapshot',p.snapshot)
 from haedo_blog_private.publications p join haedo_blog_private.profiles f on f.owner_id=p.owner_id where p.token=p_token and p.active
$$;
create or replace function haedo_blog_private.public_media(p_token uuid,p_photo_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select p.media->p_photo_id from haedo_blog_private.publications p where p.token=p_token and p.active and p.media ? p_photo_id
$$;
create or replace function haedo_blog_private.public_list(p_blog_token uuid,p_limit integer default 40,p_before jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare f haedo_blog_private.profiles%rowtype; rows jsonb; cut_time timestamptz; cut_token uuid; cursor jsonb;
begin
 if p_blog_token is null or p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 if p_before is not null then
  if not haedo_blog_private.keys(p_before,array['updatedAt','token'],array['updatedAt','token']) then raise exception using errcode='22023',message='life_invalid_request'; end if;
  cut_time:=(p_before->>'updatedAt')::timestamptz; cut_token:=(p_before->>'token')::uuid;
  if cut_time is null or cut_token is null then raise exception using errcode='22023',message='life_invalid_request'; end if;
 end if;
 select * into f from haedo_blog_private.profiles where token=p_blog_token;
 if not found or not exists(select 1 from haedo_blog_private.publications where owner_id=f.owner_id and active) then
  return jsonb_build_object('blogToken',p_blog_token,'author',jsonb_build_object('name','','intro',''),'posts','[]'::jsonb,'nextCursor',null);
 end if;
 select coalesce(jsonb_agg(value order by updated_at desc,token desc),'[]'::jsonb) into rows from(
  select p.updated_at,p.token,jsonb_build_object('token',p.token,'revision',p.revision,'title',p.snapshot->'title','createdAt',p.created_at,'updatedAt',p.updated_at,
   'excerpt',left(coalesce((select string_agg(o->>'insert','' order by n) from jsonb_array_elements(p.snapshot->'ops') with ordinality x(o,n) where jsonb_typeof(o->'insert')='string'),''),240),
   'cover',case when jsonb_array_length(p.snapshot->'photos')>0 then (p.snapshot->'photos'->0)-'size'-'digest' else null end) value
  from haedo_blog_private.publications p where p.owner_id=f.owner_id and p.active and
   (p_before is null or (p.updated_at,p.token)<(cut_time,cut_token)) order by p.updated_at desc,p.token desc limit p_limit
 ) page;
 if jsonb_array_length(rows)=p_limit then cursor:=jsonb_build_object('updatedAt',rows->-1->'updatedAt','token',rows->-1->'token'); end if;
 return jsonb_build_object('blogToken',p_blog_token,'author',f.author,'posts',rows,'nextCursor',cursor);
end $$;

-- Privileged implementations live outside the exposed API schema. The public
-- wrappers have no definer privileges and expose only the documented RPCs.
create or replace function public.life_blog_list(p_workspace_id uuid default null) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.list(p_workspace_id)$$;
create or replace function public.life_blog_read(p_post_id uuid) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.read(p_post_id)$$;
create or replace function public.life_blog_save(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.save(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)$$;
create or replace function public.life_blog_prepare_asset(p_post_id uuid,p_photo_id text,p_digest text,p_bytes bigint,p_type text,p_width integer,p_height integer) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.prepare_asset(p_post_id,p_photo_id,p_digest,p_bytes,p_type,p_width,p_height)$$;
create or replace function public.life_blog_publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.publish(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision)$$;
create or replace function public.life_blog_unpublish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.unpublish(p_post_id,p_expected_revision,p_operation_id)$$;
create or replace function public.life_blog_public_read(p_token uuid) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.public_read(p_token)$$;
create or replace function public.life_blog_public_list(p_blog_token uuid,p_limit integer default 40,p_before jsonb default null) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.public_list(p_blog_token,p_limit,p_before)$$;
create or replace function public.life_blog_public_media(p_token uuid,p_photo_id text) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select haedo_blog_private.public_media(p_token,p_photo_id)$$;

revoke all on all functions in schema haedo_blog_private from public,anon,authenticated,service_role;
grant execute on function haedo_blog_private.asset_access(text) to anon,authenticated;
do $$ declare name text; signature text; role_name text; begin
 for name,signature,role_name in values
 ('list','uuid','authenticated'),('read','uuid','authenticated'),
 ('save','uuid,uuid,bigint,uuid,jsonb','authenticated'),
 ('prepare_asset','uuid,text,text,bigint,text,integer,integer','authenticated'),
 ('publish','uuid,bigint,uuid,text[],jsonb,bigint','authenticated'),
 ('unpublish','uuid,bigint,uuid','authenticated'),
 ('public_read','uuid','anon,authenticated'),('public_list','uuid,integer,jsonb','anon,authenticated'),
 ('public_media','uuid,text','service_role')
 loop
  execute format('revoke all on function public.life_blog_%I(%s) from public,anon,authenticated,service_role',name,signature);
  execute format('grant execute on function public.life_blog_%I(%s) to %s',name,signature,role_name);
  execute format('grant execute on function haedo_blog_private.%I(%s) to %s',name,signature,role_name);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
