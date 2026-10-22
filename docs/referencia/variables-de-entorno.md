---
title: Variables de entorno
category: referencia
status: activo
tags: [referencia, generado]
generated: true
---
<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->

# Variables de entorno

Las variables que lee el código propio. Quedan afuera las que pone la plataforma o el sistema (`NODE_ENV`, `VERCEL_*`, `XDG_*`...).

| Variable | La leen |
| --- | --- |
| `AI_GATEWAY_API_KEY` | `scripts/jev-probe.mts` |
| `APOLLO_KEY` | `scripts/spike-apollo.mts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/auth/oauth-principal.ts`, `lib/auth/verify-caller.ts`, `lib/supabase/browser.ts` y 2 más |
| `NEXT_PUBLIC_SUPABASE_URL` | `agents/outreach/schedules/crm-sync.ts`, `agents/outreach/schedules/followups.ts`, `agents/outreach/schedules/morning-sweep.ts` y 19 más |
| `PLATFORM_OWNER_TENANT_SLUG` | `lib/tenants/platform-owner.ts` |
| `PUBLIC_APP_URL` | `lib/tenants/origin.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts`, `scripts/brain-folders-report.mts`, `scripts/brain-import.mts` y 1 más |
