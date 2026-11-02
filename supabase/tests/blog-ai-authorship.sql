-- Isolated local PostgreSQL only. Synthetic anonymous documents; everything is rolled back.
-- Private AI authorship marks (20261102110000_life_blog_ai_authorship.sql):
-- valid_document accepts author="ai" on text only, and the public snapshot
-- built by publish never carries the mark. Sets both JWT settings so it runs on
-- supabase/tests/blog-bootstrap.sql and on the replay stub (tests/helpers/supabase-pg-stub.cjs).
begin;
create temporary table blog_ai_results(label text primary key);
create function pg_temp.ai_assert(ok boolean,label text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin if ok is distinct from true then raise exception 'blog AI authorship assertion failed: %',label; end if;
 insert into pg_temp.blog_ai_results values(label); end $$;
do $tests$
declare a uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
 d jsonb; marked jsonb; plain jsonb; photo jsonb; r jsonb; pub jsonb; ops jsonb; stored jsonb;
begin
 d:=jsonb_build_object('format','life-photo-post-v2','id',p::text,'revision',1,'title','익명 AI 표시 글','status','saved','replaces',null,
  'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z',
  'ops',jsonb_build_array(jsonb_build_object('insert',E'내가 쓴 문장 🌱\n')),'photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false);
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(d,p),'a document without marks validates as before');
 marked:=jsonb_set(d,'{ops}',jsonb_build_array(
  jsonb_build_object('insert','내가 쓴 앞 문장. '),
  jsonb_build_object('insert','AI가 제안한 문장.','attributes',jsonb_build_object('author','ai')),
  jsonb_build_object('insert',' 굵은 AI 문장','attributes',jsonb_build_object('author','ai','bold',true)),
  jsonb_build_object('insert',E' 끝\n')));
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(marked,p),'author=ai on text validates');
 perform pg_temp.ai_assert(haedo_blog_private.valid_document((marked-'attachments'-'archived')||'{"format":"life-photo-post-v1"}',p),'author=ai validates in the v1 format too');
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(jsonb_set(d,'{ops}',jsonb_build_array(jsonb_build_object('insert',E'줄\n','attributes',jsonb_build_object('author','ai')))),p),'author=ai on a text insert with a newline validates');
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(marked||'{"status":"draft"}',p),'a marked draft validates for device sync');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes,author}','"human"'),p),'an unknown author value is rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes,author}','"AI"'),p),'author values are case-exact');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes,author}','true'),p),'a boolean author is rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes,author}','null'),p),'a null author is rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes,author}','{"by":"ai"}'),p),'an object author is rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes}','{"author":"ai","color":"red"}'),p),'unknown attributes beside author are still rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(marked,'{ops,1,attributes}','{"author":"ai","link":"javascript:alert(1)"}'),p),'script links beside author are still rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(d,'{ops}','[{"insert":"unsafe\n","attributes":{"link":"javascript:alert(1)"}}]'),p),'script links are still rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(d,'{ops}','[{"insert":{"html":"<script>bad</script>"}}]'),p),'HTML embeds are still rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(d,'{ops}','[{"insert":"x\n","attributes":{"header":3}}]'),p),'other format values are still rejected');
 photo:=jsonb_build_object('id','local-photo-one','name','private-filename-one.png','type','image/png','width',40,'height',30,'size',5,'digest',repeat('a',64));
 r:=jsonb_set(jsonb_set(d,'{photos}',jsonb_build_array(photo)),'{ops}',jsonb_build_array(jsonb_build_object('insert',E'사진 앞\n'),
  jsonb_build_object('insert',jsonb_build_object('photo',jsonb_build_object('id','local-photo-one','caption','설명','alt','대체'))),jsonb_build_object('insert',E'끝\n')));
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(r,p),'the photo fixture validates without a mark');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(r,'{ops,1,attributes}','{"author":"ai"}'),p),'author on a photo embed is rejected');
 perform pg_temp.ai_assert(not haedo_blog_private.valid_document(jsonb_set(r,'{ops,1,attributes}','{"author":"ai","align":"center"}'),p),'author on a photo embed is rejected beside an allowed format');
 perform pg_temp.ai_assert(haedo_blog_private.valid_document(jsonb_set(r,'{ops,1,attributes}','{"align":"center"}'),p),'existing photo formats keep validating');

 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 r:=public.life_blog_save(w,p,0,gen_random_uuid(),marked);
 perform pg_temp.ai_assert(r='{"status":"stored","revision":1}','a marked post is stored through the owner RPC');
 stored:=public.life_blog_read(p)->'data';
 perform pg_temp.ai_assert(stored=marked,'the private copy keeps every mark exactly');
 r:=public.life_blog_publish(p,1,gen_random_uuid(),'{}','{"name":"익명","intro":""}',0);
 perform pg_temp.ai_assert(r->>'status'='stored','the marked post publishes');
 execute 'set local role anon';
 perform set_config('request.jwt.claims','{}',true); perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','anon',true);
 pub:=public.life_blog_public_read((r->>'token')::uuid);
 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',a::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
 ops:=pub->'snapshot'->'ops';
 perform pg_temp.ai_assert(not exists(select 1 from jsonb_array_elements(ops) j where j ? 'attributes' and j->'attributes' ? 'author'),'the public snapshot carries no author mark');
 perform pg_temp.ai_assert(ops=jsonb_build_array(
  jsonb_build_object('insert','내가 쓴 앞 문장. '),
  jsonb_build_object('insert','AI가 제안한 문장.'),
  jsonb_build_object('insert',' 굵은 AI 문장','attributes',jsonb_build_object('bold',true)),
  jsonb_build_object('insert',E' 끝\n')),'public text and other formats are unchanged; an emptied attribute map is removed');
 perform pg_temp.ai_assert((select string_agg(j->>'insert','') from jsonb_array_elements(ops) j)=(select string_agg(j->>'insert','') from jsonb_array_elements(marked->'ops') j),'public text is identical to the private text');
 perform pg_temp.ai_assert(public.life_blog_read(p)->'data'=marked,'publishing does not rewrite the private copy');

 plain:=d||jsonb_build_object('id',q::text);
 r:=public.life_blog_save(w,q,0,gen_random_uuid(),plain);
 perform pg_temp.ai_assert(r='{"status":"stored","revision":1}','an unmarked post is stored as before');
 r:=public.life_blog_publish(q,1,gen_random_uuid(),'{}','{"name":"익명","intro":""}',0);
 execute 'set local role anon';
 perform set_config('request.jwt.claims','{}',true); perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','anon',true);
 pub:=public.life_blog_public_read((r->>'token')::uuid);
 perform pg_temp.ai_assert(pub->'snapshot'->'ops'=plain->'ops','an unmarked post publishes the same ops as before');
 execute 'reset role';
end $tests$;
select jsonb_build_object('passed',count(*),'failures',0,'scope','isolated PostgreSQL: AI authorship validation and public projection') as result from blog_ai_results;
rollback;
