-- The film stock a photograph was shot on, typed in by Kofi for scans of film.
alter table public.photos add column if not exists film text;
