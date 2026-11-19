-- A recipe the AI has written out for a save about cooking: dish, servings, time, ingredients, steps,
-- and whether it came from the post itself or was filled in by the AI.
alter table public.saves add column if not exists recipe jsonb;
