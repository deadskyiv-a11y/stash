-- Stash: initial schema. One private store per signed-in owner.

create extension if not exists vector with schema extensions;

-- Who may use the app. Kept out of the public API.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table private.allowed_emails (
  email text primary key
);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.allowed_emails a
    where lower(a.email) = lower((select auth.jwt() ->> 'email'))
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('link', 'image', 'note', 'file')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  url text,
  site text,
  title text,
  summary text,
  note text,
  tags text[] not null default '{}',
  cluster text,
  subgroup text,
  facts jsonb not null default '[]'::jsonb,
  image_path text,
  image_w integer,
  image_h integer,
  is_pale boolean not null default false,
  pinned boolean not null default false,
  content text,
  search_text text,
  fts tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored,
  embedding extensions.vector(384),
  created_at timestamptz not null default now()
);

create index saves_user_created_idx on public.saves (user_id, created_at desc);
create index saves_fts_idx on public.saves using gin (fts);
create index saves_embedding_idx on public.saves using hnsw (embedding extensions.vector_cosine_ops);

alter table public.saves enable row level security;

create policy "owner reads own saves" on public.saves
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner adds own saves" on public.saves
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner changes own saves" on public.saves
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()))
  with check (user_id = (select auth.uid()) and (select public.is_owner()));

create policy "owner removes own saves" on public.saves
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_owner()));

-- Search by meaning and by exact words, blended by rank.
create or replace function public.search_saves(
  query_text text,
  query_embedding extensions.vector(384),
  match_count integer default 60,
  min_similarity double precision default 0.8
)
returns table (id uuid, score double precision, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with words as (
    select s.id,
           row_number() over (order by ts_rank_cd(s.fts, websearch_to_tsquery('english', query_text)) desc) as rn
    from public.saves s
    where query_text <> '' and s.fts @@ websearch_to_tsquery('english', query_text)
    limit 60
  ),
  meaning as (
    select s.id,
           1 - (s.embedding <=> query_embedding) as sim,
           row_number() over (order by s.embedding <=> query_embedding) as rn
    from public.saves s
    where query_embedding is not null
      and s.embedding is not null
      and 1 - (s.embedding <=> query_embedding) >= min_similarity
    order by s.embedding <=> query_embedding
    limit 60
  )
  select coalesce(w.id, m.id) as id,
         coalesce(1.0 / (60 + w.rn), 0) + coalesce(1.0 / (60 + m.rn), 0) as score,
         m.sim as similarity
  from words w
  full outer join meaning m on m.id = w.id
  order by score desc
  limit match_count;
$$;

revoke all on function public.search_saves(text, extensions.vector, integer, double precision) from public, anon;
grant execute on function public.search_saves(text, extensions.vector, integer, double precision) to authenticated;

-- Private file storage for preview images and uploads. Files live under <user id>/.
insert into storage.buckets (id, name, public, file_size_limit)
values ('saves', 'saves', false, 20971520)
on conflict (id) do nothing;

create policy "owner reads own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()));

create policy "owner adds own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()));

create policy "owner changes own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()));

create policy "owner removes own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()));
