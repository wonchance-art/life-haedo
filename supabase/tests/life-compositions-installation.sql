-- READ-ONLY administrator metadata check. No private rows or test records read/written.
with routines(signature, authenticated_allowed, definer) as (
  values ('public.life_composition_text_valid(jsonb,integer,boolean)',false,false),
         ('public.life_composition_ids_valid(jsonb,integer)',false,false),
         ('public.life_composition_json_bytes(jsonb)',false,false),
         ('public.life_composition_valid(jsonb)',false,false),
         ('public.life_composition_get(uuid)',true,true),
         ('public.life_composition_put(uuid,bigint,uuid,bigint,jsonb)',true,true)
), checks as (
  select 'routine ' || signature as check_name,
    coalesce(p.oid is not null and p.prosecdef=r.definer and p.proconfig @> array['search_path=pg_catalog']
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and has_function_privilege('authenticated',p.oid,'EXECUTE')=r.authenticated_allowed
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as passed
    from routines r left join pg_proc p on p.oid=to_regprocedure(r.signature)
  union all
  select 'private RLS table ' || name,
    coalesce(c.oid is not null and c.relrowsecurity
      and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not exists(select 1 from pg_policy where polrelid=c.oid),false)
    from (values ('life_compositions'),('life_composition_receipts')) t(name)
    left join pg_class c on c.oid=to_regclass('public.' || name)
  union all
  select 'composition identity and validation constraints',count(*)=2 from pg_constraint
    where conrelid=to_regclass('public.life_compositions')
      and conname in ('life_compositions_pkey','life_composition_state')
  union all
  select 'original deletion removes only matching owner/workspace composition',exists(
    select 1 from pg_constraint fk
    where fk.conrelid=to_regclass('public.life_compositions')
      and fk.confrelid=to_regclass('public.life_workspaces') and fk.contype='f' and fk.confdeltype='c'
      and (select array_agg(a.attname::text order by k.ord) from unnest(fk.conkey) with ordinality k(num,ord)
        join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num)=array['owner_id','workspace_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(fk.confkey) with ordinality k(num,ord)
        join pg_attribute a on a.attrelid=fk.confrelid and a.attnum=k.num)=array['owner_id','id'])
  union all
  select 'composition deletion removes matching owner/workspace receipts',exists(
    select 1 from pg_constraint fk
    where fk.conrelid=to_regclass('public.life_composition_receipts')
      and fk.confrelid=to_regclass('public.life_compositions') and fk.contype='f' and fk.confdeltype='c'
      and (select array_agg(a.attname::text order by k.ord) from unnest(fk.conkey) with ordinality k(num,ord)
        join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num)=array['owner_id','workspace_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(fk.confkey) with ordinality k(num,ord)
        join pg_attribute a on a.attrelid=fk.confrelid and a.attnum=k.num)=array['owner_id','workspace_id'])
)
select check_name,passed from checks order by check_name;
