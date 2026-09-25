-- Spec etapa 11 D9: un tenant tiene un solo brain habilitado. Antes lo
-- garantizaba resolveBrainBinding descartando en silencio lo que no era wiki.
do $$
begin
  if exists (
    select 1 from public.tenant_connections
    where capability = 'brain' and enabled
    group by tenant_id
    having count(*) > 1
  ) then
    raise exception 'hay tenants con más de un brain habilitado: deshabilitá uno antes de aplicar esta migración';
  end if;
end $$;

create unique index tenant_connections_one_brain
  on public.tenant_connections (tenant_id)
  where capability = 'brain' and enabled;
