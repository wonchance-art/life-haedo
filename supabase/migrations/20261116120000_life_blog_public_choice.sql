-- Public name/intro separated from each publication, and attachments chosen one by one
-- (owner decisions 7 and 9, 2026-11-16).
--
-- Before:
-- * The public name and intro (haedo_blog_private.profiles.author, shown above the account's
--   public post list) could only be set by publishing: every publish request replaced it with
--   the request's p_author. There was no owner read or write of it.
-- * Every publication copied all attachments of the stored post ({type,title,creator,url}
--   link cards, at most 12) into the public copy. Only photos were chosen.
--
-- After:
-- * public.life_blog_get_public_profile() / public.life_blog_set_public_profile(p_author):
--   owner-only read and explicit save of the profile (authenticated only; auth.uid() is the
--   owner; anon has no EXECUTE). set validates {name<=500, intro<=2000 UTF-16 units, no control
--   characters} exactly like publish. No row of another account is ever read or written.
-- * An attachment choice p_attachments (jsonb array of strictly ascending list positions 0..11,
--   [] = none) on every publish path:
--   - public.life_blog_publish_copies (v1/v2; text-only requests send p_copies {}),
--   - public.life_blog_markdown_publish_prepare and ..._commit (Markdown, via Edge
--     haedo-blog-publish).
--   The public copy holds exactly the chosen attachments in document order. A position outside
--   the stored post is refused (life_blog_unknown_attachment). The empty-publication check
--   counts the chosen attachments only.
-- * No publish request writes the profile's name or intro any more, with or without a choice
--   (owner decision 7: only set_public_profile does). A request only creates the profile row,
--   with an empty name and intro, when the account has none (the public list token);
--   p_author is the copy's byline as the request reviewed it.
--   The receipt hash of such a request is
--   ['publish',rev,photos,author,public rev,copies,{"attachments":[...]}], which no earlier
--   request can have.
-- * Without p_attachments (an earlier app, or a request recorded before this file), every path
--   behaves as before except that the copy holds NO attachments and the saved name and intro
--   are left as they are: same hash and receipt replay, same CAS and checks. Less is published,
--   never more, and an earlier app can no longer replace the saved name and intro.
--
-- Signatures: public.life_blog_publish_copies, life_blog_markdown_publish_prepare and
-- life_blog_markdown_publish_commit gain a trailing p_attachments jsonb default null (drop and
-- create; their privileges are granted again below, to the same single role as before).
-- public.life_blog_publish(6 arguments) keeps its signature and body (the 2026-11-01 install
-- bundle grants on it); it already calls haedo_blog_private.publish_copies, which now forwards
-- without a choice. The private publish_copies, markdown_publish_hash, markdown_publish_prepare
-- and markdown_publish_commit keep their signatures and forward to the new
-- haedo_blog_private.publish_choice / markdown_choice_* without a choice.
-- haedo_blog_private.publish(6) (20261105051632) keeps its body (the install bundles guard its
-- md5); no API function has called it since 20261102120000, and it would still write the profile
-- and every attachment, so EXECUTE on it is revoked from authenticated (it keeps no API role).
-- The 2026-11-01 install bundle grants it again if that bundle is re-run; applying this file
-- again revokes it again (it is the one statement repeated on an installed catalog).
--
-- Unchanged: unpublish, delete, save, reads, public reads/lists/media, every stored row and
-- receipt, RLS and table privileges. Public copies already published keep their attachments
-- until the owner publishes that post again or withdraws it.
--
-- One SQL Editor statement: the DDL and the preservation checks share one atomic transaction
-- even when an installer autocommits each top-level statement. Applying it again changes
-- nothing (an installed catalog is verified; only the revoke above is repeated). A write by a
-- syncing device during the install changes a row count or hash, so the install refuses and rolls
-- back; run it again when the devices are idle. ASCII only; no backslash escapes.
do $haedo_blog_choice$
declare relation text; n bigint; h text; before_rows jsonb:='{}'; prior jsonb; sig text; want text;
 relations text[]:=array['haedo_blog_private.posts','haedo_blog_private.assets','haedo_blog_private.receipts','haedo_blog_private.publications','haedo_blog_private.profiles','haedo_blog_private.retired_posts'];
 installed boolean:=to_regprocedure('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)') is not null;
 earlier jsonb:=jsonb_build_object(
  'haedo_blog_private.publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','fa7f1208a0826e68d8f668eb57a9f850',
  'haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)','d872bf11fc983b14e4d61ff36be6932d',
  'haedo_blog_private.markdown_publish_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','61a1318052863d5962a68dac78ac519a',
  'haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','2acda7ffcb7a1022e0a30839245fee90',
  'haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','34dcb685b3618f0e2196b0aa5f66c4ac',
  'public.life_blog_publish(uuid,bigint,uuid,text[],jsonb,bigint)','8643627f00ef0dc03fe9fc482680143b',
  'public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','f8388d221711fba02097d32c625ece7d',
  'public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','da03875443592714fdfacfd3cba1553a',
  'public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','5dba0aab863547721973a6529725e839');
 final jsonb:=jsonb_build_object(
  'haedo_blog_private.valid_attachment_choice(jsonb)','bf2396750df4960fd4a7f2fc0ce41df0',
  'haedo_blog_private.picked_attachments(jsonb,jsonb)','1051f3cd08ac58c9429fbca898fa782f',
  'haedo_blog_private.publish_request_hash(bigint,text[],jsonb,bigint,jsonb,jsonb)','bd65635d990f7d774096826069e59c40',
  'haedo_blog_private.publish_choice(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','bfd3576259f12a7c9f35e90747aab337',
  'haedo_blog_private.publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','9e710461ca227bc24884ea8413171452',
  'haedo_blog_private.markdown_choice_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','a6413a04775ff4910750b27da3d3c456',
  'haedo_blog_private.markdown_choice_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','f2bf656b49db16f132cce1ae8d756a91',
  'haedo_blog_private.markdown_choice_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)','2268d8723c0bee9ab11ff0a6c0c94284',
  'haedo_blog_private.markdown_publish_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','0a44bd28c2ca59d2f91cfc51bf06fad6',
  'haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','e79a0028dfe2e15083d2da13410f0a32',
  'haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','13804bdfdd99720909f99e4efe7484f7',
  'haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)','d872bf11fc983b14e4d61ff36be6932d',
  'haedo_blog_private.get_public_profile()','ab47a601e7919e9073b20a5d626aaa64',
  'haedo_blog_private.set_public_profile(jsonb)','4ca454ce39ad4e786d34f69fa57a3a63',
  'public.life_blog_publish(uuid,bigint,uuid,text[],jsonb,bigint)','8643627f00ef0dc03fe9fc482680143b',
  'public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','b66b5645a4bea91e4086278509c3a44c',
  'public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','7d5438e0b532d12a09ee07a3e53366a2',
  'public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)','e359e1737c3122056d6123f8c1485c20',
  'public.life_blog_get_public_profile()','976079046e16fd6c0b904a144521d5e3',
  'public.life_blog_set_public_profile(jsonb)','fe15181ff09eac701d54d4e4c182c9d2');
 -- Who may execute each function afterwards (every other API role: none).
 roles jsonb:=jsonb_build_object(
  'haedo_blog_private.publish_choice(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','authenticated',
  'haedo_blog_private.publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','authenticated',
  'haedo_blog_private.markdown_choice_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','authenticated',
  'haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','authenticated',
  'haedo_blog_private.markdown_choice_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)','service_role',
  'haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','service_role',
  'haedo_blog_private.get_public_profile()','authenticated',
  'haedo_blog_private.set_public_profile(jsonb)','authenticated',
  'public.life_blog_publish(uuid,bigint,uuid,text[],jsonb,bigint)','authenticated',
  'public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','authenticated',
  'public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','authenticated',
  'public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)','service_role',
  'public.life_blog_get_public_profile()','authenticated',
  'public.life_blog_set_public_profile(jsonb)','authenticated',
  'haedo_blog_private.valid_attachment_choice(jsonb)','',
  'haedo_blog_private.picked_attachments(jsonb,jsonb)','',
  'haedo_blog_private.publish_request_hash(bigint,text[],jsonb,bigint,jsonb,jsonb)','',
  'haedo_blog_private.markdown_choice_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)','',
  'haedo_blog_private.markdown_publish_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','',
  'haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)','');
 role_name text;
