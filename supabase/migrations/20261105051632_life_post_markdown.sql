-- D2 phase 1: accept bounded Markdown as private source without executing it.
-- The client validates canonical life-post-md-v1 grammar, decoded text limits,
-- links and exact photo references. PostgreSQL validates the document envelope,
-- source byte/control-character bounds and all original/view metadata. It does
-- NOT parse CommonMark or claim to prove canonical/source-to-projection equality.
-- Until the maintained server parser/public projection is installed, publishing
-- a Markdown document fails closed (including earlier publish RPCs); existing
-- publications and receipts are unchanged. Withdrawal remains available.
-- No rows, original bytes, grants, RLS policies or public RPC signatures change.
begin;

create temp table blog_markdown_guard(relation text primary key,n bigint,hash text) on commit drop;
do $$ declare r text; n bigint; h text; begin
 foreach r in array array['haedo_blog_private.posts','haedo_blog_private.assets','haedo_blog_private.receipts','haedo_blog_private.publications','haedo_blog_private.profiles'] loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',r) into n,h;
  insert into pg_temp.blog_markdown_guard values(r,n,h);
 end loop;
end $$;

-- Exact v1/v2 validator from 20261102110000, with only the function name changed.
create or replace function haedo_blog_private.valid_delta_document(j jsonb,p_id uuid)
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
     if not haedo_blog_private.keys(a,array['bold','italic','underline','header','blockquote','list','align','link','author'],'{}') then return false; end if;
     for k,value in select * from jsonb_each(a) loop
       if k in ('bold','italic','underline','blockquote') then if value<>'true'::jsonb then return false; end if;
       elsif k='header' then if value not in ('1'::jsonb,'2'::jsonb) then return false; end if;
       elsif k='list' then if value not in ('"ordered"'::jsonb,'"bullet"'::jsonb) then return false; end if;
       elsif k='align' then if value not in ('"center"'::jsonb,'"right"'::jsonb,'"justify"'::jsonb) then return false; end if;
       elsif k='link' and not haedo_blog_private.url(value) then return false;
       -- Private AI authorship mark: only "ai", and only on text (never on a photo).
       elsif k='author' and (value<>'"ai"'::jsonb or jsonb_typeof(o->'insert')<>'string') then return false; end if;
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

