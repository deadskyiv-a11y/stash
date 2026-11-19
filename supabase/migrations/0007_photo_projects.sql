-- Projects: a photograph can belong to several (a photo book, an exhibition, a client job) or none.
-- Kept as a list of names on the photo. The list of projects is simply every name in use.
alter table public.photos add column if not exists projects text[] not null default '{}';

-- Adds a project to many photos, or takes it off them, in one call. Runs as the caller, so the
-- row rules still decide which photos it may touch.
create or replace function public.set_photo_project(ids uuid[], project text, add boolean)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.photos
  set projects = case
    when add then (case when project = any(projects) then projects else array_append(projects, project) end)
    else array_remove(projects, project)
  end
  where id = any(ids);
$$;

revoke all on function public.set_photo_project(uuid[], text, boolean) from public, anon;
grant execute on function public.set_photo_project(uuid[], text, boolean) to authenticated;
