-- Where a saved document (a PDF) lives in the private "saves" bucket.
-- image_path stays for pictures; a document has no picture of its own yet.
alter table public.saves add column if not exists file_path text;
