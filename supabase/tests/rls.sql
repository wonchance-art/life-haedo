-- Anonymous fixtures only. Every user and row is rolled back at the end.
begin;
create temporary table haedo_test_users as select gen_random_uuid() as a, gen_random_uuid() as b;
grant select on haedo_test_users to authenticated, anon;
insert into auth.users(id, email, aud, role)
  select a, 'fixture-a-' || a || '@example.invalid', 'authenticated', 'authenticated' from haedo_test_users
  union all select b, 'fixture-b-' || b || '@example.invalid', 'authenticated', 'authenticated' from haedo_test_users;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true) from haedo_test_users;
insert into public.haedo_documents(id, user_id, name, data, updated_at)
  select 'fixture-' || a, a, 'Anonymous', '{"profile":{"name":"Anonymous","birth":"1990-01"},"events":[]}', '1900-01-01' from haedo_test_users;
insert into public.haedo_items(id, user_id, kind, name, data)
  select 'fixture-' || a, a, 'goal', 'Anonymous', '{"title":"Anonymous","progress":0}' from haedo_test_users;
do $$
declare rejected boolean := false;
begin
  if (select count(*) from public.haedo_documents) <> 1 or (select count(*) from public.haedo_items) <> 1 then raise exception 'Owner read failed'; end if;
  if exists (select 1 from public.haedo_documents where updated_at = '1900-01-01') then raise exception 'Server timestamp failed'; end if;
  begin
    insert into public.haedo_documents(id, user_id, name, data)
      select 'spoof-' || b, b, 'Anonymous', '{}' from haedo_test_users;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Cross-owner insert allowed'; end if;
  rejected := false;
  begin
    update public.haedo_items set user_id = (select b from haedo_test_users);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Ownership reassignment allowed'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true) from haedo_test_users;
do $$
declare changed integer;
begin
  if (select count(*) from public.haedo_documents) <> 0 or (select count(*) from public.haedo_items) <> 0 then raise exception 'Other account read allowed'; end if;
  update public.haedo_documents set name='spoof'; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Other account update allowed'; end if;
  delete from public.haedo_items; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Other account delete allowed'; end if;
end $$;
set local role anon;
do $$
declare rejected boolean := false;
begin
  begin perform count(*) from public.haedo_documents;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Anonymous document access allowed'; end if;
  rejected := false;
  begin perform count(*) from public.haedo_items;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Anonymous item access allowed'; end if;
end $$;
rollback;
