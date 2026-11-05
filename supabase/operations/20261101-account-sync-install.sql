-- 해도 2026-11-01 계정 자동 연동 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-account-sync-install.mjs — 원본 이력은 유지하고 생성기로 다시 만든다.
-- 포함 마이그레이션(순서, 원본 sha256):
--   20261101090000_life_account_documents.sql  6f23c9ca735fab92920c7350b31949cb6bdc2df921ead3655802566c3e6be47c
--   20261101091500_life_blog_account_sync.sql  97f406bc2de9c02ba20397c1805a8c39d89ac20cfe4fc9c344df75e921b4c608
--   20261101130000_life_material_tombstones.sql  f9c403484c25fdb83f8dc274c5728780d732ba94372a32d454147b44a65a0335
--   20261101140000_life_sync_edit_times.sql  2d282cf816bd0dfc80bdbb2c290b28f326551bf29a0e8055a5be88420499a0fe
--   20261101150000_life_account_documents_owner_lock.sql  eab39fa5196269796dd9f164e66b33d84cba5e5a393bf39ac86d356e44f0f0d3
--   20261101160000_life_blog_delete_guard.sql  b10dc40f9b7136b81dc7450c6e4e40c60a8e09d9e4317cb3d0d255d463da833c
--
-- 후속 Markdown 보존 기준: 20261105051632_life_post_markdown.sql  f4860de28a2010fb90257c3ce587a526c334ef4306d841110705708150edfb62
-- D2가 설치되어 있으면 검증된 두 함수 정의를 같은 DO 문 안에서 보존한다.
-- D2 미설치에서는 검증된 원본·계정·AI 정의만 원래 경로로 설치한다(새 helper 불필요).
-- 이 세 이전 판과 다른 함수 본문은 설치 전에 거부한다.
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. SQL Editor가 문장을 어떤 연결·트랜잭션으로
--     나눠 실행하든, 어느 단계에서 실패하면 그 문장 전체가 되돌려져 아무것도 바뀌지 않는다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다(설치 중 새로 만든 테이블은 비교에서 제외).
--   * 함수 밖에서 바뀌는 설정은 haedo-blog-originals 버킷의 허용 형식에 HEIC/HEIF를 더하는 것뿐이다.
--   * 다시 실행해도 된다(if not exists / create or replace / drop ... if exists).
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true인지 확인한다.

do $haedo_install$
declare
  r record;
  n bigint;
  before jsonb := '{}'::jsonb;
  markdown_definitions jsonb := '{}'::jsonb;
