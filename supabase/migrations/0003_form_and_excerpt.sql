-- form: what kind of thing a save is (article, video, music, film, other), chosen by the AI.
--       Articles get a caption under their picture on the canvas.
-- excerpt: the page's own opening words, shown in that caption.
alter table public.saves add column if not exists form text;
alter table public.saves add column if not exists excerpt text;
