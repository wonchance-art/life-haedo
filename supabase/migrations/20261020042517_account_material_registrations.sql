-- A private pointer to an existing, explicitly registered material snapshot.
-- Bodies remain in life_workspaces; clients cannot create registrations.
begin;

create table if not exists public.life_account_materials (
  owner_id uuid not null,
  id uuid not null,
  workspace_id uuid not null,
  workspace_revision bigint not null check (workspace_revision between 1 and 9007199254740991),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, workspace_id),
  foreign key (owner_id, workspace_id)
    references public.life_workspaces (owner_id, id) on delete restrict
);

alter table public.life_account_materials enable row level security;
revoke all on table public.life_account_materials from public, anon, authenticated;
grant select on table public.life_account_materials to authenticated;

drop policy if exists life_account_materials_owner_read on public.life_account_materials;
create policy life_account_materials_owner_read on public.life_account_materials
  for select to authenticated using (owner_id = (select auth.uid()));

comment on table public.life_account_materials is
  'Owner-readable registrations of exact existing material snapshots; no duplicated bodies or browser mutation grants.';

commit;
