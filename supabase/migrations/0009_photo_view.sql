-- A larger preview of each photograph (about 1800 pixels on the long side), for looking at it properly
-- without fetching the full original from Drive. Kept beside the thumbnail in the private "saves" bucket.
alter table public.photos add column if not exists view_path text;
