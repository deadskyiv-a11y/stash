-- What the AI sees in each photograph: a subject to group by, tags and a one-line description to search by.
-- tagged marks a photo the AI has already read. ai_in and ai_out record the tokens that reading used, so the cost can be measured.
alter table public.photos
  add column if not exists tags text[] not null default '{}',
  add column if not exists caption text,
  add column if not exists subject text,
  add column if not exists tagged boolean not null default false,
  add column if not exists ai_in integer,
  add column if not exists ai_out integer;
