-- Dedicated haedo project only. Never migrate the unrelated projects or legacy charts.
create table public.haedo_documents (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.haedo_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('goal', 'habit')),
  name text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);
create index haedo_documents_user_updated on public.haedo_documents(user_id, updated_at desc);
create index haedo_items_user_updated on public.haedo_items(user_id, updated_at desc);
alter table public.haedo_documents enable row level security;
alter table public.haedo_items enable row level security;
revoke all on public.haedo_documents, public.haedo_items from anon, authenticated;
grant select, insert, update, delete on public.haedo_documents, public.haedo_items to authenticated;
create policy "document owner" on public.haedo_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "item owner" on public.haedo_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create function public.haedo_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.haedo_stamp() from public, anon, authenticated;
create trigger haedo_documents_stamp before insert or update on public.haedo_documents
  for each row execute function public.haedo_stamp();
create trigger haedo_items_stamp before insert or update on public.haedo_items
  for each row execute function public.haedo_stamp();
