---
title: Rutas
category: referencia
status: activo
tags: [referencia, generado]
generated: true
---
<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->

# Rutas

Las páginas y los endpoints de `app/`.

| Ruta | Tipo | Archivo |
| --- | --- | --- |
| `/` | página | `app/page.tsx` |
| `/.well-known/oauth-protected-resource/brain/[tenant]/mcp` | endpoint | `app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts` |
| `/.well-known/oauth-protected-resource/eve/outreach/v1/mcp` | endpoint | `app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts` |
| `/[tenant]` | página | `app/[tenant]/page.tsx` |
| `/[tenant]/brain` | página | `app/[tenant]/brain/page.tsx` |
| `/[tenant]/brain/editar/[...slug]` | página | `app/[tenant]/brain/editar/[...slug]/page.tsx` |
| `/[tenant]/brain/historial/[...slug]` | página | `app/[tenant]/brain/historial/[...slug]/page.tsx` |
| `/[tenant]/brain/mapa` | página | `app/[tenant]/brain/mapa/page.tsx` |
| `/[tenant]/brain/nueva` | página | `app/[tenant]/brain/nueva/page.tsx` |
| `/[tenant]/brain/p/[...slug]` | página | `app/[tenant]/brain/p/[...slug]/page.tsx` |
| `/[tenant]/brain/raw/[...slug]` | endpoint | `app/[tenant]/brain/raw/[...slug]/route.ts` |
| `/[tenant]/brain/skills/files` | endpoint | `app/[tenant]/brain/skills/files/route.ts` |
| `/[tenant]/chat` | página | `app/[tenant]/chat/page.tsx` |
| `/[tenant]/cola` | página | `app/[tenant]/cola/page.tsx` |
| `/[tenant]/conectar` | página | `app/[tenant]/conectar/page.tsx` |
| `/[tenant]/contactos` | página | `app/[tenant]/contactos/page.tsx` |
| `/[tenant]/cuentas` | página | `app/[tenant]/cuentas/page.tsx` |
| `/[tenant]/focos` | página | `app/[tenant]/focos/page.tsx` |
| `/[tenant]/focos/[id]/revisar` | página | `app/[tenant]/focos/[id]/revisar/page.tsx` |
| `/[tenant]/metricas` | página | `app/[tenant]/metricas/page.tsx` |
| `/[tenant]/mis-cuentas` | página | `app/[tenant]/mis-cuentas/page.tsx` |
| `/[tenant]/pipeline` | página | `app/[tenant]/pipeline/page.tsx` |
| `/[tenant]/settings` | página | `app/[tenant]/settings/page.tsx` |
| `/[tenant]/settings/gasto` | página | `app/[tenant]/settings/gasto/page.tsx` |
| `/[tenant]/settings/outreach` | página | `app/[tenant]/settings/outreach/page.tsx` |
| `/[tenant]/settings/usuarios` | página | `app/[tenant]/settings/usuarios/page.tsx` |
| `/api/invitations` | endpoint | `app/api/invitations/route.ts` |
| `/auth/callback` | endpoint | `app/auth/callback/route.ts` |
| `/auth/confirmar` | página | `app/auth/confirmar/page.tsx` |
| `/brain/[tenant]/mcp` | endpoint | `app/brain/[tenant]/mcp/route.ts` |
| `/login` | página | `app/(auth)/login/page.tsx` |
| `/login/[tenant]` | página | `app/(auth)/login/[tenant]/page.tsx` |
| `/oauth/consent` | página | `app/oauth/consent/page.tsx` |
| `/plataforma` | página | `app/plataforma/page.tsx` |
| `/plataforma/[slug]` | página | `app/plataforma/[slug]/page.tsx` |
| `/plataforma/nueva` | página | `app/plataforma/nueva/page.tsx` |
| `/sin-acceso` | página | `app/sin-acceso/page.tsx` |
