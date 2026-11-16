-- Read-only check for 20261116120000_life_blog_public_choice.sql (public name/intro saved on
-- their own; attachments chosen on every publish path). Run it before and after the install
-- and record the output. It reads catalog facts and row COUNTS only: no post body, title,
-- name, intro, token or key is selected. ASCII only; no backslash escapes.
--
-- Before the install every row of `fn` must show state 'before' (and 'missing' for the new
-- functions), after it every row must show 'after' ('both' where the body does not change).
-- `ok` is true for a row with the expected owner, SECURITY DEFINER flag, search_path and the
-- EXECUTE roles of that phase (`installed`: the new public signature exists). The one row whose
-- body stays and whose roles change is haedo_blog_private.publish(6): authenticated before,
-- none after.
-- The install itself refuses drifted functions and rolls back if any blog row count or row hash
-- changes, so this file is the record, not the guard.
begin read only;
with phase as (select to_regprocedure('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)') is not null installed),
expected0(sig, before_md5, after_md5, definer, roles) as (values
 ('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)','d872bf11fc983b14e4d61ff36be6932d','d872bf11fc983b14e4d61ff36be6932d',true,'@phase'),
 ('haedo_blog_private.publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','fa7f1208a0826e68d8f668eb57a9f850','9e710461ca227bc24884ea8413171452',true,'authenticated'),
 ('haedo_blog_private.markdown_publish_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','61a1318052863d5962a68dac78ac519a','0a44bd28c2ca59d2f91cfc51bf06fad6',false,''),
 ('haedo_blog_private.markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','2acda7ffcb7a1022e0a30839245fee90','e79a0028dfe2e15083d2da13410f0a32',true,'authenticated'),
 ('haedo_blog_private.markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','34dcb685b3618f0e2196b0aa5f66c4ac','13804bdfdd99720909f99e4efe7484f7',true,'service_role'),
 ('public.life_blog_publish(uuid,bigint,uuid,text[],jsonb,bigint)','8643627f00ef0dc03fe9fc482680143b','8643627f00ef0dc03fe9fc482680143b',false,'authenticated'),
 ('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','f8388d221711fba02097d32c625ece7d',null,false,'authenticated'),
 ('public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)','da03875443592714fdfacfd3cba1553a',null,false,'authenticated'),
 ('public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb)','5dba0aab863547721973a6529725e839',null,false,'service_role'),
 ('haedo_blog_private.valid_attachment_choice(jsonb)',null,'bf2396750df4960fd4a7f2fc0ce41df0',false,''),
 ('haedo_blog_private.picked_attachments(jsonb,jsonb)',null,'1051f3cd08ac58c9429fbca898fa782f',false,''),
 ('haedo_blog_private.publish_request_hash(bigint,text[],jsonb,bigint,jsonb,jsonb)',null,'bd65635d990f7d774096826069e59c40',false,''),
 ('haedo_blog_private.publish_choice(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)',null,'bfd3576259f12a7c9f35e90747aab337',true,'authenticated'),
 ('haedo_blog_private.markdown_choice_hash(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)',null,'a6413a04775ff4910750b27da3d3c456',false,''),
 ('haedo_blog_private.markdown_choice_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)',null,'f2bf656b49db16f132cce1ae8d756a91',true,'authenticated'),
 ('haedo_blog_private.markdown_choice_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)',null,'2268d8723c0bee9ab11ff0a6c0c94284',true,'service_role'),
 ('haedo_blog_private.get_public_profile()',null,'ab47a601e7919e9073b20a5d626aaa64',true,'authenticated'),
 ('haedo_blog_private.set_public_profile(jsonb)',null,'4ca454ce39ad4e786d34f69fa57a3a63',true,'authenticated'),
 ('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)',null,'b66b5645a4bea91e4086278509c3a44c',false,'authenticated'),
 ('public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)',null,'7d5438e0b532d12a09ee07a3e53366a2',false,'authenticated'),
 ('public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)',null,'e359e1737c3122056d6123f8c1485c20',false,'service_role'),
 ('public.life_blog_get_public_profile()',null,'976079046e16fd6c0b904a144521d5e3',false,'authenticated'),
 ('public.life_blog_set_public_profile(jsonb)',null,'fe15181ff09eac701d54d4e4c182c9d2',false,'authenticated')
), expected as (
 select sig, before_md5, after_md5, definer, case when roles='@phase' then case when (select installed from phase) then '' else 'authenticated' end else roles end roles from expected0
), fn as (
 select e.sig, md5(p.prosrc) src_md5,
  case when p.oid is null then 'missing' when md5(p.prosrc)=e.after_md5 and md5(p.prosrc)=e.before_md5 then 'both'
   when md5(p.prosrc)=e.after_md5 then 'after' when md5(p.prosrc)=e.before_md5 then 'before' else 'DIFFERENT' end state,
  pg_get_userbyid(p.proowner) owner, p.prosecdef definer, p.proconfig::text config,
  (select string_agg(r,',' order by r) from unnest(array['anon','authenticated','service_role']) r where p.oid is not null and has_function_privilege(r,p.oid,'execute')) roles,
  e.definer want_definer, e.roles want_roles
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.sig)
)
select 'fn' kind, sig item, state, src_md5, owner, definer, config, coalesce(roles,'') roles,
 (state='missing' or (owner=current_user and definer=want_definer and config='{search_path=pg_catalog}' and coalesce(roles,'')=want_roles)) ok
from fn
union all
select 'rows', relation, n::text, null, null, null, null, null, true from (values
 ('haedo_blog_private.posts',(select count(*) from haedo_blog_private.posts)),
 ('haedo_blog_private.assets',(select count(*) from haedo_blog_private.assets)),
 ('haedo_blog_private.receipts',(select count(*) from haedo_blog_private.receipts)),
 ('haedo_blog_private.publications',(select count(*) from haedo_blog_private.publications)),
 ('haedo_blog_private.publications active',(select count(*) from haedo_blog_private.publications where active)),
 ('haedo_blog_private.publications active with attachments',(select count(*) from haedo_blog_private.publications where active and jsonb_array_length(coalesce(snapshot->'attachments','[]'::jsonb))>0)),
 ('haedo_blog_private.profiles',(select count(*) from haedo_blog_private.profiles)),
 ('haedo_blog_private.retired_posts',(select count(*) from haedo_blog_private.retired_posts))) r(relation,n)
union all
select 'phase', 'installed', (select installed from phase)::text, null, null, null, null, null, true
union all
select 'role', 'current_user', current_user::text, null, null, null, null, null,
 current_user::text=(select pg_get_userbyid(relowner) from pg_class where oid='haedo_blog_private.profiles'::regclass)
order by 1,2;
rollback;
