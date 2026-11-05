-- B3: the authenticated Edge parses the stored canonical source with the same
-- maintained browser codec. Only its service-role commit accepts projected ops.
-- SQL binds that projection to a live owner session and the exact stored source,
-- validates its public shape and immutable metadata-free copies, and publishes
-- atomically. It does not parse Markdown or trust browser-supplied projections.
-- Existing v1/v2 RPC bodies, privileges, receipts and source rows stay unchanged.
-- One SQL Editor statement: all DDL and preservation checks share an atomic
-- transaction even when an installer autocommits each top-level statement.
do $haedo_markdown_publish$
declare relation text; n bigint; h text; before_rows jsonb:='{}'; prior jsonb;
begin
 foreach relation in array array['haedo_blog_private.posts','haedo_blog_private.assets','haedo_blog_private.receipts','haedo_blog_private.publications','haedo_blog_private.profiles'] loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  before_rows:=before_rows||jsonb_build_object(relation,jsonb_build_object('count',n,'hash',h));
 end loop;
 execute $markdown_ddl$
-- These helpers are private capabilities; only the two entry points below can
-- call them. The session rules match discovery.owner(), without user metadata.
create or replace function haedo_blog_private.markdown_session_live(p_owner_id uuid,p_session_id uuid)
returns boolean language plpgsql volatile set search_path=pg_catalog as $$
begin
 return p_owner_id is not null and p_session_id is not null and exists(
  select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=p_owner_id and s.id=p_session_id and not coalesce(u.is_anonymous,false)
   and (s.not_after is null or s.not_after>clock_timestamp()));
end $$;

create or replace function haedo_blog_private.markdown_publish_hash(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns bytea language plpgsql immutable set search_path=pg_catalog as $$
declare chosen text[]:=coalesce(p_photo_ids,'{}'); copies jsonb:=coalesce(p_copies,'{}'::jsonb); named text[]; src jsonb;
begin
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or p_expected_publication_revision is null or p_expected_publication_revision not between 0 and 9007199254740990
 or coalesce(array_ndims(chosen),1)<>1 or cardinality(chosen)>20
 or cardinality(chosen)<>(select count(distinct c) from unnest(chosen)c)
 or exists(select 1 from unnest(chosen)c where c is null or c !~ '^[A-Za-z0-9_-]{1,128}$')
 or not haedo_blog_private.keys(p_author,array['name','intro'],array['name','intro'])
 or not haedo_blog_private.txt(p_author->'name',500) or not haedo_blog_private.txt(p_author->'intro',2000)
 or jsonb_typeof(copies) is distinct from 'object'
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 select coalesce(array_agg(k),'{}') into named from jsonb_object_keys(copies) k;
 if not named <@ chosen or not chosen <@ named then raise exception using errcode='22023',message='life_invalid_request'; end if;
 for src in select value from jsonb_each(copies) loop
  if not haedo_blog_private.keys(src,array['type','size','digest','width','height'],array['type','size','digest','width','height'])
  or not haedo_blog_private.photo_media(src) or src->>'type' not in ('image/jpeg','image/png') then
   raise exception using errcode='22023',message='life_invalid_request'; end if;
 end loop;
 -- Keep the existing publish intent identity. Derived ops/source hashes are
 -- server work, not new client intent. A completed operation replays exactly
 -- even when the source has since changed or the publication was withdrawn.
 return sha256(convert_to((case when copies='{}'::jsonb then jsonb_build_array('publish',p_expected_revision,chosen,p_author,p_expected_publication_revision)
  else jsonb_build_array('publish',p_expected_revision,chosen,p_author,p_expected_publication_revision,copies) end)::text,'UTF8'));
end $$;

create or replace function haedo_blog_private.markdown_publish_prepare(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); sid text:=auth.jwt()->>'session_id'; session uuid; h bytea;
 prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; public_revision bigint;
begin
 if who is null or sid is null or sid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  raise exception using errcode='42501',message='life_auth_required'; end if;
 session:=sid::uuid;
 if not haedo_blog_private.markdown_session_live(who,session) then raise exception using errcode='42501',message='life_auth_required'; end if;
 h:=haedo_blog_private.markdown_publish_hash(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies);
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 if not haedo_blog_private.markdown_session_live(who,session) then raise exception using errcode='42501',message='life_auth_required'; end if;
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id;
 if not found then return '{"status":"missing"}'::jsonb; end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 if p.data->>'format' is distinct from 'life-post-md-v1' then raise exception using errcode='22023',message='life_blog_update_required'; end if;
 if p.data->>'status' is distinct from 'saved' then raise exception using errcode='22023',message='life_blog_not_saved'; end if;
 if p.data->'archived'='true'::jsonb then raise exception using errcode='22023',message='life_blog_archived'; end if;
 select revision into public_revision from haedo_blog_private.publications where owner_id=who and post_id=p_post_id;
 if coalesce(public_revision,0)<>p_expected_publication_revision then return jsonb_build_object('status','conflict','revision',coalesce(public_revision,0)); end if;
 return jsonb_build_object('status','prepared','ownerId',who,'sessionId',session,'revision',p.revision,
  'sourceHash',encode(sha256(convert_to(p.data::text,'UTF8')),'hex'),'document',p.data);
end $$;

create or replace function haedo_blog_private.markdown_publish_commit(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_owner_id uuid,p_session_id uuid,p_source_hash text,p_ops jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=p_owner_id; h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); copies jsonb:=coalesce(p_copies,'{}'::jsonb); known text[]; used text[];
 mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}'; selected_photos jsonb; validation_ops jsonb; projected jsonb; end_index integer;
 item jsonb; src jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
