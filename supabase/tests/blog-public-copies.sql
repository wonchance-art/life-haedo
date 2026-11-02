-- Isolated local PostgreSQL only (blog-bootstrap.sql + blog migrations).
-- 20261102120000_life_blog_public_photo_copies: every published photo, in every
-- format, is a registered public copy (HEIC/HEIF copies come from their view).
-- Synthetic Storage metadata and digests; everything is rolled back. Runs after
-- 20261102110000_life_blog_ai_authorship (production order): the post carries
-- private AI authorship marks that no public snapshot may contain.
begin;
create temporary table blog_copy_results(label text primary key);
create function pg_temp.copy_assert(ok boolean,label text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin if ok is distinct from true then raise exception 'public copy assertion failed: %',label; end if;
 insert into pg_temp.blog_copy_results values(label); end $$;
create function pg_temp.refused(statement text,expected text) returns boolean language plpgsql as $$
begin execute statement; return false;
exception when others then
 if sqlerrm<>expected then raise exception 'expected %, got %',expected,sqlerrm; end if;
 return true;
end $$;
do $copies$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 d jsonb; jpeg jsonb; png jsonb; webp jsonb; heic jsonb; r jsonb; pub jsonb; first jsonb; copies jsonb; tok uuid; media_id text; n integer; path text;
 originals text[]:='{}'; copy_paths text[]:='{}'; item jsonb; ids text[];
begin
 jpeg:=jsonb_build_object('id','jpeg-photo','name','camera-private.jpg','type','image/jpeg','width',4032,'height',3024,'size',101,'digest',repeat('1',64));
 png:=jsonb_build_object('id','png-photo','name','screen-private.png','type','image/png','width',1200,'height',800,'size',102,'digest',repeat('2',64));
 webp:=jsonb_build_object('id','webp-photo','name','edited-private.webp','type','image/webp','width',5000,'height',4000,'size',103,'digest',repeat('3',64));
 heic:=jsonb_build_object('id','heic-photo','name','iphone-private.heic','type','image/heic','width',4032,'height',3024,'size',104,'digest',repeat('4',64),
  'view',jsonb_build_object('type','image/jpeg','size',105,'digest',repeat('5',64),'width',4032,'height',3024));
 d:=jsonb_build_object('format','life-photo-post-v2','id',p::text,'revision',1,'title','사진 네 장','status','saved','replaces',null,
  'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos',jsonb_build_array(jpeg,png,webp,heic),'attachments','[]'::jsonb,'archived',false,
  'ops',jsonb_build_array(jsonb_build_object('insert','AI로 다듬은 문장','attributes',jsonb_build_object('author','ai','bold',true)),
   jsonb_build_object('insert',' 그리고 AI 표시만 있는 문장','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'네 형식\n'),
   jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id','jpeg-photo','caption','JPEG','alt',''))),
   jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id','png-photo','caption','PNG','alt',''))),
   jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id','webp-photo','caption','WebP','alt',''))),
   jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id','heic-photo','caption','HEIC','alt',''))),jsonb_build_object('insert',E'\n')));
 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 for item in select * from jsonb_array_elements(d->'photos') loop
  r:=public.life_blog_prepare_asset(p,item->>'id',item->>'digest',(item->>'size')::bigint,item->>'type',(item->>'width')::integer,(item->>'height')::integer);
  insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',r->>'path',a::text,jsonb_build_object('size',item->'size','mimetype',item->'type'));
  originals:=originals||(r->>'path');
  if item ? 'view' then
   r:=public.life_blog_prepare_asset(p,item->>'id',item->'view'->>'digest',(item->'view'->>'size')::bigint,'image/jpeg',4032,3024);
   insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',r->>'path',a::text,'{"size":105,"mimetype":"image/jpeg"}');
  end if;
 end loop;
 perform pg_temp.copy_assert(public.life_blog_save(w,p,0,gen_random_uuid(),d)='{"status":"stored","revision":1}','the four-format post is stored privately with its originals');

 -- An outdated client asks the earlier RPC to publish a JPEG original.
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0)',p,gen_random_uuid()),'life_blog_public_copy_required'),'the earlier publish RPC refuses a JPEG original without a copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish(%L,1,%L,array[''png-photo''],''{"name":"","intro":""}'',0)',p,gen_random_uuid()),'life_blog_public_copy_required'),'the earlier publish RPC refuses a PNG original without a copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''webp-photo''],''{"name":"","intro":""}'',0,''{}'')',p,gen_random_uuid()),'life_blog_public_copy_required'),'a WebP original without a copy is refused');
 perform pg_temp.copy_assert(public.life_blog_read(p)->'publication'='null'::jsonb,'refused requests leave no publication');

 -- Registering copies.
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish(%L,1,%L,array[''heic-photo''],''{"name":"","intro":""}'',0)',p,gen_random_uuid()),'life_blog_public_copy_required'),'the earlier publish RPC refuses a HEIC photo too (its view is not a public copy)');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''heic-photo'',%L,105,''image/jpeg'',4032,3024)',p,repeat('5',64)),'life_blog_invalid_asset'),'the HEIC view itself cannot be registered as the copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''heic-photo'',%L,50,''image/png'',100,100)',p,repeat('9',64)),'life_blog_invalid_asset'),'a HEIC copy is a JPEG');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''missing'',%L,50,''image/jpeg'',100,100)',p,repeat('6',64)),'life_blog_unknown_photo'),'a copy needs a photo of the stored post');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,50,''image/jpeg'',100,100)',t,repeat('6',64)),'life_blog_unknown_photo'),'a copy needs a stored post');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,101,''image/jpeg'',4032,3024)',p,repeat('1',64)),'life_blog_invalid_asset'),'the original itself cannot be registered as its copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,50,''image/webp'',100,100)',p,repeat('6',64)),'life_blog_invalid_asset'),'copies are JPEG or PNG only');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,50,''image/jpeg'',4033,3024)',p,repeat('6',64)),'life_blog_invalid_asset'),'a copy is never larger than the original');
 r:=public.life_blog_publish_prepare_copy(p,'jpeg-photo',repeat('6',64),61,'image/jpeg',4032,3024);
 perform pg_temp.copy_assert(r->>'bucket'='haedo-blog-originals' and r->'exists'='false' and r->>'path'=a::text||'/'||p::text||'/jpeg-photo/'||repeat('6',64),'a copy gets its own private immutable path');
 path:=r->>'path'; copy_paths:=copy_paths||path;
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,62,''image/jpeg'',4032,3024)',p,repeat('6',64)),'life_blog_asset_mismatch'),'a registered copy cannot change its metadata');
 copies:=jsonb_build_object('jpeg-photo',jsonb_build_object('type','image/jpeg','size',61,'digest',repeat('6',64),'width',4032,'height',3024));
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),copies),'life_blog_assets_incomplete'),'a copy that was never uploaded cannot be published');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',path,a::text,'{"size":61,"mimetype":"image/jpeg"}');
 perform pg_temp.copy_assert((public.life_blog_publish_prepare_copy(p,'jpeg-photo',repeat('6',64),61,'image/jpeg',4032,3024)->>'exists')::boolean,'an uploaded copy is reused');
 r:=public.life_blog_publish_prepare_copy(p,'png-photo',repeat('7',64),62,'image/png',1200,800); copy_paths:=copy_paths||(r->>'path');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',r->>'path',a::text,'{"size":62,"mimetype":"image/png"}');
 r:=public.life_blog_publish_prepare_copy(p,'webp-photo',repeat('8',64),63,'image/jpeg',4096,3277); copy_paths:=copy_paths||(r->>'path');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',r->>'path',a::text,'{"size":63,"mimetype":"image/jpeg"}');
 r:=public.life_blog_publish_prepare_copy(p,'heic-photo',repeat('9',64),64,'image/jpeg',4032,3024); copy_paths:=copy_paths||(r->>'path');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',r->>'path',a::text,'{"size":64,"mimetype":"image/jpeg"}');
 copies:=copies||jsonb_build_object('png-photo',jsonb_build_object('type','image/png','size',62,'digest',repeat('7',64),'width',1200,'height',800),
  'webp-photo',jsonb_build_object('type','image/jpeg','size',63,'digest',repeat('8',64),'width',4096,'height',3277),
  'heic-photo',jsonb_build_object('type','image/jpeg','size',64,'digest',repeat('9',64),'width',4032,'height',3024));

 -- Malformed selections.
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),copies),'life_invalid_request'),'a copy for an unselected photo is refused');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo'',''heic-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),
  copies-'png-photo'-'webp-photo'-'heic-photo'),'life_blog_public_copy_required'),'a HEIC photo without its copy is refused');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''heic-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),
  jsonb_build_object('heic-photo',jsonb_build_object('type','image/jpeg','size',105,'digest',repeat('5',64),'width',4032,'height',3024))),'life_blog_assets_incomplete'),'the HEIC view cannot be named as its copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),
  jsonb_build_object('jpeg-photo',jsonb_set(copies->'jpeg-photo','{digest}',to_jsonb(repeat('1',64))))),'life_blog_assets_incomplete'),'the original digest cannot be named as its copy');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),
  jsonb_build_object('jpeg-photo',(copies->'jpeg-photo')||'{"extra":1}')),'life_invalid_request'),'unknown copy fields are refused');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',0,%L)',p,gen_random_uuid(),
  jsonb_build_object('jpeg-photo',jsonb_set(copies->'jpeg-photo','{size}','99'))),'life_blog_assets_incomplete'),'copy metadata must match the registered copy');

 -- Publishing all four formats.
 r:=public.life_blog_publish_copies(p,1,'00000000-0000-4000-8000-000000000001',array['jpeg-photo','png-photo','webp-photo','heic-photo'],'{"name":"익명","intro":""}',0,copies);
 first:=r; tok:=(r->>'token')::uuid;
 perform pg_temp.copy_assert(r->>'status'='stored' and r->'revision'='1','copies of all four formats publish together');
 perform pg_temp.copy_assert(public.life_blog_publish_copies(p,1,'00000000-0000-4000-8000-000000000001',array['jpeg-photo','png-photo','webp-photo','heic-photo'],'{"name":"익명","intro":""}',0,copies)=first,'a repeated request returns its receipt');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,array[''jpeg-photo'',''png-photo'',''webp-photo'',''heic-photo''],''{"name":"익명","intro":""}'',0,%L)',p,'00000000-0000-4000-8000-000000000001',
  copies-'webp-photo'||jsonb_build_object('webp-photo',copies->'png-photo')),'life_operation_mismatch'),'the receipt covers the named copies');
 execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
 pub:=public.life_blog_public_read(tok);
 select array_agg(x->>'digest' order by o) into ids from jsonb_array_elements(pub->'snapshot'->'photos') with ordinality y(x,o);
 perform pg_temp.copy_assert(ids=array[repeat('6',64),repeat('7',64),repeat('8',64),repeat('9',64)],'the public snapshot names only copy digests, in document order');
 perform pg_temp.copy_assert((select array_agg(x->>'type' order by o) from jsonb_array_elements(pub->'snapshot'->'photos') with ordinality y(x,o))=array['image/jpeg','image/png','image/jpeg','image/jpeg'],'public types are the copy types (WebP became JPEG)');
 perform pg_temp.copy_assert((pub->'snapshot'->'photos'->2->'width')='4096','the public size is the copy size');
 perform pg_temp.copy_assert(position(repeat('1',64) in pub::text)=0 and position(repeat('2',64) in pub::text)=0 and position(repeat('3',64) in pub::text)=0 and position(repeat('4',64) in pub::text)=0
  and position(repeat('5',64) in pub::text)=0,'no original or HEIC view digest is public');
 perform pg_temp.copy_assert(position('private' in pub::text)=0 and position('image/webp' in pub::text)=0 and position('image/heic' in pub::text)=0,'no private file name or original type is public');
 perform pg_temp.copy_assert(not exists(select 1 from jsonb_array_elements(pub->'snapshot'->'ops') o where o->'attributes' ? 'author')
  and position('"ai"' in (pub->'snapshot'->'ops')::text)=0,'a publication with photos carries no AI authorship mark');
 perform pg_temp.copy_assert(pub->'snapshot'->'ops'->0=jsonb_build_object('insert','AI로 다듬은 문장','attributes',jsonb_build_object('bold',true))
  and pub->'snapshot'->'ops'->1=jsonb_build_object('insert',' 그리고 AI 표시만 있는 문장'),'only the author attribute is dropped; other formats and text stay, emptied attributes disappear');
 execute 'set local role service_role';
 n:=0;
 for item in select * from jsonb_array_elements(pub->'snapshot'->'photos') loop
  r:=public.life_blog_public_media(tok,item->>'id');
  if r->>'path'=any(originals) or r ? 'copy' then n:=n+100; end if;
  if r->>'path'=any(copy_paths) then n:=n+1; end if;
 end loop;
 perform pg_temp.copy_assert(n=4,'every public media locator is a registered copy, never an original or view, without the internal marker');
 -- No function can write an active publication whose media are not marked copies.
 execute 'reset role';
 perform pg_temp.copy_assert(pg_temp.refused(format('update haedo_blog_private.publications set media=(select jsonb_object_agg(k,v-''copy'') from jsonb_each(media) e(k,v)) where owner_id=%L and post_id=%L',a,p),'life_blog_public_copy_required'),'an active publication cannot hold unmarked media');
 perform pg_temp.copy_assert(pg_temp.refused(format('update haedo_blog_private.publications set media=media-(select min(k) from jsonb_object_keys(media) k) where owner_id=%L and post_id=%L',a,p),'life_blog_public_copy_required'),'every public photo needs its media entry');
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform pg_temp.copy_assert(pg_temp.refused(format('select haedo_blog_private.publish(%L,1,%L,array[''jpeg-photo''],''{"name":"","intro":""}'',1)',p,gen_random_uuid()),'life_blog_public_copy_required'),'the earlier private publish function cannot publish an original either');
 -- A publication written before this migration (unmarked media) is never served.
 execute 'reset role';
 alter table haedo_blog_private.publications disable trigger blog_publications_copies_only;
 update haedo_blog_private.publications set media=(select jsonb_object_agg(k,v-'copy') from jsonb_each(media) e(k,v)) where owner_id=a and post_id=p;
 execute 'set local role service_role';
 perform pg_temp.copy_assert(public.life_blog_public_media(tok,pub->'snapshot'->'photos'->0->>'id') is null,'unmarked (pre-copy) media is never served');
 execute 'reset role';
 update haedo_blog_private.publications set media=(select jsonb_object_agg(k,v||'{"copy":true}') from jsonb_each(media) e(k,v)) where owner_id=a and post_id=p;
 alter table haedo_blog_private.publications enable trigger blog_publications_copies_only;

 -- Owner boundaries.
 execute 'set local role anon';
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,61,''image/jpeg'',4032,3024)',p,repeat('9',64)),'permission denied for function life_blog_publish_prepare_copy'),'anonymous callers cannot register copies');
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_copies(%L,1,%L,''{}'',''{"name":"","intro":""}'',1,''{}'')',p,gen_random_uuid()),'permission denied for function life_blog_publish_copies'),'anonymous callers cannot publish');
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,61,''image/jpeg'',4032,3024)',p,repeat('9',64)),'life_blog_unknown_photo'),'another account cannot register a copy of this post');

 -- Updating keeps the URL; a text-only request still uses the earlier RPC.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 r:=public.life_blog_publish(p,1,'00000000-0000-4000-8000-000000000002','{}','{"name":"익명","intro":"글만"}',1);
 perform pg_temp.copy_assert(r->>'token'=tok::text and r->'revision'='2','the earlier RPC still publishes text and keeps the URL');
 execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
 pub:=public.life_blog_public_read(tok);
 perform pg_temp.copy_assert(jsonb_array_length(pub->'snapshot'->'photos')=0 and not exists(select 1 from jsonb_array_elements(pub->'snapshot'->'ops') o where o->'attributes' ? 'author'),
  'a text-only publication through the earlier RPC carries no AI authorship mark');
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform pg_temp.copy_assert(public.life_blog_read(p)->'data'->'ops'->0->'attributes'->>'author'='ai','the private copy keeps its AI mark');
 perform pg_temp.copy_assert(public.life_blog_publish_copies(p,1,'00000000-0000-4000-8000-000000000002','{}','{"name":"익명","intro":"글만"}',1,'{}')=r,'without copies both RPCs share one receipt format');

 -- Withdrawal and deletion include the copies.
 perform pg_temp.copy_assert(public.life_blog_unpublish(p,2,gen_random_uuid())->>'status'='stored','withdrawal');
 execute 'set local role service_role';
 perform pg_temp.copy_assert(public.life_blog_public_media(tok,pub->'snapshot'->'photos'->0->>'id') is null,'a withdrawn copy no longer resolves');
 execute 'set local role authenticated';
 r:=public.life_blog_delete(p,1);
 perform pg_temp.copy_assert(r->>'status'='deleted' and (select array_agg(x order by x) from jsonb_array_elements_text(r->'paths') x)=(select array_agg(x order by x) from unnest(originals||copy_paths||array[a::text||'/'||p::text||'/heic-photo/'||repeat('5',64)]) x),'deleting the post releases originals, view and copies together');
 execute 'reset role';
 select count(*) into n from haedo_blog_private.assets where owner_id=a and public_copy and deleted_at is not null;
 perform pg_temp.copy_assert(n=4,'copies are marked deletable with the post');
 execute 'set local role authenticated';
 perform pg_temp.copy_assert(pg_temp.refused(format('select public.life_blog_publish_prepare_copy(%L,''jpeg-photo'',%L,61,''image/jpeg'',4032,3024)',p,repeat('6',64)),'life_blog_unknown_photo'),'a deleted post cannot receive copies');
 execute 'reset role';
