-- Etapa 22.1: el agente asistente queda habilitado en toda empresa que ya
-- tiene brain (spec 2026-10-13-etapa-22-1 §7 y C9). No escribe en events: es
-- una habilitación de plataforma, no la acción de una persona.
insert into public.tenant_agents (tenant_id, agent, enabled, config)
select distinct c.tenant_id, 'asistente', true, '{"brain": "read_write"}'::jsonb
from public.tenant_connections c
where c.capability = 'brain'
  and c.enabled
on conflict (tenant_id, agent) do nothing;
