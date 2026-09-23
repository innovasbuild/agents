-- Firma de mail por ejecutor (nombre, puesto, LinkedIn). Mismo patrón de
-- escritura que el resto de `executors`: sin RLS de escritura, la carga solo
-- el server con service role vía scripts/executors-set.mts.
alter table public.executors
  add column display_name text check (display_name is null or length(display_name) between 1 and 120),
  add column title text check (title is null or length(title) between 1 and 120),
  add column linkedin_url text check (
    linkedin_url is null or linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/.+'
  );
