-- A deleted post's revisions are never handed out again (2026-11-12, account sync review B1, ABA).
--
-- Before: delete_post removes the post row, and a later save of the same identity with expected
-- revision 0 creates it again at revision 1. A device that still holds revision 1 (or any
-- revision the new row later reaches) of the deleted post takes the new row for the revision it
-- already has, so it receives nothing, and its next save at that revision overwrites the
-- re-created content without a recovery copy. App v220 no longer re-creates a deleted identity,
-- but earlier apps (v219 and before, kept open in a tab or an installed PWA) do, and a v220 device
-- can still send expected revision 0 for an identity whose first answer was lost.
--
-- After: the post revision of one owner's identity only grows, across deletions.
-- * haedo_blog_private.retired_posts: one row per deleted identity with the highest revision it
--   reached (owner_id, post_id, revision, retired_at). No title, body, photo, workspace,
--   receipt or publication. RLS on, no privileges for any API role.
-- * An AFTER DELETE trigger on posts records it, so every deletion path records it, including a
--   delete_post that a replayed earlier install bundle re-creates.
-- * haedo_blog_private.save_post is haedo_blog_private.save (20261101091500) with one change: a
--   post created again (no row, expected revision 0) under a retired identity is stored at the
--   retired revision + 1 instead of 1, and that revision is the answer and the receipt.
--   public.life_blog_save now calls it. Every other answer, check, hash, receipt and lock is the
--   same. haedo_blog_private.save stays as it is, because the 20261101 install bundle re-creates
--   it; nothing calls it any more.
-- * A BEFORE INSERT trigger on posts refuses a row at or below the retired revision
--   (life_blog_revision_retired), in case a later replay brings back the earlier wrapper.
-- A device holding revision k (k <= retired revision) therefore sees another revision, receives
-- the re-created post when it has no change of its own, and gets a conflict (kept as a recovery
-- copy by the client) when it has one. An earlier app is not refused: its save is stored.
--
-- Unchanged: delete_post (it still refuses an active publication and removes the row, its
-- receipts and its publication row), every publish/withdraw path, reads, lists, receipts already
-- stored, privileges (CREATE OR REPLACE keeps the wrapper's ACL) and every existing row.
-- Identities deleted before this file was installed left no revision behind and are not covered.
--
-- One SQL Editor statement: the DDL and the preservation check share one atomic transaction even
-- when an installer autocommits each top-level statement. Applying it again changes nothing.
do $haedo_blog_retire$
declare relation text; n bigint; h text; before_rows jsonb:='{}'; prior jsonb;
 relations text[]:=array['haedo_blog_private.posts','haedo_blog_private.assets','haedo_blog_private.receipts','haedo_blog_private.publications','haedo_blog_private.profiles','haedo_blog_private.retired_posts'];
 wrapper text;
begin
 -- The delete trigger runs with the rights of delete_post's owner and writes retired_posts, which
 -- this statement creates and so owns: both must be the same role, or every deletion would fail.
 if (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure('haedo_blog_private.delete_post(uuid,bigint)')) is distinct from current_user::text
 or (select pg_get_userbyid(relowner) from pg_class where oid=to_regclass('haedo_blog_private.posts')) is distinct from current_user::text
 or (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure('haedo_blog_private.save(uuid,uuid,bigint,uuid,jsonb)')) is distinct from current_user::text then
  raise exception 'Run this as the owner of haedo_blog_private.posts, save and delete_post (now %); nothing was changed',current_user;
 end if;
 -- The routines this file copies or replaces must be the reviewed ones.
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('haedo_blog_private.save(uuid,uuid,bigint,uuid,jsonb)')) is distinct from 'b19da73c86a6d28a3430cf7c1d35666f' then
  raise exception 'haedo_blog_private.save differs from the repository definition (20261101091500); nothing was changed';
 end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('haedo_blog_private.delete_post(uuid,bigint)')) is distinct from '428df3b85623bbbccf220060e5db80cd' then
  raise exception 'haedo_blog_private.delete_post differs from the repository definition (20261101160000); nothing was changed';
 end if;
 wrapper:=(select md5(prosrc) from pg_proc where oid=to_regprocedure('public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)'));
 if wrapper is null or wrapper not in ('525b3f80d22992179296eea2df0e26fe','983ed6402056f10522ce2f7adba06bcf') then
  raise exception 'public.life_blog_save differs from the repository definition; nothing was changed';
 end if;
 foreach relation in array relations loop
  if to_regclass(relation) is null then continue; end if;
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  before_rows:=before_rows||jsonb_build_object(relation,jsonb_build_object('count',n,'hash',h));
 end loop;

 execute $retire_table$