begin
 -- PostgREST selects the role after verifying the request's credentials;
 -- SECURITY DEFINER changes current_user but preserves that selected role.
 -- Its authenticator can SET ROLE service_role if given arbitrary SQL. This
 -- boundary therefore also requires that no exposed RPC executes caller SQL
 -- or accepts caller-controlled role configuration; JWT/custom GUCs do not count.
 if current_setting('role',true) is distinct from 'service_role' then raise exception using errcode='42501',message='life_auth_required'; end if;
 if not haedo_blog_private.markdown_session_live(who,p_session_id) then raise exception using errcode='42501',message='life_auth_required'; end if;
 h:=haedo_blog_private.markdown_publish_hash(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies);
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 if not haedo_blog_private.markdown_session_live(who,p_session_id) then raise exception using errcode='42501',message='life_auth_required'; end if;
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
 if not found then return '{"status":"missing"}'::jsonb; end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 if p.data->>'format' is distinct from 'life-post-md-v1' then raise exception using errcode='22023',message='life_blog_update_required'; end if;
 if p_source_hash is distinct from encode(sha256(convert_to(p.data::text,'UTF8')),'hex') then
  return jsonb_build_object('status','conflict','revision',p.revision); end if;
 if p.data->>'status' is distinct from 'saved' then raise exception using errcode='22023',message='life_blog_not_saved'; end if;
 if p.data->'archived'='true'::jsonb then raise exception using errcode='22023',message='life_blog_archived'; end if;
 select * into old from haedo_blog_private.publications where owner_id=who and post_id=p_post_id for update;
 if coalesce(old.revision,0)<>p_expected_publication_revision then return jsonb_build_object('status','conflict','revision',coalesce(old.revision,0)); end if;
 select coalesce(array_agg(j->>'id'),'{}') into known from jsonb_array_elements(p.data->'photos') j;
 if not chosen <@ known then raise exception using errcode='22023',message='life_blog_unknown_photo'; end if;
 if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops)>5000 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 if exists(select 1 from jsonb_array_elements(p_ops) j where j->'attributes' ? 'author') then raise exception using errcode='22023',message='life_invalid_request'; end if;
 select coalesce(array_agg(j->'insert'->'photo'->>'id'),'{}') into used from jsonb_array_elements(p_ops) j where jsonb_typeof(j->'insert')='object';
 if not used <@ chosen or not chosen <@ used or cardinality(used)<>cardinality(chosen) then raise exception using errcode='22023',message='life_blog_unknown_photo'; end if;
 select coalesce(jsonb_agg(j order by n),'[]'::jsonb) into selected_photos from jsonb_array_elements(p.data->'photos') with ordinality x(j,n) where j->>'id'=any(chosen);
 -- Match Blog.validateSnapshot: preserve visible ops exactly. A photo-ending
 -- projection moves an existing complete line only in a validation surrogate;
 -- if none exists, the temporary newline obeys the same 5,000-op/50,000-char cap.
 validation_ops:=p_ops;
 if jsonb_typeof(p_ops->-1->'insert') is distinct from 'string' then
  select (n-1)::integer into end_index from jsonb_array_elements(p_ops) with ordinality x(j,n)
   where jsonb_typeof(j->'insert')='string' and right(j->>'insert',1)=chr(10) order by n limit 1;
  if end_index is not null then validation_ops:=(p_ops-end_index)||jsonb_build_array(p_ops->end_index);
  else validation_ops:=p_ops||jsonb_build_array(jsonb_build_object('insert',chr(10))); end if;
 end if;
 projected:=(p.data-'markdown')||jsonb_build_object('format','life-photo-post-v2','ops',validation_ops,'photos',selected_photos);
 if not haedo_blog_private.valid_delta_document(projected,p_post_id) then raise exception using errcode='22023',message='life_invalid_request'; end if;
 if not haedo_blog_private.ready(who,p_post_id,p.data) then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
 insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author;
 select * into f from haedo_blog_private.profiles where owner_id=who;
 -- Original document order, never selection order, pairs public IDs with the
 -- exact captions/images used by the unchanged client preview projection.
 for item in select * from jsonb_array_elements(selected_photos) loop
  public_id:=gen_random_uuid()::text;
  mapping:=mapping||jsonb_build_object(item->>'id',public_id);
  src:=copies->(item->>'id');
  if src is null then raise exception using errcode='22023',message='life_blog_public_copy_required'; end if;
  select * into a from haedo_blog_private.assets where owner_id=who and post_id=p_post_id and photo_id=item->>'id' and digest=src->>'digest' and deleted_at is null and public_copy;
  if not found or a.digest=item->>'digest' or a.digest is not distinct from item->'view'->>'digest' or a.mime not in ('image/jpeg','image/png') or a.mime<>src->>'type'
  or (item ? 'view' and a.mime<>'image/jpeg')
  or a.width>(coalesce(item->'view',item)->>'width')::integer or a.height>(coalesce(item->'view',item)->>'height')::integer
  or a.bytes<>(src->>'size')::bigint or a.width<>(src->>'width')::integer or a.height<>(src->>'height')::integer
  or not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path and o.metadata->>'size'=a.bytes::text and o.metadata->>'mimetype'=a.mime)
  then raise exception using errcode='22023',message='life_blog_assets_incomplete'; end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('id',public_id,'type',a.mime,'width',a.width,'height',a.height,'size',a.bytes,'digest',a.digest));
  media:=media||jsonb_build_object(public_id,jsonb_build_object('bucket','haedo-blog-originals','path',a.path,'type',a.mime,'size',a.bytes,'digest',a.digest,'copy',true));
 end loop;
 for op in select * from jsonb_array_elements(p_ops) loop
  if jsonb_typeof(op->'insert')='string' then ops:=ops||jsonb_build_array(haedo_blog_private.public_text_op(op));
  else ops:=ops||jsonb_build_array(jsonb_set(op,'{insert,photo,id}',mapping->(op->'insert'->'photo'->>'id'))); end if;
 end loop;
 snapshot:=jsonb_build_object('format','life-blog-public-v1','title',p.data->'title','ops',ops,'photos',photos,'attachments',p.data->'attachments','author',p_author);
 if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(snapshot->'attachments')=0
 and (select coalesce(string_agg(j->>'insert',''),'') ~ '^[[:space:]]*$' from jsonb_array_elements(ops) j) then
  raise exception using errcode='22023',message='life_blog_empty_publication'; end if;
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

