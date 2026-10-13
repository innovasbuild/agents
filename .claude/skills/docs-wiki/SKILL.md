---
name: docs-wiki
description: Documentar en la wiki lo que cambió en esta rama y cerrar los PR y specs sin fila. Usar al cerrar una etapa o cuando npm run docs:check está rojo.
---

# /docs-wiki

Deja la wiki de `docs/` al día con lo que cambió en esta rama. Primero leé `docs/guias/documentar.md`: es la fuente de las reglas (categorías, frontmatter, links, exclusiones, estados). Español rioplatense en toda la prosa.

## Pasos

1. `git diff main --stat` para ver qué cambió. Después `npm run docs:prs` para traer los PR mergeados nuevos (necesita `gh` autenticado; si falla, frená y avisá).
2. `npm run docs:sync` y `npm run docs:check`. Lo que falle es la lista de trabajo.
3. Por cada PR sin fila en `docs/decisiones/prs.md`: leé `gh pr view N --json body,files` y decidí qué página toca o por qué no deja rastro (motivo de diez caracteres o más). Los `feat:` necesitan página que exista o motivo.
4. Por cada falla de cobertura o de forma: una página nueva, una página existente actualizada, o una exclusión en `docs/_meta/cobertura.ts` con motivo. **Nunca** se borra ni se debilita un test, y no hay `skip`.
5. Antes de escribir una página de `dominios/` o `arquitectura/`, leé sus `sources` completas y los cuerpos de los PR que la tocan. No escribas de memoria. Si la spec no coincide con el código, manda el código y lo anotás en "Decisiones".
6. Si hay una spec nueva, agregá su fila a `docs/decisiones/README.md`. Poné `updated` (YYYY-MM-DD) en cada página que toques y enlazá las nuevas desde `docs/README.md`.
7. Si la etapa cierra: estado `cerrada` en su fila, con las páginas donde quedó.
8. Corré `npm run docs:check` hasta que esté verde, más `npm run typecheck`.

## Reglas

- `docs/referencia/` se regenera, no se edita a mano.
- Nada específico de un tenant en la wiki, salvo en `producto/` y en ejemplos marcados como ejemplo.
- `/sync-gbrain` no aplica: gbrain es el brain del coding agent, no el del producto.

## Reportar

Páginas creadas, páginas actualizadas, exclusiones agregadas con su motivo, filas de PR y de specs agregadas, y lo que quedó `en curso`.
