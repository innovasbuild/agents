---
title: Nodos y workflows
category: referencia
status: activo
tags: [referencia, generado]
generated: true
---
<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->

# Nodos y workflows

Lo que declara `lib/workflows/registry.ts`. Las reglas para crear uno están en [orquestación](../arquitectura/orquestacion.md).

## Nodos

| Nodo | Nivel de efecto | Tier | Modelo fijo |
| --- | --- | --- | --- |
| `outreach/crm-record` | 2 | — | — |
| `outreach/crm-sync` | 0 | — | — |
| `outreach/draft` | 1 | fuerte | — |
| `outreach/followups` | 1 | medio | — |
| `outreach/icp-score` | 1 | — | `typesafe-ai/jev` |
| `outreach/import-contacts` | 0 | — | — |
| `outreach/queue` | 0 | — | — |
| `outreach/reconcile` | 0 | — | — |
| `outreach/replies` | 0 | — | — |
| `outreach/research` | 1 | barato | — |
| `outreach/reveal-email` | 1 | — | — |
| `outreach/send` | 3 | — | — |
| `outreach/sweep` | 0 | — | — |
| `outreach/target-search` | 1 | — | — |
| `outreach/verify-fact` | 1 | — | `typesafe-ai/jev` |

## Workflows

| Workflow | Agente | Reclama | Produce | Nodos | Caps |
| --- | --- | --- | --- | --- | --- |
| `contact-enrichment` | outreach | `contacto_calificado` | `contacto_listo` | `outreach/reveal-email`, `outreach/research` | 10 ítems por tick · USD 0.3 por corrida |
| `draft-queue` | outreach | `contacto_listo` | — | `outreach/draft`, `outreach/verify-fact`, `outreach/queue` | 15 ítems por tick · USD 0.3 por corrida |
| `icp-scoring` | outreach | `contacto_descubierto` | `contacto_calificado` | `outreach/icp-score` | 20 ítems por tick · USD 0.5 por corrida |
| `refresh-fichas` | outreach | `ficha_vencida` | `ficha_vigente` | `outreach/research` | 5 ítems por tick · USD 1 por corrida |
| `target-search` | outreach | `foco_activo` | `contacto_descubierto` | `outreach/target-search` | 2 ítems por tick · USD 0 por corrida |

## Servicios fuera del registro

| Servicio | Motivo |
| --- | --- |
| `outreach/evaluate` | lectura defensiva de las respuestas de Jev que usa outreach/icp-score; se registra junto con él |
| `outreach/executor` | helper que resuelve el ejecutor y valida atribución; no es un trabajo por sí mismo |
| `outreach/generate-draft` | la llamada al modelo del nodo outreach/draft; se registra junto con él |
| `outreach/generate-research` | la llamada al modelo del nodo outreach/research; se registra junto con él |
| `outreach/research-run` | arma la investigación del nodo outreach/research (prompt y tope de páginas); se registra junto con él |