begin
 if not installed then
  -- The functions this file replaces must be the reviewed ones, owned by the role running it.
  for sig,want in select key,value#>>'{}' from jsonb_each(earlier) loop
   if to_regprocedure(sig) is null then raise exception 'Missing %; nothing was changed',sig; end if;
   if (select md5(prosrc) from pg_proc where oid=to_regprocedure(sig)) is distinct from want then
    raise exception '% differs from the repository definition; nothing was changed',sig; end if;
   if (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(sig)) is distinct from current_user::text then
    raise exception 'Run this as the owner of % (now %); nothing was changed',sig,current_user; end if;
  end loop;
  if (select pg_get_userbyid(relowner) from pg_class where oid=to_regclass('haedo_blog_private.profiles')) is distinct from current_user::text then
   raise exception 'Run this as the owner of haedo_blog_private.profiles (now %); nothing was changed',current_user; end if;
  if to_regprocedure('haedo_blog_private.get_public_profile()') is not null or to_regprocedure('haedo_blog_private.publish_choice(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)') is not null then
   raise exception 'A partial earlier install exists; nothing was changed'; end if;
 end if;
 foreach relation in array relations loop
  if to_regclass(relation) is null then continue; end if;
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  before_rows:=before_rows||jsonb_build_object(relation,jsonb_build_object('count',n,'hash',h));
 end loop;

 if not installed then
 execute $choice_ddl$
