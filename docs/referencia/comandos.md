---
title: Comandos
category: referencia
status: activo
tags: [referencia, generado]
generated: true
---
<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->

# Comandos

Los scripts de `package.json`.

| Script | Comando |
| --- | --- |
| `brain:folders-report` | `node --env-file=.env.local scripts/brain-folders-report.mts` |
| `brain:import` | `node --env-file=.env.local scripts/brain-import.mts` |
| `brain:rules-report` | `node --env-file=.env.local scripts/brain-rules-report.mts` |
| `build` | `next build` |
| `db:reset` | `npx supabase db reset` |
| `db:start` | `npx supabase start` |
| `db:stop` | `npx supabase stop` |
| `db:test` | `npx supabase db reset --no-seed && npx supabase test db` |
| `db:types` | `npx supabase gen types typescript --local > lib/supabase/database.types.ts.tmp && mv lib/supabase/database.types.ts.tmp lib/supabase/database.types.ts && npx biome check --write lib/supabase/database.types.ts` |
| `dev` | `next dev` |
| `docs:check` | `vitest run tests/docs` |
| `docs:prs` | `node scripts/docs/prs.mts` |
| `docs:sync` | `node scripts/docs/sync.mts` |
| `evals` | `node --env-file=.env.local --env-file=.env.eval scripts/run-evals.mts` |
| `jev:probe` | `node --env-file=.env.local scripts/jev-probe.mts` |
| `lint:fix` | `biome check --write .` |
| `oauth:probe` | `node --env-file=.env.local scripts/oauth-probe.mts` |
| `start` | `next start` |
| `test` | `vitest run` |
| `test:it` | `OUTREACH_IT=1 node --env-file=.env.eval ./node_modules/vitest/vitest.mjs run tests/outreach/store.it.test.ts` |
| `test:it:workflows` | `WORKFLOWS_IT=1 node --env-file=.env.eval ./node_modules/vitest/vitest.mjs run tests/workflows/store.it.test.ts` |
| `typecheck` | `next typegen && tsc --noEmit` |
