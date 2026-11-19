-- The photo room: Kofi's selected photographs. The original file lives in his Google Drive;
-- only a thumbnail (in the private "saves" bucket, under <user id>/photos/) and these details stay here.
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  bytes bigint,
  drive_id text,
  drive_link text,
  drive_folder text,
  thumb_path text,
  w integer,
  h integer,
  taken_at timestamptz,
  lat double precision,
  lng double precision,
  place text,
  camera text,
  lens text,
  settings text,
  rating integer,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index photos_user_taken_idx on public.photos (user_id, taken_at desc nulls last);

alter table public.photos enable row level security;

create policy "owner reads own photos" on public.photos
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner adds own photos" on public.photos
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner changes own photos" on public.photos
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner removes own photos" on public.photos
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));
