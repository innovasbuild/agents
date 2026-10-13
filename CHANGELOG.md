# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Lo mantiene `/ship`: una entrada por PR. El detalle de cada etapa está en [docs/producto/roadmap.md](docs/producto/roadmap.md) y las decisiones en [docs/decisiones/prs.md](docs/decisiones/prs.md).

## [0.1.0] - 2026-10-13

### Added

- Base multi-tenant sobre Supabase: empresas, membresías, tres roles, invitaciones y RLS en toda tabla (etapas 0 y 1).
- Agente de outreach sobre eve: cola de aprobación, pipeline, escucha de respuestas y seguimientos, sincronización con HubSpot y canal MCP (etapas 3 a 6).
- Brain por empresa con permisos por carpeta y página, editor visual, historial, borrado y conector MCP (etapas 11, 17 y 18).
- Modelo de orquestación (nodos, workflows, `work_items`) con el pipeline de búsqueda, calificación, enriquecimiento y redacción (etapas 12 y 13).
- Ingreso por código o dominio, pantalla Conectar, consola de plataforma y de conectores, settings del cliente y segundo tenant (etapas 19 a 21).
- Wiki de documentación en `docs/` con harness que la mantiene al día (etapa 25).
