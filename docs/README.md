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

- [Orquestación](arquitectura/orquestacion.md): las reglas para construir nodos, workflows y agentes.

## Dominios

Sin páginas todavía (se escriben en la fase 3 de la Etapa 25).

## Guías

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

## Producto

- [Kickoff](producto/kickoff.md): documento fundacional del 2026-09-11.
- [Roadmap de etapas](producto/roadmap.md): el tracker de ejecución, etapa por etapa.
- [Evaluación de gap (2026-10)](producto/evaluacion-gap-2026-10.md): la plataforma contra la visión.
- [Plan de cierre del gap (2026-10)](producto/plan-cierre-gap-2026-10.md): las etapas 19 a 23.

## Diagramas

- [Arquitectura (HTML)](diagramas/arquitectura.html) y su fuente [arquitectura.archify.json](diagramas/arquitectura.archify.json). Se regenera con el skill `archify`.
