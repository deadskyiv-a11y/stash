-- The order Kofi has put a project's photographs in, as a list of photo ids, first to last.
-- A photo in the project but not in the list comes after the listed ones, oldest first.
create table public.project_orders (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project text not null,
  ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, project)
);

alter table public.project_orders enable row level security;

create policy "owner reads own orders" on public.project_orders
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner adds own orders" on public.project_orders
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner changes own orders" on public.project_orders
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner removes own orders" on public.project_orders
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));
