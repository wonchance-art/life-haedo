-- 해도 2026-11-02 AI 글 표시 서버 검증 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-blog-ai-authorship-install.mjs — 직접 고치지 말고 원본 마이그레이션을 고친 뒤 다시 생성한다.
-- 포함 마이그레이션(순서, 원본 sha256):
--   20261102110000_life_blog_ai_authorship.sql  961c4197103a66dc67a06d745b7be0ccd00ebdcd08a4966b4ba0a58d9572de49
--
-- 선행 조건: 20261101-account-sync-install.sql이 적용되어 있어야 한다. 그 설치를 다시 실행하면
-- 같은 두 함수가 이전 정의로 돌아가므로 이 설치도 다시 실행한다.
-- 클라이언트(AI 글 표시를 쓰는 앱 버전)를 배포하기 전에 적용한다.
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. 어느 단계에서 실패하면 전체가 되돌려진다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다. 저장된 글은 고치지 않는다.
--   * 바꾸기 전에 두 함수의 현재 본문(prosrc) md5가 저장소의 20261101091500_life_blog_account_sync.sql 정의 또는
--     이 설치의 정의(다시 실행)와 같은지 확인하고, 다르면 아무것도 바꾸지 않고 멈춘다.
--   * 다시 실행해도 된다(create or replace).
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true인지 확인한다.

do $haedo_install$
declare
  r record;
  n bigint;
  h text;
  before jsonb := '{}'::jsonb;
begin
  if to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)') is null
     or to_regprocedure('haedo_blog_private.photo_media(jsonb)') is null then
    raise exception 'apply 20261101-account-sync-install.sql first';
  end if;
  select md5(prosrc) into h from pg_proc where oid = to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)');
  if h is null or h not in ('012fb393a74efdd11b01ae1d7dd67141', 'da3cbe336718c99fe3601ff518422555') then
    raise exception 'haedo_blog_private.valid_document differs from the repository definition (md5 %); nothing was changed', coalesce(h, 'missing');
  end if;
  select md5(prosrc) into h from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)');
  if h is null or h not in ('ea61d16bf42dac05db310019e965523a', '17bb2aa6befed545e6cf33158c7c2b06') then
    raise exception 'haedo_blog_private.publish differs from the repository definition (md5 %); nothing was changed', coalesce(h, 'missing');
  end if;
  for r in
    select format('%I.%I', ns.nspname, c.relname) as relation
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\_%' or (ns.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before := before || jsonb_build_object(r.relation, n);
  end loop;

  -- ===== 20261102110000_life_blog_ai_authorship.sql =====
  execute $haedo_m1$
-- Private AI authorship marks in blog documents (2026-11-02, writing-ai-review 묶음 A).
-- The editor may mark text the owner brought from an AI tool with the Delta
-- attribute author:"ai". Redefines, without rewriting any stored document:
--  * valid_document: also accepts author="ai" on string inserts only. Every
--    other check is the 20261101091500 definition, character for character.
--  * publish: the public snapshot drops the author attribute (owner decision
--    2026-11-02: public posts never show AI marks); everything else unchanged.
-- Existing documents without the attribute are validated and published exactly
-- as before. Apply before deploying a client that writes the attribute.

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

notify pgrst,'reload schema';
$haedo_m1$;

  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if not haedo_blog_private.valid_document(jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\n'))), '00000000-0000-4000-8000-000000000001') then
    raise exception 'valid_document does not accept author=ai text';
  end if;
  if haedo_blog_private.valid_document(jsonb_set(jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\n'))), '{ops,0,attributes,author}', '"human"'), '00000000-0000-4000-8000-000000000001') then
    raise exception 'valid_document accepts an unknown author value';
  end if;
  raise notice 'haedo blog AI authorship installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'author=ai text accepted' as check_name,
       haedo_blog_private.valid_document(jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\n'))), '00000000-0000-4000-8000-000000000001') as ok
union all
select 'other author values rejected',
       not haedo_blog_private.valid_document(jsonb_set(jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\n'))), '{ops,0,attributes,author}', '"human"'), '00000000-0000-4000-8000-000000000001')
union all
select 'documents without marks still accepted',
       haedo_blog_private.valid_document(jsonb_set(jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\n'))), '{ops,0}', '{"insert":"AI"}'), '00000000-0000-4000-8000-000000000001')
union all
select 'publish drops the private mark',
       coalesce((select prosrc like '%(op->''attributes'')-''author''%' from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')), false)
union all
select 'anon cannot execute valid_document',
       not has_function_privilege('anon', 'haedo_blog_private.valid_document(jsonb,uuid)', 'execute');
