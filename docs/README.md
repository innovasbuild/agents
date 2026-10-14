---
title: Índice de la documentación
category: indice
status: activo
tags: [indice, wiki]
updated: 2026-10-13
---

# Índice de la documentación

Este es el punto de entrada a la wiki de Central IA (INNOV.AS Agents Platform). Una línea por página, agrupadas por categoría.
Las páginas de `referencia/` se regeneran con `npm run docs:sync`: no se editan a mano.
Cómo se mantiene todo esto (y qué verifica el harness) está en [Cómo mantener la wiki](guias/documentar.md).

## Empezar acá

- [Instalación local](guias/instalacion-local.md): levantar la plataforma en tu máquina, con los problemas conocidos.
- [Cómo mantener la wiki](guias/documentar.md): dónde va cada cosa, frontmatter, harness y procedimiento al cerrar una etapa.

## Arquitectura

- [Visión general](arquitectura/vision-general.md): el dibujo de la plataforma, los principios y el mapa de carpetas.
- [Tenancy](arquitectura/tenancy.md): empresas, membresías, roles, RLS y el tenant dueño.
- [Orquestación](arquitectura/orquestacion.md): las reglas para construir nodos, workflows y agentes.
- [Datos](arquitectura/datos.md): las tablas por dominio, `events` append-only y las convenciones de migraciones.
- [Identidad y acceso](arquitectura/identidad-y-acceso.md): login, ingreso por dominio, métodos impuestos, OAuth para el canal MCP.
- [Entornos y deploy](arquitectura/entornos-y-deploy.md): local, preview y producción; migración antes que código.
- [Modelos y costos](arquitectura/modelos-y-costos.md): AI Gateway, tiers, `metered()`, presupuestos y caps.

## Dominios

- [Agentes eve (agente de outreach)](dominios/agentes-eve.md): cómo está armado el agente, sus tools, schedules y evals.
- [Outreach](dominios/outreach.md): el proceso comercial: cola, pipeline, focos, fichas, CRM.
- [Brain](dominios/brain.md): el brain por empresa: páginas, permisos, editor, MCP.
- [Workflows](dominios/workflows.md): la mecánica de los workflows, `work_items` y el dispatcher.
- [Conectores](dominios/conectores.md): proveedores, Vercel Connect, bindings y la página Conectar.
- [Plataforma y settings por empresa](dominios/plataforma.md): la consola `/plataforma`, alta de empresas y settings del cliente.
- [Invitaciones y usuarios](dominios/invitaciones-y-usuarios.md): invitaciones, roles, bloqueo por persona.
- [Gmail](dominios/gmail.md): lectura y envío de mail desde el agente.

## Guías

- [Alta de una empresa nueva](guias/alta-de-tenant.md): dar de alta una empresa nueva desde la consola.
- [Dominio propio de un cliente](guias/dominio-de-un-cliente.md): servir a una empresa desde su dominio, con el DNS, la consola y las URLs de MCP.
- [Migraciones a producción](guias/migraciones-a-produccion.md): aplicar migraciones en local y en producción sin sorpresas.
- [Agregar una tool al agente](guias/agregar-una-tool.md): una tool nueva del agente, con su etiqueta y su aprobación.
- [Agregar un nodo o un workflow](guias/agregar-un-nodo-o-workflow.md): un nodo o workflow nuevo, registrado y medido.
- [Agregar un conector (proveedor)](guias/agregar-un-conector.md): un proveedor nuevo de conectores.
- [Agregar una pantalla](guias/agregar-una-pantalla.md): una pantalla nueva con su guard, su menú y su marca.
- [Correr las evals del agente](guias/correr-evals.md): correr y escribir evals del agente en local.
- [Llaves de clientes](guias/llaves-de-clientes.md): cómo entran las llaves de API de un cliente a la plataforma.
- [Conectar el brain por MCP](guias/conectar-brain-por-mcp.md): URL y pasos para Claude Code, Codex y claude.ai.
- [Conectar el agente por MCP](guias/conectar-agente-por-mcp.md): lo mismo para el agente de outreach.

## Referencia

- [Comandos](referencia/comandos.md): los scripts de `package.json`.
- [Variables de entorno](referencia/variables-de-entorno.md): las que lee el código propio y quién las lee.
- [Tablas](referencia/tablas.md): las tablas de `public` y la migración que crea cada una.
- [Migraciones](referencia/migraciones.md): `supabase/migrations`, en orden.
- [Rutas](referencia/rutas.md): páginas y endpoints de `app/`.
- [Tools del agente](referencia/tools-del-agente.md): con su etiqueta en castellano.
- [Nodos y workflows](referencia/nodos-y-workflows.md): lo que declara el registro, con niveles de efecto y caps.
- [Proveedores de conectores](referencia/proveedores.md): capacidad, tipo de auth y si admite varios.
- [Schedules](referencia/schedules.md): los procesos programados del agente.
- [Evals](referencia/evals.md): las evals del agente.

## Decisiones

- [Decisiones por spec](decisiones/README.md): una fila por spec, con su estado y las páginas donde quedó.
- [Decisiones por PR](decisiones/prs.md): una fila por PR mergeado, con las páginas o el motivo.
- [Changelog](../CHANGELOG.md): una entrada por PR, la mantiene `/ship`.

## Producto

- [Kickoff](producto/kickoff.md): documento fundacional del 2026-09-11.
- [Roadmap de etapas](producto/roadmap.md): el tracker de ejecución, etapa por etapa.
- [Evaluación de gap (2026-10)](producto/evaluacion-gap-2026-10.md): la plataforma contra la visión.
- [Plan de cierre del gap (2026-10)](producto/plan-cierre-gap-2026-10.md): las etapas 19 a 23.

## Diagramas

- [Arquitectura (HTML)](diagramas/arquitectura.html) y su fuente [arquitectura.archify.json](diagramas/arquitectura.archify.json). Se regenera con el skill `archify`.