-- The old authenticated publishers still reject Markdown. Even a historical
-- definition accidentally replayed outside its guarded installer cannot write
-- an active Markdown publication. Only the service-role commit above crosses
-- this boundary. PostgREST's authenticator is a member of service_role, so native
-- role alone is not a defense against arbitrary SQL execution. Clients have no
-- such SQL/configuration RPC: exposed entry points use fixed calls and parameters.
-- The service-only EXECUTE grants and verified request role work together;
-- SECURITY DEFINER preserves that role and cannot itself change it.
create or replace function haedo_blog_private.markdown_publication_requires_parser()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.active and current_setting('role',true) is distinct from 'service_role'
 and exists(select 1 from haedo_blog_private.posts p where p.owner_id=new.owner_id and p.id=new.post_id and p.data->>'format'='life-post-md-v1') then
  raise exception using errcode='22023',message='life_blog_markdown_publication_unavailable';
 end if;
 return new;
end $$;

create or replace function public.life_blog_markdown_publish_prepare(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_blog_private.markdown_publish_prepare(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies)
$$;
create or replace function public.life_blog_markdown_publish_commit(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_owner_id uuid,p_session_id uuid,p_source_hash text,p_ops jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_blog_private.markdown_publish_commit(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_owner_id,p_session_id,p_source_hash,p_ops)
$$;

revoke all on function haedo_blog_private.markdown_session_live(uuid,uuid),haedo_blog_private.markdown_publish_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb),
 haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb),
 haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb),
 public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb),
 public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb),
 public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb) to authenticated;
grant execute on function haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb),
 public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb) to service_role;

$markdown_ddl$;
 for relation,prior in select key,value from jsonb_each(before_rows) loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  if n is distinct from (prior->>'count')::bigint or h is distinct from prior->>'hash' then
   raise exception 'Markdown publish install changed %; rolled back',relation;
  end if;
 end loop;
 perform pg_notify('pgrst','reload schema');
end
$haedo_markdown_publish$;
