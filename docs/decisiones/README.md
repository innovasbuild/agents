---
title: Decisiones por spec
category: decisiones
status: activo
tags: [decisiones, specs, etapas]
updated: 2026-10-13
---

# Decisiones por spec

Una fila por spec de `docs/superpowers/specs/`. Es el detector de feature nueva: cada etapa nace con una spec, y `tests/docs` falla hasta que la spec tenga fila.

- **Estado:** `en curso`, `cerrada` o `descartada`. Una etapa `cerrada` tiene que nombrar al menos una página de la wiki donde quedó documentada; las otras dos no exigen páginas.
- **Páginas:** links separados por ` · `.
- Los PR mergeados están en [prs.md](prs.md).

| fecha | etapa | spec | plan | estado | páginas |
| --- | --- | --- | --- | --- | --- |
| 2026-09-11 | 0 · Bootstrap | [spec](../superpowers/specs/00-bootstrap.md) | [plan](../superpowers/plans/00-bootstrap.md) | cerrada | [Visión general](../arquitectura/vision-general.md) · [Gmail](../dominios/gmail.md) |
| 2026-09-12 | 1 · Multi-tenant | [spec](../superpowers/specs/01-multi-tenant.md) | [plan](../superpowers/plans/01-multi-tenant.md) | cerrada | [Visión general](../arquitectura/vision-general.md) · [Tenancy](../arquitectura/tenancy.md) |
| 2026-09-13 | 2 · Conexiones | [spec](../superpowers/specs/02-conexiones-innovas.md) | [plan](../superpowers/plans/02-conexiones-innovas.md) | cerrada | [Conectores](../dominios/conectores.md) · [Gmail](../dominios/gmail.md) |
| 2026-09-14 | 3 · Agente de outreach | [spec](../superpowers/specs/03-agente-outreach-v1.md) | [plan](../superpowers/plans/03-agente-outreach-v1.md) | cerrada | [Agentes eve (agente de outreach)](../dominios/agentes-eve.md) · [Outreach](../dominios/outreach.md) · [Datos](../arquitectura/datos.md) |
| 2026-09-12 | Arquitectura de la plataforma | [spec](../superpowers/specs/2026-09-12-arquitectura-plataforma-design.md) |  | cerrada | [Visión general](../arquitectura/vision-general.md) |
| 2026-09-13 | Brain | [spec](../superpowers/specs/2026-09-13-brain-design.md) | [plan](../superpowers/plans/2026-09-13-brain.md) | cerrada | [Brain](../dominios/brain.md) |
| 2026-09-16 | 4 · Dashboard y cola | [spec](../superpowers/specs/2026-09-16-etapa-4-dashboard-cola-design.md) | [plan](../superpowers/plans/2026-09-16-etapa-4-cola.md) | cerrada | [Outreach](../dominios/outreach.md) |
| 2026-09-19 | 5 · Escucha y follow-ups | [spec](../superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md) | [plan](../superpowers/plans/2026-09-19-etapa-5-escucha.md) | cerrada | [Outreach](../dominios/outreach.md) · [Datos](../arquitectura/datos.md) |
| 2026-09-20 | 12 · Orquestación | [spec](../superpowers/specs/2026-09-20-orquestacion-plataforma-design.md) | [plan](../superpowers/plans/2026-09-20-etapa-12-orquestacion.md) · [plan](../superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md) | cerrada | [Orquestación](../arquitectura/orquestacion.md) · [Workflows](../dominios/workflows.md) · [Datos](../arquitectura/datos.md) · [Modelos y costos](../arquitectura/modelos-y-costos.md) |
| 2026-09-20 | 13 · Pipeline de GTM | [spec](../superpowers/specs/2026-09-20-etapa-13-pipeline-gtm-design.md) | [plan](../superpowers/plans/2026-09-20-etapa-13-pipeline-gtm.md) | en curso | [Outreach](../dominios/outreach.md) · [Orquestación](../arquitectura/orquestacion.md) · [Workflows](../dominios/workflows.md) · [Modelos y costos](../arquitectura/modelos-y-costos.md) |
| 2026-09-24 | 11 · Brain por MCP | [spec](../superpowers/specs/2026-09-24-etapa-11-brain-mcp-design.md) | [plan](../superpowers/plans/2026-09-24-etapa-11-brain-mcp.md) | cerrada | [Brain](../dominios/brain.md) · [Identidad y acceso](../arquitectura/identidad-y-acceso.md) |
| 2026-09-27 | Editor del brain | [spec](../superpowers/specs/2026-09-27-editor-brain-design.md) | [plan](../superpowers/plans/2026-09-27-editor-brain.md) | en curso | [Brain](../dominios/brain.md) |
| 2026-09-27 | 6 · Canal MCP del agente | [spec](../superpowers/specs/2026-09-27-etapa-6-canal-mcp-design.md) | [plan](../superpowers/plans/2026-09-27-etapa-6-canal-mcp.md) | cerrada | [Agentes eve (agente de outreach)](../dominios/agentes-eve.md) · [Identidad y acceso](../arquitectura/identidad-y-acceso.md) |
| 2026-09-27 | Sync entrante de HubSpot | [spec](../superpowers/specs/2026-09-27-hubspot-crm-sync-design.md) | [plan](../superpowers/plans/2026-09-27-hubspot-crm-sync.md) | en curso | [Outreach](../dominios/outreach.md) |
| 2026-09-28 | 14 · Subida de eve | [spec](../superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md) | [plan](../superpowers/plans/2026-09-28-etapa-14-subida-eve.md) | en curso | [Agentes eve (agente de outreach)](../dominios/agentes-eve.md) · [Entornos y deploy](../arquitectura/entornos-y-deploy.md) |
| 2026-10-05 | Alta de empresas y landing | [spec](../superpowers/specs/2026-10-05-alta-empresas-landing-design.md) | [plan](../superpowers/plans/2026-10-05-alta-empresas-landing.md) | en curso | [Plataforma y settings por empresa](../dominios/plataforma.md) · [Tenancy](../arquitectura/tenancy.md) · [Identidad y acceso](../arquitectura/identidad-y-acceso.md) |
| 2026-10-05 | Consola de plataforma | [spec](../superpowers/specs/2026-10-05-consola-plataforma-design.md) | [plan](../superpowers/plans/2026-10-05-consola-plataforma.md) | en curso | [Plataforma y settings por empresa](../dominios/plataforma.md) · [Tenancy](../arquitectura/tenancy.md) |
| 2026-10-05 | 17 · Permisos del brain | [spec](../superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md) | [plan](../superpowers/plans/2026-10-05-etapa-17-1-aislamiento-brain.md) · [plan](../superpowers/plans/2026-10-07-etapa-17-2-permisos.md) · [plan](../superpowers/plans/2026-10-07-etapa-17-3-arbol-compartir.md) | en curso | [Brain](../dominios/brain.md) |
| 2026-10-08 | 18.1 · Borrado de páginas | [spec](../superpowers/specs/2026-10-08-etapa-18-1-borrado-paginas-brain-design.md) | [plan](../superpowers/plans/2026-10-08-etapa-18-1-borrado-paginas.md) | en curso | [Brain](../dominios/brain.md) |
| 2026-10-08 | 18.2 · Editor visual | [spec](../superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md) | [plan](../superpowers/plans/2026-10-08-etapa-18-2-editor-visual.md) | en curso | [Brain](../dominios/brain.md) |
| 2026-10-09 | 19 · Conectar | [spec](../superpowers/specs/2026-10-09-etapa-19-conectar-design.md) | [plan](../superpowers/plans/2026-10-09-etapa-19-conectar.md) | en curso | [Conectores](../dominios/conectores.md) |
| 2026-10-09 | 20 · Login y usuarios | [spec](../superpowers/specs/2026-10-09-etapa-20-login-design.md) | [plan](../superpowers/plans/2026-10-09-etapa-20-1-login.md) · [plan](../superpowers/plans/2026-10-09-etapa-20-2-usuarios.md) | en curso | [Identidad y acceso](../arquitectura/identidad-y-acceso.md) · [Invitaciones y usuarios](../dominios/invitaciones-y-usuarios.md) |
| 2026-10-09 | Ingreso por dominio | [spec](../superpowers/specs/2026-10-09-ingreso-por-dominio-design.md) | [plan](../superpowers/plans/2026-10-09-ingreso-por-dominio.md) | en curso | [Identidad y acceso](../arquitectura/identidad-y-acceso.md) · [Invitaciones y usuarios](../dominios/invitaciones-y-usuarios.md) |
| 2026-10-10 | 21.1 · Consola de conectores | [spec](../superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md) | [plan](../superpowers/plans/2026-10-10-etapa-21-1-consola-conectores.md) | en curso | [Conectores](../dominios/conectores.md) · [Plataforma y settings por empresa](../dominios/plataforma.md) · [Tenancy](../arquitectura/tenancy.md) |
| 2026-10-10 | 21.2 · Settings del cliente | [spec](../superpowers/specs/2026-10-10-etapa-21-2-settings-cliente-design.md) | [plan](../superpowers/plans/2026-10-10-etapa-21-2-settings-cliente.md) | en curso | [Plataforma y settings por empresa](../dominios/plataforma.md) · [Conectores](../dominios/conectores.md) |
| 2026-10-10 | 21.3 · Config de outreach | [spec](../superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md) | [plan](../superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md) · [plan](../superpowers/plans/2026-10-10-etapa-21-3b-pantallas-outreach.md) | en curso | [Outreach](../dominios/outreach.md) · [Brain](../dominios/brain.md) · [Modelos y costos](../arquitectura/modelos-y-costos.md) |
| 2026-10-11 | 21.4 · Segundo tenant | [spec](../superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md) | [plan](../superpowers/plans/2026-10-11-etapa-21-4a-empresa-sin-agentes.md) | en curso | [Tenancy](../arquitectura/tenancy.md) · [Entornos y deploy](../arquitectura/entornos-y-deploy.md) · [Alta de una empresa nueva](../guias/alta-de-tenant.md) |
| 2026-10-13 | 21.5 · Gasto de IA por empresa | [spec](../superpowers/specs/2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md) | [plan](../superpowers/plans/2026-10-13-etapa-21-5-gasto-ia-por-empresa.md) | en curso | [Modelos y costos](../arquitectura/modelos-y-costos.md) |
| 2026-10-11 | 24.1 · Skills de empresa: paquete y publicación | [spec](../superpowers/specs/2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md) | [plan](../superpowers/plans/2026-10-11-etapa-24-1-skills-paquete-publicacion.md) | en curso | [Brain](../dominios/brain.md) |
| 2026-10-13 | 25 · Wiki y harness | [spec](../superpowers/specs/2026-10-13-etapa-25-wiki-documentacion-design.md) | [plan](../superpowers/plans/2026-10-13-etapa-25-wiki-documentacion.md) | cerrada | [Cómo mantener la wiki](../guias/documentar.md) |
| 2026-10-13 | 22.1 · Chat multiagente y Asistente | [spec](../superpowers/specs/2026-10-13-etapa-22-1-chat-multiagente-design.md) | [plan](../superpowers/plans/2026-10-13-etapa-22-1-chat-multiagente.md) | en curso | [Agentes eve](../dominios/agentes-eve.md) |