end $copies$;
-- Catalog: the new API is invoker-only and owner-only; the resolver is server-only.
do $catalog$ begin
 perform pg_temp.copy_assert(has_function_privilege('authenticated','public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','execute')
  and not has_function_privilege('anon','public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','execute')
  and has_function_privilege('authenticated','public.life_blog_publish_prepare_copy(uuid,text,text,bigint,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.life_blog_publish_prepare_copy(uuid,text,text,bigint,text,integer,integer)','execute'),'copy RPCs are owner-only');
 perform pg_temp.copy_assert((select count(*)=3 and bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('life_blog_publish','life_blog_publish_copies','life_blog_publish_prepare_copy')),'publication wrappers are security invoker');
 perform pg_temp.copy_assert(has_function_privilege('service_role','public.life_blog_public_media(uuid,text)','execute') and not has_function_privilege('anon','public.life_blog_public_media(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.life_blog_public_media(uuid,text)','execute'),'the media resolver stays server-only');
 perform pg_temp.copy_assert(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='haedo_blog_private' and p.proname='public_media' and p.prosrc like '%''copy''%'),'the resolver requires the copy marker');
 perform pg_temp.copy_assert(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='life_blog_publish' and p.prosrc like '%publish_copies%'),'the earlier RPC delegates to the copy-only publisher');
 perform pg_temp.copy_assert(exists(select 1 from pg_trigger where tgrelid='haedo_blog_private.publications'::regclass and tgname='blog_publications_copies_only' and tgenabled='O'),'the copies-only publication trigger is enabled');
end $catalog$;
select jsonb_build_object('passed',count(*),'failures',0,'scope','isolated PostgreSQL public photo copies') as result from blog_copy_results;
rollback;
