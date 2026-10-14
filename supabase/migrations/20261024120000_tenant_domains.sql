-- supabase/migrations/20261024120000_tenant_domains.sql
-- Etapa 21.6a: dominio propio por empresa (spec 2026-10-14-etapa-21-6-dominio-por-empresa).
-- Una fila por hostname completo (ai.okeefe.com.ar). El host decide la empresa:
-- el proxy lo resuelve con resolve_tenant_by_host y reescribe a /<slug>/...
--
-- Hasta el corte b no hay pantalla: las filas se cargan por SQL con la
-- service role. Lo que escribe la consola es siempre la service role, así que
-- "authenticated" solo puede leer (los miembros ven su dominio y su estado).

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  hostname text not null,
  is_primary boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'failed')),
  last_error text,
  verified_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Minúsculas, sin puerto, sin comodín, sin esquema y con TLD alfabético (así
  -- nunca es una IP). La capa de aplicación normaliza antes (punycode).
  constraint tenant_domains_hostname_format check (
    char_length(hostname) <= 253
    and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
  ),
  constraint tenant_domains_hostname_unique unique (hostname)
);

-- Un solo primario por empresa: el que se usa para armar links.
create unique index tenant_domains_one_primary
  on public.tenant_domains (tenant_id) where is_primary;
create index tenant_domains_tenant_id_idx on public.tenant_domains (tenant_id);

alter table public.tenant_domains enable row level security;

create policy tenant_domains_select on public.tenant_domains
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

-- Sin políticas de insert, update ni delete para authenticated: escribe la
-- service role. Los grants por defecto de Supabase son más anchos que eso.
revoke all on public.tenant_domains from anon, authenticated;
grant select on public.tenant_domains to authenticated;

-- Es lo único que lee el proxy, antes de que haya sesión. Devuelve solo el
-- slug, y solo de un dominio activo de una empresa activa: un dominio cargado
-- pero sin verificar no sirve nada.
create function public.resolve_tenant_by_host(p_host text)
returns text
language sql stable security definer set search_path = '' as $$
  select t.slug
    from public.tenant_domains d
    join public.tenants t on t.id = d.tenant_id
   where d.hostname = p_host
     and d.status = 'active'
     and t.active
$$;

revoke execute on function public.resolve_tenant_by_host(text) from public, anon, authenticated;
grant execute on function public.resolve_tenant_by_host(text) to service_role;

-- Alta, activación, falla y baja dejan su evento (events es append-only: solo
-- insert). Es un trigger para que también quede rastro de las filas que se
-- cargan por SQL antes de que exista la consola.
create function public.tenant_domains_audit()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  v_summary text;
  v_tenant uuid;
  v_hostname text;
begin
  if tg_op = 'INSERT' then
    v_type := 'tenant_domain.added';
    v_summary := 'Dominio agregado';
    v_tenant := new.tenant_id;
    v_hostname := new.hostname;
  elsif tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
    v_tenant := new.tenant_id;
    v_hostname := new.hostname;
    if new.status = 'active' then
      v_type := 'tenant_domain.activated';
      v_summary := 'Dominio activado';
    elsif new.status = 'failed' then
      v_type := 'tenant_domain.failed';
      v_summary := 'Falló la verificación del dominio';
    else
      return new;
    end if;
  else
    -- Si la empresa se está borrando, el delete en cascada llega acá con la
    -- empresa ya fuera de la tabla y el evento no tendría a quién colgarse.
    if not exists (select 1 from public.tenants where id = old.tenant_id) then
      return old;
    end if;
    v_type := 'tenant_domain.removed';
    v_summary := 'Dominio quitado';
    v_tenant := old.tenant_id;
    v_hostname := old.hostname;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (v_tenant, (select auth.uid()), v_type, v_summary,
          jsonb_build_object('hostname', v_hostname));
  return coalesce(new, old);
end;
$$;

revoke execute on function public.tenant_domains_audit() from public, anon, authenticated;

create trigger tenant_domains_audit
  after insert or update or delete on public.tenant_domains
  for each row execute function public.tenant_domains_audit();
