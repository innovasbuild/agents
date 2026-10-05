-- Spec consola de plataforma §4: app/plataforma es una ruta de primer nivel,
-- así que su palabra entra en la lista de slugs reservados.
do $$
begin
  if exists (select 1 from public.tenants where slug = 'plataforma') then
    raise exception 'hay un tenant con el slug reservado "plataforma". Cambiá el slug antes de aplicar esta migración';
  end if;
end $$;

alter table public.tenants
  drop constraint tenants_slug_not_reserved;

alter table public.tenants
  add constraint tenants_slug_not_reserved
  check (slug not in ('api', 'auth', 'brain', 'eve', 'login', 'oauth', 'plataforma', 'sin-acceso'));