create table if not exists haedo_blog_private.retired_posts (
  owner_id uuid not null, post_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  retired_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,post_id)
)
$retire_table$;
 execute 'alter table haedo_blog_private.retired_posts enable row level security';
 execute 'revoke all on table haedo_blog_private.retired_posts from public,anon,authenticated,service_role';

 execute $retire_record$
create or replace function haedo_blog_private.retire_post_revision()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin
 insert into haedo_blog_private.retired_posts as r(owner_id,post_id,revision) values(old.owner_id,old.id,old.revision)
 on conflict(owner_id,post_id) do update set revision=greatest(r.revision,excluded.revision),retired_at=clock_timestamp();
 return null;
end $fn$
$retire_record$;
 execute $retire_guard$
create or replace function haedo_blog_private.retired_revision_guard()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin
 if exists(select 1 from haedo_blog_private.retired_posts r where r.owner_id=new.owner_id and r.post_id=new.id and r.revision>=new.revision) then
  raise exception using errcode='22023',message='life_blog_revision_retired';
 end if;
 return new;
end $fn$
$retire_guard$;
 execute 'revoke all on function haedo_blog_private.retire_post_revision() from public,anon,authenticated,service_role';
 execute 'revoke all on function haedo_blog_private.retired_revision_guard() from public,anon,authenticated,service_role';
 execute 'drop trigger if exists blog_retire_post_revision on haedo_blog_private.posts';
 execute 'create trigger blog_retire_post_revision after delete on haedo_blog_private.posts for each row execute function haedo_blog_private.retire_post_revision()';
 execute 'drop trigger if exists blog_retired_revision_guard on haedo_blog_private.posts';
 execute 'create trigger blog_retired_revision_guard before insert on haedo_blog_private.posts for each row execute function haedo_blog_private.retired_revision_guard()';

 execute $retire_save$
create or replace function haedo_blog_private.save_post(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.posts%rowtype; r jsonb; rev bigint; retired bigint;
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
   -- Created again under a deleted identity: continue after the highest revision it reached.
   select t.revision into retired from haedo_blog_private.retired_posts t where t.owner_id=who and t.post_id=p_post_id;
   rev:=coalesce(retired,0)+1;
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
end $fn$
$retire_save$;
 execute 'revoke all on function haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role';
 execute 'grant execute on function haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb) to authenticated';
 -- CREATE OR REPLACE keeps the wrapper's owner and privileges (authenticated only).
 execute $retire_wrapper$
create or replace function public.life_blog_save(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $fn$select haedo_blog_private.save_post(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)$fn$
$retire_wrapper$;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)')) is distinct from '983ed6402056f10522ce2f7adba06bcf'
 or has_function_privilege('anon','public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)','execute')
 or not has_function_privilege('authenticated','public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)','execute')
 or has_function_privilege('anon','haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb)','execute')
 or (select not prosecdef or proconfig is distinct from array['search_path=pg_catalog'] or pg_get_userbyid(proowner) is distinct from current_user::text
     from pg_proc where oid='haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb)'::regprocedure)
 or (select count(*) from pg_proc where oid in ('haedo_blog_private.retire_post_revision()'::regprocedure,'haedo_blog_private.retired_revision_guard()'::regprocedure)
     and proconfig is not distinct from array['search_path=pg_catalog'] and pg_get_userbyid(proowner)=current_user::text)<>2
 or (select pg_get_userbyid(relowner) from pg_class where oid='haedo_blog_private.retired_posts'::regclass) is distinct from current_user::text
 or (select count(*) from pg_trigger where tgrelid='haedo_blog_private.posts'::regclass and tgname in ('blog_retire_post_revision','blog_retired_revision_guard') and tgenabled='O')<>2
 then raise exception 'Revision continuity install did not end in the expected state; rolled back'; end if;
 for relation,prior in select key,value from jsonb_each(before_rows) loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  if n is distinct from (prior->>'count')::bigint or h is distinct from prior->>'hash' then
   raise exception 'Revision continuity install changed %; rolled back',relation;
  end if;
 end loop;
 if not before_rows ? 'haedo_blog_private.retired_posts' and (select count(*) from haedo_blog_private.retired_posts)<>0 then
  raise exception 'Revision continuity install wrote retired rows; rolled back';
 end if;
 perform pg_notify('pgrst','reload schema');
end
$haedo_blog_retire$;