begin
  if to_regprocedure('haedo_blog_private.valid_delta_document(jsonb,uuid)') is not null
    or to_regprocedure('haedo_blog_private.markdown_no_downgrade()') is not null
    or to_regprocedure('haedo_blog_private.markdown_publication_requires_parser()') is not null
    or (select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)')) = '88dd7c33d2a5ad4d0eed2bd708cfd77d'
    or (select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')) = 'd872bf11fc983b14e4d61ff36be6932d'
  then
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.valid_delta_document(jsonb,uuid)')) is distinct from 'da3cbe336718c99fe3601ff518422555' then
      raise exception 'haedo_blog_private.valid_delta_document differs from the repository definition; nothing was changed';
    end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)')) is distinct from '88dd7c33d2a5ad4d0eed2bd708cfd77d' then
      raise exception 'haedo_blog_private.valid_document differs from the repository definition; nothing was changed';
    end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')) is distinct from 'd872bf11fc983b14e4d61ff36be6932d' then
      raise exception 'haedo_blog_private.publish differs from the repository definition; nothing was changed';
    end if;
    markdown_definitions := markdown_definitions || jsonb_build_object('valid_document', pg_get_functiondef(to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)')));
    markdown_definitions := markdown_definitions || jsonb_build_object('publish', pg_get_functiondef(to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')));
  else
    -- A genuinely pre-D2 database still has to match a reviewed predecessor.
    -- An unknown operator edit is not permission to reinstall an older body.
    if not coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)')) in ('8cce35f9914421fa48e6f11d2d792156', '012fb393a74efdd11b01ae1d7dd67141', 'da3cbe336718c99fe3601ff518422555'), false) then
      raise exception 'haedo_blog_private.valid_document differs from the repository definition; nothing was changed';
    end if;
    if not coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')) in ('a16a40d5de9446ba841a76a4300980d0', 'ea61d16bf42dac05db310019e965523a', '17bb2aa6befed545e6cf33158c7c2b06'), false) then
      raise exception 'haedo_blog_private.publish differs from the repository definition; nothing was changed';
    end if;
  end if;
  for r in
    select format('%I.%I', ns.nspname, c.relname) as relation
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\_%' or (ns.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before := before || jsonb_build_object(r.relation, n);
  end loop;

  -- ===== 20261101090000_life_account_documents.sql =====
  execute $haedo_m1$
-- Small per-account documents that every signed-in device of the same owner
-- replicates automatically (settings, reading position, plans, drafts, ...).
-- Sync is not publication: nothing here is readable by anyone but the owner.
-- Run as the project administrator. Idempotent; requires the Auth schema.

-- Count compact JSON (JSON.stringify bytes), not JSONB display spacing, so the
-- client and server agree on the 2 MiB limit.
create or replace function public.life_account_document_json_bytes(p_value jsonb)
returns bigint language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_result bigint; v_count bigint;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(sum(octet_length(convert_to(to_jsonb(key)::text,'UTF8'))+1+public.life_account_document_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_each(p_value);
      return 2+v_result+greatest(v_count-1,0);
    when 'array' then
      select coalesce(sum(public.life_account_document_json_bytes(value)),0),count(*)
        into v_result,v_count from jsonb_array_elements(p_value);
      return 2+v_result+greatest(v_count-1,0);
    else return octet_length(convert_to(p_value::text,'UTF8'));
  end case;
end;
$function$;
revoke all on function public.life_account_document_json_bytes(jsonb) from public, anon, authenticated;

create table if not exists public.life_account_documents (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_key text not null check (char_length(doc_key) between 1 and 512 and doc_key !~ '[[:cntrl:]]'),
  revision bigint not null check (revision between 1 and 9007199254740991),
  data jsonb,
  deleted boolean not null default false,
  client_updated_at timestamptz,
  seq bigint generated always as identity,
  updated_at timestamptz not null default now(),
  primary key (owner_id, doc_key),
  constraint life_account_document_state check ((deleted and data is null) or (not deleted and data is not null))
);
create index if not exists life_account_documents_owner_seq on public.life_account_documents(owner_id, seq);

create table if not exists public.life_account_document_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  doc_key text not null,
  request_hash bytea not null check (octet_length(request_hash)=32),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

alter table public.life_account_documents enable row level security;
alter table public.life_account_document_receipts enable row level security;
revoke all on table public.life_account_documents, public.life_account_document_receipts from public, anon, authenticated;
grant select on table public.life_account_documents to authenticated;
drop policy if exists life_account_documents_owner_select on public.life_account_documents;
create policy life_account_documents_owner_select on public.life_account_documents
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.life_account_document_put(
  p_doc_key text, p_expected_revision bigint, p_operation_id uuid, p_data jsonb,
  p_deleted boolean default false, p_client_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_hash bytea; v_receipt public.life_account_document_receipts%rowtype;
  v_row public.life_account_documents%rowtype; v_revision bigint; v_seq bigint; v_result jsonb;
  v_deleted boolean := coalesce(p_deleted, false);
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_account_document_auth_required'; end if;
  if p_doc_key is null or char_length(p_doc_key) not between 1 and 512 or p_doc_key ~ '[[:cntrl:]]'
    or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991
    or (v_deleted and p_data is not null) or (not v_deleted and p_data is null) then
    raise exception using errcode='22023', message='life_account_document_invalid_request';
  end if;
  -- A cheap bound first; the exact compact size is checked after it.
  if p_data is not null and (octet_length(convert_to(p_data::text,'UTF8')) > 4194304
    or public.life_account_document_json_bytes(p_data) > 2097152) then
    raise exception using errcode='22001', message='life_account_document_too_large';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_doc_key,p_expected_revision,p_data,v_deleted,p_client_updated_at)::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('life_account_document:' || v_owner::text || ':' || p_doc_key,0));
  select * into v_receipt from public.life_account_document_receipts
    where owner_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode='22023', message='life_account_document_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;
  select * into v_row from public.life_account_documents where owner_id=v_owner and doc_key=p_doc_key for update;
  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object('status','conflict','revision',0,'seq',null,'current',null);
    end if;
    v_revision := 1;
    insert into public.life_account_documents(owner_id,doc_key,revision,data,deleted,client_updated_at,updated_at)
      values(v_owner,p_doc_key,v_revision,p_data,v_deleted,p_client_updated_at,clock_timestamp())
      returning seq into v_seq;
  else
    if v_row.revision <> p_expected_revision then
      return jsonb_build_object('status','conflict','revision',v_row.revision,'seq',v_row.seq,
        'current',jsonb_build_object('revision',v_row.revision,'data',v_row.data,'deleted',v_row.deleted,
          'client_updated_at',v_row.client_updated_at));
    end if;
    if v_row.revision >= 9007199254740991 then
      raise exception using errcode='22003', message='life_account_document_revision_limit';
    end if;
    v_revision := v_row.revision+1;
    -- DEFAULT on an identity column takes the next sequence value, so every
    -- write moves the document behind the readers' change cursors.
    update public.life_account_documents set revision=v_revision,data=p_data,deleted=v_deleted,
      client_updated_at=p_client_updated_at,seq=default,updated_at=clock_timestamp()
      where owner_id=v_owner and doc_key=p_doc_key returning seq into v_seq;
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision,'seq',v_seq);
  insert into public.life_account_document_receipts(owner_id,operation_id,doc_key,request_hash,result)
    values(v_owner,p_operation_id,p_doc_key,v_hash,v_result);
  return v_result;
end;
$function$;

-- Changes after a cursor, oldest first. A page stops early near 8 MiB so a
-- device catching up on many large drafts never asks for one huge response.
create or replace function public.life_account_document_changes(p_after_seq bigint, p_limit integer default 200)
returns table(doc_key text, revision bigint, data jsonb, deleted boolean, client_updated_at timestamptz, seq bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog
as $function$
declare v_owner uuid := auth.uid(); v_row record; v_bytes bigint := 0; v_count integer := 0;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_account_document_auth_required'; end if;
  if p_after_seq is null or p_after_seq < 0 or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode='22023', message='life_account_document_invalid_request';
  end if;
  for v_row in select d.doc_key,d.revision,d.data,d.deleted,d.client_updated_at,d.seq,d.updated_at
    from public.life_account_documents d where d.owner_id=v_owner and d.seq>p_after_seq order by d.seq limit p_limit loop
    v_bytes := v_bytes + coalesce(octet_length(convert_to(v_row.data::text,'UTF8')),0);
    exit when v_count > 0 and v_bytes > 8388608;
    doc_key := v_row.doc_key; revision := v_row.revision; data := v_row.data; deleted := v_row.deleted;
    client_updated_at := v_row.client_updated_at; seq := v_row.seq; updated_at := v_row.updated_at;
    v_count := v_count + 1;
    return next;
  end loop;
end;
$function$;

revoke all on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.life_account_document_changes(bigint,integer) from public, anon, authenticated;
grant execute on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) to authenticated;
grant execute on function public.life_account_document_changes(bigint,integer) to authenticated;
notify pgrst,'reload schema';
$haedo_m1$;

  -- ===== 20261101091500_life_blog_account_sync.sql =====
  execute $haedo_m2$
-- Account-wide blog sync (2026-11-01 owner directive): every saved post and
-- draft of the signed-in owner is kept on all of their devices. Extends
-- 20261017144744_life_blog_originals without rewriting stored documents.
--  * documents may be drafts; drafts are never listed, read or published publicly
--  * HEIC/HEIF originals carry a required JPEG view rendition (separate asset)
--  * an owner can delete a private post; its originals become removable through
--    the Storage API only after that deletion (RLS on the exact deleted path)

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
$haedo_m2$;

  -- ===== 20261101130000_life_material_tombstones.sql =====
  execute $haedo_m3$
-- Preparation deletions reach every signed-in device. A deleted head stays as a tombstone (revision kept, data retained server-side for the immutable-version checks) and is no longer listed; get returns {id,revision,deleted,updated_at}. A later put with the tombstone revision revives it, so a device with unsent edits recreates instead of dropping.
alter table haedo_material_private.heads add column if not exists deleted_at timestamptz;

-- Any revision advance that does not itself mark a deletion revives the head.
create or replace function haedo_material_private.revive() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if old.deleted_at is not null and new.deleted_at is not distinct from old.deleted_at and new.revision>old.revision then new.deleted_at:=null; end if;
 return new;
end $$;
drop trigger if exists material_heads_revive on haedo_material_private.heads;
create trigger material_heads_revive before update on haedo_material_private.heads for each row execute function haedo_material_private.revive();

create or replace function haedo_material_private.get(p_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); result jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if p_id is null then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 select case when deleted_at is null then jsonb_build_object('id',id,'revision',revision,'data',data,'updated_at',updated_at)
  else jsonb_build_object('id',id,'revision',revision,'deleted',true,'updated_at',updated_at) end
  into result from haedo_material_private.heads where owner_id=owner and id=p_id;
 return result;
end $$;

create or replace function haedo_material_private.list(p_after_updated_at timestamptz default null,p_after_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); items jsonb; next_cursor jsonb; extra boolean;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if (p_after_updated_at is null)<>(p_after_id is null) or p_after_updated_at is not null and not isfinite(p_after_updated_at) then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 with rows as (select id,revision,data#>>'{plan,title}' title,updated_at from haedo_material_private.heads
  where owner_id=owner and deleted_at is null and (p_after_updated_at is null or (updated_at,id)<(p_after_updated_at,p_after_id)) order by updated_at desc,id desc limit 21),
 numbered as(select *,row_number() over(order by updated_at desc,id desc) n from rows)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'title',title,'updated_at',updated_at) order by updated_at desc,id desc) filter(where n<=20),'[]'::jsonb),bool_or(n=21) into items,extra from numbered;
 if coalesce(extra,false) then next_cursor:=jsonb_build_object('updated_at',items#>>'{19,updated_at}','id',items#>>'{19,id}'); else next_cursor:=null; end if;
 return jsonb_build_object('items',items,'next',next_cursor);
end $$;

-- Compare-and-delete with the same operation receipts as put. 'missing' when no live head exists.
create or replace function haedo_material_private.remove(p_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); digest bytea; receipt haedo_material_private.receipts%rowtype; head haedo_material_private.heads%rowtype; result jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=9007199254740991 then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 digest:=sha256(convert_to(jsonb_build_array('delete',p_expected_revision)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('haedo-material:'||owner::text||':'||p_id::text,0));
 select * into head from haedo_material_private.heads where owner_id=owner and id=p_id for update;
 select * into receipt from haedo_material_private.receipts where owner_id=owner and id=p_id and operation_id=p_operation_id;
 if found then
  if receipt.request_hash<>digest then raise exception using errcode='22023',message='life_material_operation_mismatch'; end if;
  return receipt.result;
 end if;
 if head.id is null or head.deleted_at is not null then return jsonb_build_object('status','missing','revision',coalesce(head.revision,0)); end if;
 if head.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',head.revision); end if;
 result:=jsonb_build_object('status','deleted','revision',p_expected_revision+1);
 update haedo_material_private.heads set revision=p_expected_revision+1,deleted_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
  where owner_id=owner and id=p_id;
 insert into haedo_material_private.receipts values(owner,p_id,p_operation_id,digest,result);
 return result;
end $$;

create or replace function public.life_material_delete(p_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_material_private.remove(p_id,p_operation_id,p_expected_revision)$$;
revoke all on function haedo_material_private.revive(),haedo_material_private.remove(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.life_material_delete(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.life_material_delete(uuid,uuid,bigint) to authenticated;
grant execute on function haedo_material_private.remove(uuid,uuid,bigint),haedo_material_private.get(uuid),haedo_material_private.list(timestamptz,uuid) to authenticated;
notify pgrst, 'reload schema';
$haedo_m3$;

  -- ===== 20261101140000_life_sync_edit_times.sql =====
  execute $haedo_m4$
-- Compositions and library metadata may carry the writing device's local edit time (top-level "editedAt", an exact ISO-8601 UTC millisecond string) so automatic latest-wins conflict handling compares edit times, not upload times. The content validators are unchanged: the edit time is validated and removed before them. Clients fall back to sending without it while this migration is not installed.

-- Keep the existing composition validator body as the content check.
do $$
begin
 if to_regprocedure('public.life_composition_valid_content(jsonb)') is null then
  alter function public.life_composition_valid(jsonb) rename to life_composition_valid_content;
 end if;
end $$;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p_data)='object'
  and (not (p_data ? 'editedAt') or public.life_library_date(p_data->'editedAt'))
  and public.life_composition_valid_content(p_data - 'editedAt'),false)
$$;
revoke all on function public.life_composition_valid(jsonb),public.life_composition_valid_content(jsonb) from public,anon,authenticated;

-- The table check referenced the renamed function by identity; point it at the wrapper.
alter table public.life_compositions drop constraint if exists life_composition_state;
alter table public.life_compositions add constraint life_composition_state check (
 public.life_composition_valid(data) and (data ->> 'workspaceId') is not distinct from workspace_id::text);

create or replace function public.life_library_meta_valid(v jsonb,w uuid,bundle jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='object'
 and (not (v ? 'editedAt') or public.life_library_date(v->'editedAt'))
 and public.life_library_fields(v - 'editedAt',array['format','workspaceId','revision','sourceFolders','collection','nineBoard'])
 and v->>'format'='life-library-meta-v1' and v->>'workspaceId'=w::text
 and public.life_library_integer(v->'revision',0,9007199254740991)
 and public.life_library_folders_valid(v->'sourceFolders',w)
 and public.life_library_collection_valid(v->'collection',w)
 and public.life_library_nine_valid(v->'nineBoard',w,bundle)
 and public.life_composition_json_bytes(v)<=8388608,false)
$$;

notify pgrst, 'reload schema';
$haedo_m4$;

  -- ===== 20261101150000_life_account_documents_owner_lock.sql =====
  execute $haedo_m5$
-- Owner-level ordering for life_account_document_put (follows 20261101090000).
-- Before this, puts of different keys of one owner held different advisory
-- locks: a put could take a seq, commit after a later seq became visible, and a
-- change cursor read between them skipped it. Idempotent; run as administrator.

create or replace function public.life_account_document_put(
  p_doc_key text, p_expected_revision bigint, p_operation_id uuid, p_data jsonb,
  p_deleted boolean default false, p_client_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_owner uuid := auth.uid(); v_hash bytea; v_receipt public.life_account_document_receipts%rowtype;
  v_row public.life_account_documents%rowtype; v_revision bigint; v_seq bigint; v_result jsonb;
  v_deleted boolean := coalesce(p_deleted, false);
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
  if v_owner is null then raise exception using errcode='42501', message='life_account_document_auth_required'; end if;
  if p_doc_key is null or char_length(p_doc_key) not between 1 and 512 or p_doc_key ~ '[[:cntrl:]]'
    or p_operation_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision > 9007199254740991
    or (v_deleted and p_data is not null) or (not v_deleted and p_data is null) then
    raise exception using errcode='22023', message='life_account_document_invalid_request';
  end if;
  -- A cheap bound first; the exact compact size is checked after it.
  if p_data is not null and (octet_length(convert_to(p_data::text,'UTF8')) > 4194304
    or public.life_account_document_json_bytes(p_data) > 2097152) then
    raise exception using errcode='22001', message='life_account_document_too_large';
  end if;
  v_hash := sha256(convert_to(jsonb_build_array(p_doc_key,p_expected_revision,p_data,v_deleted,p_client_updated_at)::text,'UTF8'));
  -- One lock per owner (not per key): a later put of any key waits until this
  -- one commits, so per owner the seq order equals commit order and a change
  -- cursor can never move past a lower seq that becomes visible later.
  perform pg_advisory_xact_lock(hashtextextended('life_account_document_owner:' || v_owner::text,0));
  select * into v_receipt from public.life_account_document_receipts
    where owner_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode='22023', message='life_account_document_operation_mismatch';
    end if;
    return v_receipt.result;
  end if;
  select * into v_row from public.life_account_documents where owner_id=v_owner and doc_key=p_doc_key for update;
  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object('status','conflict','revision',0,'seq',null,'current',null);
    end if;
    v_revision := 1;
    insert into public.life_account_documents(owner_id,doc_key,revision,data,deleted,client_updated_at,updated_at)
      values(v_owner,p_doc_key,v_revision,p_data,v_deleted,p_client_updated_at,clock_timestamp())
      returning seq into v_seq;
  else
    if v_row.revision <> p_expected_revision then
      return jsonb_build_object('status','conflict','revision',v_row.revision,'seq',v_row.seq,
        'current',jsonb_build_object('revision',v_row.revision,'data',v_row.data,'deleted',v_row.deleted,
          'client_updated_at',v_row.client_updated_at));
    end if;
    if v_row.revision >= 9007199254740991 then
      raise exception using errcode='22003', message='life_account_document_revision_limit';
    end if;
    v_revision := v_row.revision+1;
    -- DEFAULT on an identity column takes the next sequence value, so every
    -- write moves the document behind the readers' change cursors.
    update public.life_account_documents set revision=v_revision,data=p_data,deleted=v_deleted,
      client_updated_at=p_client_updated_at,seq=default,updated_at=clock_timestamp()
      where owner_id=v_owner and doc_key=p_doc_key returning seq into v_seq;
  end if;
  v_result := jsonb_build_object('status','stored','revision',v_revision,'seq',v_seq);
  insert into public.life_account_document_receipts(owner_id,operation_id,doc_key,request_hash,result)
    values(v_owner,p_operation_id,p_doc_key,v_hash,v_result);
  return v_result;
end;
$function$;

revoke all on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.life_account_document_put(text,bigint,uuid,jsonb,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';
$haedo_m5$;

  -- ===== 20261101160000_life_blog_delete_guard.sql =====
  execute $haedo_m6$
-- Explicit post deletion never removes a public post (2026-11-01 review B1).
-- A device can believe a post is unpublished while another device has just
-- published it; the server is the authority. Such a request deletes nothing
-- and reports 'published' so the client withdraws first. A stale revision
-- still reports 'conflict' and deletes nothing.
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
  if exists(select 1 from haedo_blog_private.publications where owner_id=who and post_id=p_post_id and active) then
   return jsonb_build_object('status','published','revision',p.revision);
  end if;
  delete from haedo_blog_private.publications where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.posts where owner_id=who and id=p_post_id;
  update haedo_blog_private.assets set deleted_at=clock_timestamp() where owner_id=who and post_id=p_post_id and deleted_at is null;
 end if;
 delete from haedo_blog_private.assets a where a.owner_id=who and a.deleted_at is not null
  and not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path);
 select coalesce(jsonb_agg(a.path order by a.path),'[]'::jsonb) into paths from haedo_blog_private.assets a
  where a.owner_id=who and a.post_id=p_post_id and a.deleted_at is not null;
 return jsonb_build_object('status',case when existed then 'deleted' else 'missing' end,'revision',coalesce(p.revision,0),'paths',paths);
end $$;
revoke all on function haedo_blog_private.delete_post(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function haedo_blog_private.delete_post(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
$haedo_m6$;

  -- Restore reviewed later definitions within this same atomic statement.
  for r in select value from jsonb_each_text(markdown_definitions) loop
    execute r.value;
  end loop;

  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if to_regclass('public.life_account_documents') is null then raise exception 'life_account_documents missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.life_account_documents'::regclass) then raise exception 'RLS disabled on life_account_documents'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')) <> 5 then
    raise exception 'a new RPC is missing';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')
             and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can execute a new private function';
  end if;
  raise notice 'haedo account sync installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'account documents table + RLS' as check_name,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.life_account_documents')), false) as ok
union all
select 'new RPCs present', (select count(distinct proname) = 5 from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete'))
union all
select 'anon cannot execute new RPCs', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')
  and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'blog bucket accepts HEIC', coalesce((select 'image/heic' = any(allowed_mime_types) from storage.buckets where id = 'haedo-blog-originals'), false);
