-- Spec etapa 11: un tenant con slug igual a una ruta de primer nivel de
-- app/ (p. ej. "brain") quedaría tapado por esa ruta estática y fuera del
-- refresh de sesión del proxy. Se reserva la palabra a nivel de base.
do $$
declare
  conflicto text;
begin
  select string_agg(slug, ', ') into conflicto
  from public.tenants
  where slug in ('api', 'auth', 'brain', 'eve', 'login', 'oauth', 'sin-acceso');

  if conflicto is not null then
    raise exception 'hay tenants con un slug reservado por una ruta de primer nivel: %. Cambiá el slug antes de aplicar esta migración', conflicto;
  end if;
end $$;

-- Palabras de las rutas de primer nivel de app/: agregar una ruta nueva acá
-- requiere agregar su palabra a esta lista.
alter table public.tenants
  add constraint tenants_slug_not_reserved
  check (slug not in ('api', 'auth', 'brain', 'eve', 'login', 'oauth', 'sin-acceso'));
