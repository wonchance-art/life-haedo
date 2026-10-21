-- Synthetic ownership checks only. Everything is rolled back.
begin;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'life_account_materials' and c.relrowsecurity
  ) then raise exception 'account_materials_rls_required'; end if;
  if has_table_privilege('anon', 'public.life_account_materials', 'SELECT')
    or has_table_privilege('authenticated', 'public.life_account_materials', 'INSERT')
    or has_table_privilege('authenticated', 'public.life_account_materials', 'UPDATE')
    or has_table_privilege('authenticated', 'public.life_account_materials', 'DELETE') then
    raise exception 'account_materials_unexpected_grant';
  end if;
end $$;

insert into public.life_workspaces (owner_id, id, title, revision, data)
select owner, workspace, 'Synthetic account material', 1,
  jsonb_build_object('schemaVersion', 1, 'workspaceId', workspace::text)
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'b0000000-0000-4000-8000-000000000002'::uuid)
) as fixture(owner, workspace);

insert into public.life_account_materials (owner_id, id, workspace_id, workspace_revision)
values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 1);

do $$
begin
  begin
    insert into public.life_account_materials (owner_id, id, workspace_id, workspace_revision)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 1);
    raise exception 'account_materials_foreign_pointer_accepted';
  exception when foreign_key_violation then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.life_account_materials
      where id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')) <> 1 then
    raise exception 'account_materials_owner_read_failed';
  end if;
  if exists (select 1 from public.life_account_materials
             where id = 'c0000000-0000-4000-8000-000000000002') then
    raise exception 'account_materials_foreign_read';
  end if;
end $$;
reset role;

rollback;
