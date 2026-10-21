-- Disposable PostgreSQL only. Never install this shim in a hosted project.
do $$begin
 if current_database() !~ '^haedo_naver_' then raise exception 'An isolated haedo_naver_* database is required';end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end$$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.haedo_naver_test_isolation(singleton boolean primary key check(singleton));
insert into public.haedo_naver_test_isolation values(true);
