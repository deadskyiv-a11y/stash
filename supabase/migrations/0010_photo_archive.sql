-- Archived photographs are put out of sight without being removed: hidden from the grid, the map,
-- search and the large view until Kofi opens the archive. The original in Drive is untouched.
alter table public.photos add column if not exists archived boolean not null default false;
