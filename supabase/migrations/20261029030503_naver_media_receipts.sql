-- Immutable private evidence linking one exact Core version to one owned capture.
-- Existing Core/Library metadata formats, RPCs and capability shapes stay unchanged.
begin;

create table if not exists haedo_naver_private.media_receipts (
 owner_id uuid not null, workspace_id uuid not null,
 source_id text not null, source_version_id text not null,
 capture_id uuid not null, capture_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,workspace_id,source_version_id),
 check(source_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 check(source_version_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 check(capture_hash ~ '^[a-f0-9]{64}$')
 -- No cascade: loss of a remote target must not silently rewrite a receipt.
);
alter table haedo_naver_private.media_receipts enable row level security;
revoke all on haedo_naver_private.media_receipts from public,anon,authenticated,service_role;
create index if not exists naver_media_receipts_capture on haedo_naver_private.media_receipts(owner_id,workspace_id,capture_id,capture_hash,source_version_id);

create or replace function haedo_naver_private.media_post_identity(value text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare m text[];parts text[];pair text;k text;v text;seen text[]:=array[]::text[];
 blog text;log text;pathname text;
begin
 if value is null or length(value)>8192 or value ~ '[[:space:]\\]' or value ~ '[[:cntrl:]]' then return null;end if;
 m:=regexp_match(value,'^https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$','i');
 if m is null or lower(m[1]) not in ('blog.naver.com','m.blog.naver.com') then return null;end if;
 pathname:=regexp_replace(m[2],'/$','');
 if pathname like '%\%%' escape '\' then return null;end if;
 foreach pair in array string_to_array(coalesce(m[3],''),'&') loop
  if pair='' then continue;end if;
  k:=split_part(pair,'=',1);v:=case when position('=' in pair)>0 then substring(pair from position('=' in pair)+1) else '' end;
  if lower(k)=any(seen) or position('%' in k)>0 or
    (lower(k) in ('blogid','logno') and k not in ('blogId','logNo')) then return null;end if;
  seen:=array_append(seen,lower(k));
  if k in ('blogId','logNo') then
   if v ~ '[%+]' then return null;end if;
   if k='blogId' then blog:=v;else log:=v;end if;
  end if;
 end loop;
 if pathname='/PostView.naver' then
  if blog is null or log is null then return null;end if;
 else
  if 'blogid'=any(seen) or 'logno'=any(seen) then return null;end if;
  parts:=regexp_match(pathname,'^/([A-Za-z0-9_-]{1,50})/([1-9][0-9]{0,29})$');
  if parts is null then return null;end if;blog:=parts[1];log:=parts[2];
 end if;
 if blog !~ '^[A-Za-z0-9_-]{1,50}$' or log !~ '^[1-9][0-9]{0,29}$' then return null;end if;
 return jsonb_build_object('blogId',blog,'logNo',log);
end $$;

create or replace function haedo_naver_private.media_receipt_check(
 p_owner uuid,p_workspace_id uuid,p_source_id text,p_source_version_id text,p_capture_id uuid,p_capture_hash text)
returns void language plpgsql set search_path=pg_catalog as $$
declare bundle jsonb;s jsonb;v jsonb;c public.life_naver_captures%rowtype;identity jsonb;n integer;core_omissions jsonb;core_author text;
begin
 if p_owner is null or p_workspace_id is null or p_capture_id is null or
  p_source_id is null or p_source_id !~ '^[A-Za-z0-9_-]{1,128}$' or
  p_source_version_id is null or p_source_version_id !~ '^[A-Za-z0-9_-]{1,128}$' or
  p_capture_hash is null or p_capture_hash !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='life_naver_media_invalid_receipt';end if;
 select data into bundle from public.life_workspaces where owner_id=p_owner and id=p_workspace_id;
 if not found then raise exception using errcode='42501',message='life_naver_media_owner_required';end if;
 if jsonb_typeof(bundle->'sources') is distinct from 'array' or jsonb_typeof(bundle->'sourceVersions') is distinct from 'array' then
  raise exception using errcode='22023',message='life_naver_media_source_mismatch';end if;
 select count(*) into n from jsonb_array_elements(bundle->'sources') x where x->>'id'=p_source_id;
 if n<>1 then raise exception using errcode='22023',message='life_naver_media_source_mismatch';end if;
 select x into s from jsonb_array_elements(bundle->'sources') x where x->>'id'=p_source_id;
 select count(*) into n from jsonb_array_elements(bundle->'sourceVersions') x where x->>'id'=p_source_version_id;
 if n<>1 then raise exception using errcode='22023',message='life_naver_media_source_mismatch';end if;
 select x into v from jsonb_array_elements(bundle->'sourceVersions') x where x->>'id'=p_source_version_id;
 select * into c from public.life_naver_captures where id=p_capture_id and owner_id=p_owner;
 if not found then raise exception using errcode='42501',message='life_naver_media_owner_required';end if;
 if c.capture_hash is distinct from p_capture_hash then raise exception using errcode='22023',message='life_naver_media_capture_mismatch';end if;
 -- Uses the existing immutable capture validator, including body/capture hashes,
 -- photo owner paths and storage metadata. Blob bytes are verified on download.
 perform haedo_naver_private.validate_capture(c.payload,p_owner,c.blog_id,c.log_no,c.capture_hash);
 identity:=haedo_naver_private.media_post_identity(s->>'url');
 -- Core.prepareImport trims metadata with ECMAScript String.trim and removes
 -- duplicate omissions in first-occurrence order. Compare the exact Core
 -- projection, without normalizing the body, its hash, or the saved version.
 core_author:=btrim(c.payload->>'author',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
 select coalesce(jsonb_agg(item order by first_position),'[]'::jsonb) into core_omissions from
  (select item,min(position) first_position from jsonb_array_elements(c.payload->'omissions') with ordinality e(item,position) group by item) d;
 if s->>'origin' is distinct from 'naver_blog' or v->>'sourceId' is distinct from p_source_id or
  identity is null or identity->>'blogId' is distinct from c.blog_id or identity->>'logNo' is distinct from c.log_no or
  v->'contentText' is distinct from c.payload->'body' or v->'contentHash' is distinct from c.payload->'bodyHash' or
  v->>'format' is distinct from (case when c.payload->'body'='null'::jsonb then 'text/plain' else c.payload->>'format' end) or
  v->'coverage' is distinct from jsonb_build_object('status',c.payload->'coverage','omissions',core_omissions) or
  v->'originalAuthor' is distinct from jsonb_build_object('label',core_author,'relation','unknown') or
  v->'originalCreatedAt' is distinct from c.payload->'publishedAt' then
  raise exception using errcode='22023',message='life_naver_media_source_mismatch';end if;
end $$;

create or replace function haedo_naver_private.media_receipt_put(
 p_workspace_id uuid,p_source_id text,p_source_version_id text,p_capture_id uuid,p_capture_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();r haedo_naver_private.media_receipts%rowtype;
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required';end if;
 -- Use the same lock as Core writes: snapshot validation and immutable insert
 -- are serialized with changes to this owner/workspace, including first writes.
 perform pg_advisory_xact_lock(hashtextextended(who::text||':'||p_workspace_id::text,0));
 perform haedo_naver_private.media_receipt_check(who,p_workspace_id,p_source_id,p_source_version_id,p_capture_id,p_capture_hash);
 select * into r from haedo_naver_private.media_receipts where owner_id=who and workspace_id=p_workspace_id and source_version_id=p_source_version_id;
 if found then
  if r.source_id is distinct from p_source_id or r.capture_id is distinct from p_capture_id or r.capture_hash is distinct from p_capture_hash then
   raise exception using errcode='PT409',message='life_naver_media_receipt_conflict';end if;
 else
  insert into haedo_naver_private.media_receipts(owner_id,workspace_id,source_id,source_version_id,capture_id,capture_hash)
   values(who,p_workspace_id,p_source_id,p_source_version_id,p_capture_id,p_capture_hash);
 end if;
 return jsonb_build_object('workspaceId',p_workspace_id,'sourceId',p_source_id,'sourceVersionId',p_source_version_id,'captureId',p_capture_id,'captureHash',p_capture_hash);
end $$;

create or replace function haedo_naver_private.media_receipt_read(p_workspace_id uuid,p_source_version_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();r haedo_naver_private.media_receipts%rowtype;
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required';end if;
 if p_workspace_id is null or p_source_version_id is null or p_source_version_id !~ '^[A-Za-z0-9_-]{1,128}$' then
  raise exception using errcode='22023',message='life_naver_media_invalid_receipt';end if;
 if not exists(select 1 from public.life_workspaces where owner_id=who and id=p_workspace_id) then return null;end if;
 select * into r from haedo_naver_private.media_receipts where owner_id=who and workspace_id=p_workspace_id and source_version_id=p_source_version_id;
 if not found then return null;end if;
 perform haedo_naver_private.media_receipt_check(who,p_workspace_id,r.source_id,p_source_version_id,r.capture_id,r.capture_hash);
 return jsonb_build_object('workspaceId',p_workspace_id,'sourceId',r.source_id,'sourceVersionId',p_source_version_id,'captureId',r.capture_id,'captureHash',r.capture_hash);
end $$;

create or replace function haedo_naver_private.media_receipt_find(p_workspace_id uuid,p_capture_id uuid,p_capture_hash text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();r haedo_naver_private.media_receipts%rowtype;c public.life_naver_captures%rowtype;result jsonb:='[]'::jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required';end if;
 if p_workspace_id is null or p_capture_id is null or p_capture_hash is null or p_capture_hash !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='life_naver_media_invalid_receipt';end if;
 if not exists(select 1 from public.life_workspaces where owner_id=who and id=p_workspace_id) then return result;end if;
 select * into c from public.life_naver_captures where id=p_capture_id and owner_id=who;
 if not found then return result;end if;
 if c.capture_hash is distinct from p_capture_hash then raise exception using errcode='22023',message='life_naver_media_capture_mismatch';end if;
 perform haedo_naver_private.validate_capture(c.payload,who,c.blog_id,c.log_no,c.capture_hash);
 -- 51 is an explicit overflow sentinel; callers must reject ambiguity, never
 -- silently pick the first 50 or infer a target from matching body text.
 for r in select * from haedo_naver_private.media_receipts where owner_id=who and workspace_id=p_workspace_id and capture_id=p_capture_id and capture_hash=p_capture_hash order by source_version_id limit 51 loop
  perform haedo_naver_private.media_receipt_check(who,p_workspace_id,r.source_id,r.source_version_id,p_capture_id,p_capture_hash);
  result:=result||jsonb_build_array(jsonb_build_object('workspaceId',p_workspace_id,'sourceId',r.source_id,'sourceVersionId',r.source_version_id,'captureId',p_capture_id,'captureHash',p_capture_hash));
 end loop;
 return result;
end $$;

create or replace function public.life_naver_media_receipt_put(p_workspace_id uuid,p_source_id text,p_source_version_id text,p_capture_id uuid,p_capture_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_naver_private.media_receipt_put(p_workspace_id,p_source_id,p_source_version_id,p_capture_id,p_capture_hash)
$$;
create or replace function public.life_naver_media_receipt_read(p_workspace_id uuid,p_source_version_id text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_naver_private.media_receipt_read(p_workspace_id,p_source_version_id)
$$;
create or replace function public.life_naver_media_receipt_find(p_workspace_id uuid,p_capture_id uuid,p_capture_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_naver_private.media_receipt_find(p_workspace_id,p_capture_id,p_capture_hash)
$$;

-- Exact signatures only: never reset ACLs on pre-existing Naver/Core/Library APIs.
revoke all on function haedo_naver_private.media_post_identity(text) from public,anon,authenticated,service_role;
revoke all on function haedo_naver_private.media_receipt_check(uuid,uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function haedo_naver_private.media_receipt_put(uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function haedo_naver_private.media_receipt_read(uuid,text) from public,anon,authenticated,service_role;
revoke all on function haedo_naver_private.media_receipt_find(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.life_naver_media_receipt_put(uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.life_naver_media_receipt_read(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.life_naver_media_receipt_find(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function haedo_naver_private.media_receipt_put(uuid,text,text,uuid,text) to authenticated;
grant execute on function haedo_naver_private.media_receipt_read(uuid,text) to authenticated;
grant execute on function haedo_naver_private.media_receipt_find(uuid,uuid,text) to authenticated;
grant execute on function public.life_naver_media_receipt_put(uuid,text,text,uuid,text) to authenticated;
grant execute on function public.life_naver_media_receipt_read(uuid,text) to authenticated;
grant execute on function public.life_naver_media_receipt_find(uuid,uuid,text) to authenticated;
commit;
