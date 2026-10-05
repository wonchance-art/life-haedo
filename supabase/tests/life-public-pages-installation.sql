-- Read-only administrator installation check. Does not read personal rows,
-- create test accounts/pages, or change any installed permissions.
with routines(signature, anonymous_allowed, authenticated_allowed, definer) as (
  values ('public.life_public_page_valid(jsonb)',false,false,false),
         ('public.life_public_page_text_valid(jsonb,integer,boolean)',false,false,false),
         ('public.life_public_page_json_bytes(jsonb)',false,false,false),
         ('public.life_public_page_get(uuid)',false,true,true),
         ('public.life_public_page_put(uuid,bigint,uuid,text,jsonb)',false,true,true),
         ('public.life_public_page_read(uuid)',true,true,true)
         ,('public.life_public_page_list(uuid)',false,true,true)
), checks as (
  select 'routine ' || signature as check_name,
    coalesce(p.oid is not null and p.prosecdef = r.definer and p.proconfig @> array['search_path=pg_catalog']
      and has_function_privilege('anon',p.oid,'EXECUTE') = r.anonymous_allowed
      and has_function_privilege('authenticated',p.oid,'EXECUTE') = r.authenticated_allowed
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as passed
    from routines r left join pg_proc p on p.oid=to_regprocedure(r.signature)
  union all
  select 'private RLS table ' || name,
    coalesce(c.oid is not null and c.relrowsecurity
      and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
    from (values ('life_public_pages'),('life_public_page_receipts')) t(name)
    left join pg_class c on c.oid=to_regclass('public.' || name)
  union all
  select 'page identity and public ID constraints',
    count(*)=3 from pg_constraint where conrelid=to_regclass('public.life_public_pages')
      and conname in ('life_public_pages_pkey','life_public_pages_public_id_key','life_public_page_state')
  union all
  select 'account deletion removes public copies',exists(
    select 1 from pg_constraint where conrelid=to_regclass('public.life_public_pages')
      and confrelid=to_regclass('auth.users') and contype='f' and confdeltype='c')
  union all
  select 'page deletion removes receipts',exists(
    select 1 from pg_constraint where conrelid=to_regclass('public.life_public_page_receipts')
      and confrelid=to_regclass('public.life_public_pages') and contype='f' and confdeltype='c')
)
select check_name,passed from checks order by check_name;
