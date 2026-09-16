-- Realtime para la cola del dashboard. La autorización sigue siendo la RLS:
-- Realtime respeta queue_items_select, así que cada usuario recibe los
-- cambios de las filas de su tenant y de ninguna otra.
alter publication supabase_realtime add table public.queue_items;

-- replica identity full: sin esto, el payload de un UPDATE solo trae las
-- columnas de la PK y el cliente no puede saber si la pieza que cambió
-- todavía le corresponde mostrar.
alter table public.queue_items replica identity full;
