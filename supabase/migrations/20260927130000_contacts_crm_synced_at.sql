-- lib/outreach/services/crm-sync.ts (Task 4) la usa como marca de agua para no
-- volver a traer notas de HubSpot ya vistas en una corrida anterior. Sin
-- default: `null` es exactamente el estado real de todo contacto existente
-- hoy ("nunca sincronizado"). Sin default tampoco hay reescritura de tabla
-- (Postgres 11+ agrega una columna nullable sin default como metadata pura).
alter table public.contacts add column crm_synced_at timestamptz;