-- [] or strictly ascending list positions 0..11 (a post holds at most 12 attachments).
create function haedo_blog_private.valid_attachment_choice(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $fn$
declare v jsonb; last integer:=-1;
begin
 if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)>12 then return false; end if;
 for v in select value from jsonb_array_elements(p) loop
  if not haedo_blog_private.intval(v,0,11) or (v#>>'{}')::integer<=last then return false; end if;
  last:=(v#>>'{}')::integer;
 end loop;
 return true;
end $fn$;

-- The attachments a public copy holds: none without a choice (earlier requests), else the
-- chosen positions of the stored list, in document order.
create function haedo_blog_private.picked_attachments(p_all jsonb,p_choice jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $fn$
declare v jsonb; picked jsonb:='[]'; total integer:=case when jsonb_typeof(p_all)='array' then jsonb_array_length(p_all) else 0 end;
begin
 if p_choice is null then return '[]'::jsonb; end if;
 for v in select value from jsonb_array_elements(p_choice) loop
  if (v#>>'{}')::integer>=total then raise exception using errcode='22023',message='life_blog_unknown_attachment'; end if;
  picked:=picked||jsonb_build_array(p_all->((v#>>'{}')::integer));
 end loop;
 return picked;
end $fn$;

-- Receipt identity of one publish intent. Without a choice: exactly the earlier formulas
-- (20261102120000 publish_copies and 20261105081055 markdown_publish_hash).
create function haedo_blog_private.publish_request_hash(p_expected_revision bigint,p_chosen text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb)
returns bytea language sql immutable set search_path=pg_catalog as $fn$
 select sha256(convert_to((case
  when p_attachments is not null then jsonb_build_array('publish',p_expected_revision,p_chosen,p_author,p_expected_publication_revision,p_copies,jsonb_build_object('attachments',p_attachments))
  when p_copies='{}'::jsonb then jsonb_build_array('publish',p_expected_revision,p_chosen,p_author,p_expected_publication_revision)
  else jsonb_build_array('publish',p_expected_revision,p_chosen,p_author,p_expected_publication_revision,p_copies) end)::text,'UTF8'))
$fn$;

-- publish_copies (20261105051632) with the attachment choice and, with a choice, no profile write.
create function haedo_blog_private.publish_choice(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); copies jsonb:=coalesce(p_copies,'{}'::jsonb); known text[]; named text[];
 mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}'; picked jsonb;
 item jsonb; src jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or p_expected_publication_revision is null or p_expected_publication_revision not between 0 and 9007199254740990
 or cardinality(chosen)>20 or cardinality(chosen)<>(select count(distinct c) from unnest(chosen)c)
 or not haedo_blog_private.keys(p_author,array['name','intro'],array['name','intro']) or not haedo_blog_private.txt(p_author->'name',500) or not haedo_blog_private.txt(p_author->'intro',2000)
 or jsonb_typeof(copies) is distinct from 'object'
 or (p_attachments is not null and not haedo_blog_private.valid_attachment_choice(p_attachments))
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 select coalesce(array_agg(k),'{}') into named from jsonb_object_keys(copies) k;
 if not named <@ chosen then raise exception using errcode='22023',message='life_invalid_request'; end if;
 for src in select value from jsonb_each(copies) loop
  if not haedo_blog_private.keys(src,array['type','size','digest','width','height'],array['type','size','digest','width','height'])
  or not haedo_blog_private.photo_media(src) or src->>'type' not in ('image/jpeg','image/png') then raise exception using errcode='22023',message='life_invalid_request'; end if;
 end loop;
 h:=haedo_blog_private.publish_request_hash(p_expected_revision,chosen,p_author,p_expected_publication_revision,copies,p_attachments);
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
 picked:=haedo_blog_private.picked_attachments(coalesce(p.data->'attachments','[]'::jsonb),p_attachments);
 -- The public list token only, for every request (an earlier app's too): the name and intro are
 -- saved by set_public_profile alone. A first publication without a profile row starts it empty.
 insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;
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
 snapshot:=jsonb_build_object('format','life-blog-public-v1','title',p.data->'title','ops',ops,'photos',photos,'attachments',picked,'author',p_author);
 if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(picked)=0
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
end $fn$;

-- The earlier entry point, without a choice (also behind public.life_blog_publish).
create or replace function haedo_blog_private.publish_copies(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 return haedo_blog_private.publish_choice(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,null);
end $fn$;

-- markdown_publish_hash (20261105081055) with the attachment choice.
create function haedo_blog_private.markdown_choice_hash(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb)
returns bytea language plpgsql immutable set search_path=pg_catalog as $fn$
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
 or (p_attachments is not null and not haedo_blog_private.valid_attachment_choice(p_attachments))
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 select coalesce(array_agg(k),'{}') into named from jsonb_object_keys(copies) k;
 if not named <@ chosen or not chosen <@ named then raise exception using errcode='22023',message='life_invalid_request'; end if;
 for src in select value from jsonb_each(copies) loop
  if not haedo_blog_private.keys(src,array['type','size','digest','width','height'],array['type','size','digest','width','height'])
  or not haedo_blog_private.photo_media(src) or src->>'type' not in ('image/jpeg','image/png') then
   raise exception using errcode='22023',message='life_invalid_request'; end if;
 end loop;
 return haedo_blog_private.publish_request_hash(p_expected_revision,chosen,p_author,p_expected_publication_revision,copies,p_attachments);
end $fn$;

create or replace function haedo_blog_private.markdown_publish_hash(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns bytea language plpgsql immutable set search_path=pg_catalog as $fn$
begin
 return haedo_blog_private.markdown_choice_hash(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,null);
end $fn$;

-- markdown_publish_prepare (20261105081055) with the attachment choice; a position outside the
-- stored list is refused before the Edge projects anything.
create function haedo_blog_private.markdown_choice_prepare(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); sid text:=auth.jwt()->>'session_id'; session uuid; h bytea;
 prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; public_revision bigint;
begin
 if who is null or sid is null or sid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  raise exception using errcode='42501',message='life_auth_required'; end if;
 session:=sid::uuid;
 if not haedo_blog_private.markdown_session_live(who,session) then raise exception using errcode='42501',message='life_auth_required'; end if;
 h:=haedo_blog_private.markdown_choice_hash(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_attachments);
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
 perform haedo_blog_private.picked_attachments(p.data->'attachments',p_attachments);
 return jsonb_build_object('status','prepared','ownerId',who,'sessionId',session,'revision',p.revision,
  'sourceHash',encode(sha256(convert_to(p.data::text,'UTF8')),'hex'),'document',p.data);
end $fn$;

create or replace function haedo_blog_private.markdown_publish_prepare(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 return haedo_blog_private.markdown_choice_prepare(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,null);
end $fn$;

-- markdown_publish_commit (20261105081055) with the attachment choice and, with a choice, no
-- profile write.
create function haedo_blog_private.markdown_choice_commit(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_owner_id uuid,p_session_id uuid,p_source_hash text,p_ops jsonb,p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=p_owner_id; h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; old haedo_blog_private.publications%rowtype;
 f haedo_blog_private.profiles%rowtype; chosen text[]:=coalesce(p_photo_ids,'{}'); copies jsonb:=coalesce(p_copies,'{}'::jsonb); known text[]; used text[];
 mapping jsonb:='{}'; photos jsonb:='[]'; ops jsonb:='[]'; media jsonb:='{}'; selected_photos jsonb; validation_ops jsonb; projected jsonb; end_index integer; picked jsonb;
 item jsonb; src jsonb; op jsonb; a haedo_blog_private.assets%rowtype; public_id text; snapshot jsonb; r jsonb; rev bigint; tok uuid; created timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception using errcode='42501',message='life_auth_required'; end if;
 if not haedo_blog_private.markdown_session_live(who,p_session_id) then raise exception using errcode='42501',message='life_auth_required'; end if;
 h:=haedo_blog_private.markdown_choice_hash(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_attachments);
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
 picked:=haedo_blog_private.picked_attachments(p.data->'attachments',p_attachments);
 insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;
 select * into f from haedo_blog_private.profiles where owner_id=who;
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
 snapshot:=jsonb_build_object('format','life-blog-public-v1','title',p.data->'title','ops',ops,'photos',photos,'attachments',picked,'author',p_author);
 if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(picked)=0
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
end $fn$;

create or replace function haedo_blog_private.markdown_publish_commit(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_owner_id uuid,p_session_id uuid,p_source_hash text,p_ops jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 return haedo_blog_private.markdown_choice_commit(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_owner_id,p_session_id,p_source_hash,p_ops,null);
end $fn$;

-- The owner's public name and intro. Owner only: auth.uid() names the row.
create function haedo_blog_private.get_public_profile()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); f haedo_blog_private.profiles%rowtype; saved boolean;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 select * into f from haedo_blog_private.profiles where owner_id=who;
 saved:=found;
 return jsonb_build_object('author',case when saved then f.author else '{"name":"","intro":""}'::jsonb end,'saved',saved,
  'blogToken',case when saved then to_jsonb(f.token) else 'null'::jsonb end,
  'posts',(select count(*) from haedo_blog_private.publications where owner_id=who and active));
end $fn$;

create function haedo_blog_private.set_public_profile(p_author jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); f haedo_blog_private.profiles%rowtype;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if not haedo_blog_private.keys(p_author,array['name','intro'],array['name','intro']) or not haedo_blog_private.txt(p_author->'name',500) or not haedo_blog_private.txt(p_author->'intro',2000)
 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author
 returning * into f;
 return jsonb_build_object('author',f.author,'saved',true,'blogToken',to_jsonb(f.token),
  'posts',(select count(*) from haedo_blog_private.publications where owner_id=who and active));
end $fn$;

drop function public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb);
create function public.life_blog_publish_copies(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.publish_choice(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_attachments)$fn$;
drop function public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb);
create function public.life_blog_markdown_publish_prepare(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_attachments jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.markdown_choice_prepare(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_attachments)$fn$;
drop function public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb);
create function public.life_blog_markdown_publish_commit(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb,p_owner_id uuid,p_session_id uuid,p_source_hash text,p_ops jsonb,p_attachments jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.markdown_choice_commit(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision,p_copies,p_owner_id,p_session_id,p_source_hash,p_ops,p_attachments)$fn$;
create function public.life_blog_get_public_profile()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.get_public_profile()$fn$;
create function public.life_blog_set_public_profile(p_author jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.set_public_profile(p_author)$fn$;
$choice_ddl$;
  for sig,role_name in select key,value#>>'{}' from jsonb_each(roles) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',sig);
   if role_name<>'' then execute format('grant execute on function %s to %I',sig,role_name); end if;
  end loop;
 end if;
 -- Repeated on an installed catalog: a re-run 2026-11-01 install bundle grants it again.
 revoke all on function haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint) from public,anon,authenticated,service_role;

 -- The catalog this file leaves, whether it installed it now or earlier.
 for sig,want in select key,value#>>'{}' from jsonb_each(final) loop
  if to_regprocedure(sig) is null or (select md5(prosrc) from pg_proc where oid=to_regprocedure(sig)) is distinct from want
  or (select proconfig is distinct from array['search_path=pg_catalog'] or pg_get_userbyid(proowner) is distinct from current_user::text from pg_proc where oid=to_regprocedure(sig)) then
   raise exception 'Public choice install did not end in the expected state (%); rolled back',sig; end if;
 end loop;
 for sig,role_name in select key,value#>>'{}' from jsonb_each(roles) loop
  if has_function_privilege('anon',sig,'execute')
  or has_function_privilege('authenticated',sig,'execute') is distinct from (role_name='authenticated')
  or has_function_privilege('service_role',sig,'execute') is distinct from (role_name='service_role') then
   raise exception 'Public choice install left unexpected privileges on %; rolled back',sig; end if;
 end loop;
 if (select count(*) from pg_proc where oid in (to_regprocedure('haedo_blog_private.publish_choice(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)'),
   to_regprocedure('haedo_blog_private.markdown_choice_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)'),
   to_regprocedure('haedo_blog_private.markdown_choice_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)'),
   to_regprocedure('haedo_blog_private.get_public_profile()'),to_regprocedure('haedo_blog_private.set_public_profile(jsonb)')) and prosecdef)<>5
 or to_regprocedure('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)') is not null
 or to_regprocedure('public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)') is not null
 or to_regprocedure('public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)') is not null
 or (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in
   ('life_blog_publish','life_blog_publish_copies','life_blog_markdown_publish_prepare','life_blog_markdown_publish_commit','life_blog_get_public_profile','life_blog_set_public_profile') and not p.prosecdef)<>6
 then raise exception 'Public choice install did not end in the expected state; rolled back'; end if;
 for relation,prior in select key,value from jsonb_each(before_rows) loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  if n is distinct from (prior->>'count')::bigint or h is distinct from prior->>'hash' then
   raise exception 'Public choice install changed %; rolled back',relation;
  end if;
 end loop;
 perform pg_notify('pgrst','reload schema');
end
$haedo_blog_choice$;
