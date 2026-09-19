-- Realtime para /pipeline. Mismo patrón que
-- 20260916120000_realtime_queue_items.sql: la autorización sigue siendo la
-- RLS (contacts_select), así que cada usuario recibe los cambios de las
-- filas de su tenant y de ninguna otra.
alter publication supabase_realtime add table public.contacts;

-- replica identity full: sin esto, el payload de un UPDATE solo trae las
-- columnas de la PK, y Realtime no tiene con qué evaluar contacts_select
-- (que filtra por tenant_id) contra la fila vieja.
alter table public.contacts replica identity full;
