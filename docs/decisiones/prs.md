---
title: Decisiones por PR
category: decisiones
status: activo
tags: [decisiones, pr]
updated: 2026-10-13
---

# Decisiones por PR

Una fila por PR mergeado (el snapshot está en `docs/_meta/prs.json`, se refresca con `npm run docs:prs`). La última columna nombra las páginas de la wiki donde quedó lo que el PR cambió, o el motivo de por qué no deja rastro (`fix sin cambio de contrato`, `spike borrado`, `chore`). Un PR `feat:` necesita una página que exista o un motivo de diez caracteres o más. Los cuerpos de los PR son la fuente de las decisiones: se leen con `gh pr view N --json body,files`.

Las specs están en [README.md](README.md).

| # | fecha | título | páginas o motivo |
| --- | --- | --- | --- |
