-- Permisos del brain por carpeta y por página (spec etapa 17 §4).
-- Antes de tocar SQL: supabase-postgres-best-practices (índices en claves
-- foráneas, RLS sin políticas, mínimo privilegio).

create type public.brain_access_principal as enum ('user', 'members');
create type public.brain_access_level as enum ('lector', 'editor', 'administrador', 'ninguno');

create table public.brain_access_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- '' es la raíz del brain; cualquier otra ruta es un slug (carpeta o página).
  path text not null check (
    path = ''
    or (
      char_length(path) <= 200
      and path ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'
    )
  ),
  principal public.brain_access_principal not null,
  user_id uuid references auth.users (id) on delete cascade,
  level public.brain_access_level not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brain_access_rules_user_matches_principal
    check ((principal = 'user') = (user_id is not null)),
  -- "ninguno" restringe: solo tiene sentido como acceso general del nodo.
  constraint brain_access_rules_ninguno_only_members
    check (principal = 'members' or level <> 'ninguno')
);

-- Una sola fila "todos los miembros" por nodo: user_id nulo cuenta como igual.
create unique index brain_access_rules_unique
  on public.brain_access_rules (tenant_id, path, principal, user_id) nulls not distinct;
create index brain_access_rules_user_id_idx on public.brain_access_rules (user_id);
create index brain_access_rules_created_by_idx on public.brain_access_rules (created_by);

-- Solo el servidor (service_role) lee y escribe: la decisión de acceso se toma
-- en código (withAccess) y la sesión de una persona nunca toca esta tabla.
alter table public.brain_access_rules enable row level security;
revoke all on public.brain_access_rules from anon, authenticated;

-- Cierre del agujero de lectura: hasta hoy cualquier miembro con sesión podía
-- consultar brain_pages y brain_revisions por la API de Supabase y saltearse la
-- app. Desde ahora lee solo el servidor, a través del proveedor del brain.
drop policy brain_pages_select on public.brain_pages;
drop policy brain_revisions_select on public.brain_revisions;
revoke select on public.brain_pages from authenticated;
revoke select on public.brain_revisions from authenticated;

-- La raíz nace abierta (A3): todos los miembros leen. El código también trata
-- la ausencia de esta fila como "lector", así que un olvido no cierra un brain.
insert into public.brain_access_rules (tenant_id, path, principal, level)
select distinct tenant_id, '', 'members'::public.brain_access_principal, 'lector'::public.brain_access_level
from public.tenant_connections
where capability = 'brain' and enabled
on conflict do nothing;
