-- Withdrawal before any publication (2026-11-11, publication recovery review R2-M1).
--
-- haedo_blog_private.unpublish answered "missing" when a post had no publication row, and
-- changed nothing. A first publication request whose answer was lost (expected publication
-- revision 0) could therefore still be applied after the owner withdrew: nothing on the
-- server had moved. With an expected revision of 0 the withdrawal now records a withdrawn
-- (not active) row at publication revision 1, with its receipt. Every publish path checks
-- the publication revision (publish, publish_copies, markdown_publish_prepare and
-- markdown_publish_commit: coalesce(revision,0) <> expected -> conflict), so the late
-- request ends in conflict.
--
-- Unchanged: the signature, SECURITY DEFINER, search_path, owner and privileges (CREATE OR
-- REPLACE keeps the existing ACL; nothing is granted or revoked here), the receipt replay,
-- the request hash, withdrawing an existing row at its exact revision, "missing" for an
-- expected revision of 1 or more without a row, and "conflict" for any other revision.
-- The earlier definition is 20261017144744_life_blog_originals.sql (the only other one).
--
-- The new row:
-- - is never active: public_read, public_list and public_media read active rows only, and
--   delete_post refuses only active rows and removes this one with the post;
-- - carries a token because the column is NOT NULL UNIQUE. It is not a public address:
--   nothing answers for it, and the first real publication creates its own token (every
--   publish path does so when the earlier row is not active);
-- - needs a profile row to be visible to its owner: owner_publication (read, list,
--   sync_list) joins profiles. One with the default empty author is added only when the
--   owner has none; an existing name and intro are never touched. A profile without an
--   active publication is shown to nobody (public_list answers an empty author).
--
-- No existing row is changed by installing this file. One SQL Editor statement: the DDL and
-- the preservation check share one atomic transaction even when an installer autocommits
-- each top-level statement.
do $haedo_blog_withdraw$
declare relation text; n bigint; h text; before_rows jsonb:='{}'; prior jsonb;
begin
 foreach relation in array array['haedo_blog_private.posts','haedo_blog_private.assets','haedo_blog_private.receipts','haedo_blog_private.publications','haedo_blog_private.profiles'] loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  before_rows:=before_rows||jsonb_build_object(relation,jsonb_build_object('count',n,'hash',h));
 end loop;
 execute $withdraw_ddl$
create or replace function haedo_blog_private.unpublish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.publications%rowtype; source_revision bigint; r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 h:=sha256(convert_to(jsonb_build_array('unpublish',p_expected_revision)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.publications where owner_id=who and post_id=p_post_id for update;
 if not found then
  -- Expected revision 0: the caller knows of no publication. Any other expectation keeps the earlier answer.
  if p_expected_revision<>0 then return '{"status":"missing"}'::jsonb; end if;
  select revision into source_revision from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
  if not found then return '{"status":"missing"}'::jsonb; end if;
  insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;
  insert into haedo_blog_private.publications(owner_id,post_id,token,revision,source_revision,active,snapshot,media)
  values(who,p_post_id,gen_random_uuid(),1,source_revision,false,null,null);
  r:=jsonb_build_object('status','stored','revision',1);
  insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
  return r;
 end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 update haedo_blog_private.publications set active=false,snapshot=null,media=null,revision=revision+1,updated_at=clock_timestamp() where owner_id=who and post_id=p_post_id;
 r:=jsonb_build_object('status','stored','revision',p.revision+1);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $fn$;
$withdraw_ddl$;
 for relation,prior in select key,value from jsonb_each(before_rows) loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),%L),%L)),%L) from %s t','','UTF8','hex',relation) into n,h;
  if n is distinct from (prior->>'count')::bigint or h is distinct from prior->>'hash' then
   raise exception 'Withdrawal install changed %; rolled back',relation;
  end if;
 end loop;
 perform pg_notify('pgrst','reload schema');
end
$haedo_blog_withdraw$;