create or replace function haedo_blog_private.valid_document(j jsonb,p_id uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare projected jsonb; photo jsonb; ops jsonb:='[]'; body text;
begin
 if j->>'format' is distinct from 'life-post-md-v1' then
  return haedo_blog_private.valid_delta_document(j,p_id);
 end if;
 if not haedo_blog_private.keys(j,array['format','id','revision','title','status','replaces','createdAt','updatedAt','markdown','photos','attachments','archived'],
  array['format','id','revision','title','status','replaces','createdAt','updatedAt','markdown','photos','attachments','archived'])
 or not haedo_blog_private.txt(j->'markdown',1048576)
 or octet_length(convert_to(j->>'markdown','UTF8'))>1048576
 or octet_length(convert_to(j::text,'UTF8'))>2097152
 or right(j->>'markdown',1)<>chr(10)
 or jsonb_typeof(j->'photos') is distinct from 'array' or jsonb_array_length(j->'photos')>20 then return false; end if;
 -- This is metadata validation, not a saved/renderable Delta or a second source.
 -- Each photo is passed through the unchanged media/HEIC/original validation.
 for photo in select * from jsonb_array_elements(j->'photos') loop
  ops:=ops||jsonb_build_array(jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id',photo->'id','caption','','alt',''))));
 end loop;
 body:=case when replace(j->>'markdown','&nbsp;','') ~ '^[[:space:]]*$' then chr(10) else 'body'||chr(10) end;
 ops:=ops||jsonb_build_array(jsonb_build_object('insert',body));
 projected:=(j-'markdown')||jsonb_build_object('format','life-photo-post-v2','ops',ops);
 return haedo_blog_private.valid_delta_document(projected,p_id);
exception when others then return false;
end $$;
revoke all on function haedo_blog_private.valid_delta_document(jsonb,uuid) from public,anon,authenticated,service_role;

-- CAS by itself is insufficient: an outdated client can have the current
-- revision yet try writing its Delta cache over the Markdown source. A trigger
-- also survives replay of the old save function by earlier install bundles.
create or replace function haedo_blog_private.markdown_no_downgrade()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if old.data->>'format'='life-post-md-v1' and new.data->>'format' is distinct from 'life-post-md-v1' then
  raise exception using errcode='22023',message='life_blog_update_required';
 end if;
 return new;
end $$;
revoke all on function haedo_blog_private.markdown_no_downgrade() from public,anon,authenticated,service_role;
drop trigger if exists blog_markdown_no_downgrade on haedo_blog_private.posts;
create trigger blog_markdown_no_downgrade before update of data on haedo_blog_private.posts
 for each row execute function haedo_blog_private.markdown_no_downgrade();

-- Preserve the existing publication routines byte-for-byte except for the
-- explicit format check immediately after owner lookup and expected revision.
-- That check precedes profile, photo, snapshot and receipt changes, including
-- requests with photos or an empty title. The trigger below remains a backstop
-- if an old install bundle later recreates either routine.
create or replace function haedo_blog_private.publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); known text[]; mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}';
 item jsonb; src jsonb; op jsonb; text_op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
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
 if p.data->>'format'='life-post-md-v1' then raise exception using errcode='22023',message='life_blog_markdown_publication_unavailable'; end if;
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
  if jsonb_typeof(op->'insert')='string' then
    -- AI authorship marks stay private (owner decision 2026-11-02): drop only
    -- that attribute; text and every other format are copied unchanged.
    text_op:=op;
    if jsonb_typeof(op->'attributes')='object' and op->'attributes' ? 'author' then
      text_op:=case when (op->'attributes')-'author'='{}'::jsonb then op-'attributes' else jsonb_set(op,'{attributes}',(op->'attributes')-'author') end;
    end if;
    ops:=ops||jsonb_build_array(text_op);
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
 if p.data->>'format'='life-post-md-v1' then raise exception using errcode='22023',message='life_blog_markdown_publication_unavailable'; end if;
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
  src:=copies->(item->>'id');
  if src is null then raise exception using errcode='22023',message='life_blog_public_copy_required'; end if;
  select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=src->>'digest' and deleted_at is null and public_copy;
  if not found or a.digest=item->>'digest' or a.digest is not distinct from item->'view'->>'digest' or a.mime not in ('image/jpeg','image/png') or a.mime<>src->>'type'
  or a.bytes<>(src->>'size')::bigint or a.width<>(src->>'width')::integer or a.height<>(src->>'height')::integer
  or not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path and o.metadata->>'size'=a.bytes::text and o.metadata->>'mimetype'=a.mime)
  then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('id',public_id,'type',a.mime,'width',a.width,'height',a.height,'size',a.bytes,'digest',a.digest));
  media:=media||jsonb_build_object(public_id,jsonb_build_object('bucket','haedo-blog-originals','path',a.path,'type',a.mime,'size',a.bytes,'digest',a.digest,'copy',true));
 end loop;
 for op in select * from jsonb_array_elements(p.data->'ops') loop
  if jsonb_typeof(op->'insert')='string' then ops:=ops||jsonb_build_array(haedo_blog_private.public_text_op(op));
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

-- The old publisher reads ops; without this guard it could publish an empty
-- body from a Markdown document. Reject the whole statement/transaction before
-- any new snapshot/receipt becomes visible. Old public copies remain intact.
create or replace function haedo_blog_private.markdown_publication_requires_parser()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.active and exists(select 1 from haedo_blog_private.posts p where p.owner_id=new.owner_id and p.id=new.post_id and p.data->>'format'='life-post-md-v1') then
  raise exception using errcode='22023',message='life_blog_markdown_publication_unavailable';
 end if;
 return new;
end $$;
revoke all on function haedo_blog_private.markdown_publication_requires_parser() from public,anon,authenticated,service_role;
drop trigger if exists blog_markdown_publication_requires_parser on haedo_blog_private.publications;
create trigger blog_markdown_publication_requires_parser before insert or update on haedo_blog_private.publications
 for each row execute function haedo_blog_private.markdown_publication_requires_parser();

do $$ declare r record; n bigint; h text; begin
 for r in select * from pg_temp.blog_markdown_guard loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',r.relation) into n,h;
  if n is distinct from r.n or h is distinct from r.hash then
   raise exception using errcode='P0001',message='life_post_markdown_guard_mismatch',detail=r.relation;
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
