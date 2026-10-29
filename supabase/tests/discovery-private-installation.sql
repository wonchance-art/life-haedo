-- Read-only structure inspection; does not read any account article or Auth row.
begin read only;
do $check$
declare n text;f record;
begin
 foreach n in array array['articles','limits'] loop
  if not exists(select 1 from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='haedo_discovery_private' and c.relname=n and c.relrowsecurity) then raise exception 'life_discovery_rls_missing: %',n;end if;
  if has_table_privilege('anon','haedo_discovery_private.'||n,'SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated','haedo_discovery_private.'||n,'SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('service_role','haedo_discovery_private.'||n,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'life_discovery_direct_grant: %',n;end if;
 end loop;
 if has_schema_privilege('anon','haedo_discovery_private','USAGE') then raise exception 'life_discovery_anonymous_schema';end if;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='haedo_discovery_private' loop
  if has_function_privilege('anon',f.oid,'EXECUTE') or f.proconfig is distinct from array['search_path=pg_catalog'] then raise exception 'life_discovery_helper_security: %',f.proname;end if;
  if has_function_privilege('authenticated',f.oid,'EXECUTE')<>(f.proname='claim')
   or has_function_privilege('service_role',f.oid,'EXECUTE')<>(f.proname='finish') then raise exception 'life_discovery_helper_grant: %',f.proname;end if;
 end loop;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname in ('life_discovery_article_claim','life_discovery_article_finish') loop
  if f.prosecdef or f.proconfig is distinct from array['search_path=pg_catalog'] or has_function_privilege('anon',f.oid,'EXECUTE')
   or has_function_privilege('authenticated',f.oid,'EXECUTE')<>(f.proname='life_discovery_article_claim')
   or has_function_privilege('service_role',f.oid,'EXECUTE')<>(f.proname='life_discovery_article_finish') then raise exception 'life_discovery_wrapper_security: %',f.proname;end if;
 end loop;
 if to_regprocedure('public.life_discovery_article_claim(text,text)') is null or
  to_regprocedure('public.life_discovery_article_finish(uuid,text,text,uuid,jsonb,text)') is null then raise exception 'life_discovery_rpc_missing';end if;
end $check$;
rollback;
