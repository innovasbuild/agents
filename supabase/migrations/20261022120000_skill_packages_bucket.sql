-- Zips publicados de las skills (spec etapa 24.2b §5). Privado y sin
-- políticas en storage.objects: solo el servidor sube y firma links.
-- Objeto en <tenant_id>/<digest>.zip. 26 MB: el paquete llega a 20 MB y un
-- zip de archivos que no comprimen pesa apenas más.
insert into storage.buckets (id, name, public, file_size_limit)
values ('skill-packages', 'skill-packages', false, 27262976)
on conflict (id) do nothing;
