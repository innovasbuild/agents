---
title: Instalación local
category: guias
status: activo
tags: [instalacion, local, supabase, onboarding]
updated: 2026-10-13
sources:
  - README.md
  - package.json
  - .nvmrc
  - .env.eval.example
  - supabase/config.toml
  - supabase/seed.sql
  - proxy.ts
  - lib/tenants/platform-owner.ts
  - lib/tenants/origin.ts
  - .claude/hooks/check-gstack.sh
---

# Instalación local

El [README](../../README.md) tiene el camino corto. Esta página agrega el porqué de cada paso y los problemas conocidos. Es el tutorial: si algo te trabó y no está acá, agregalo.

## Qué corre en tu máquina

| Pieza | Cómo | Puerto |
|---|---|---|
| App Next.js | `npm run dev` | 3000 |
| API de Supabase | contenedor (`npm run db:start`) | 54321 |
| Postgres | contenedor | 54322 |
| Studio | contenedor | 54323 |
| Mailpit (mail local) | contenedor | 54324 |

El proyecto de Supabase se llama `agents` (`supabase/config.toml`), así que el contenedor de la base es `supabase_db_agents`.

## Variables de `.env.local`

`proxy.ts` y el cliente de Supabase leen las tres primeras en cada request. Sin ellas la app ni siquiera carga.

| Variable | Valor en local | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | fija |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` | `npx supabase status -o env` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` | `npx supabase status -o env` |
| `PUBLIC_APP_URL` | `http://localhost:3000` | fija; la usan el origen de los links de invitación y el brain por MCP |
| `PLATFORM_OWNER_TENANT_SLUG` | `innovas-seed` | fija; sin ella la consola `/plataforma` queda cerrada para todos |
| `VERCEL_OIDC_TOKEN` o `AI_GATEWAY_API_KEY` | token | `vercel env pull` (ver abajo); solo lo que llama a modelos |

La lista completa de variables que lee el código, y qué archivos las leen, está en [variables de entorno](../referencia/variables-de-entorno.md).

### El `.env.local` de Vercel apunta a la nube

`vercel env pull` baja el entorno `development` del proyecto, y al 2026-10-13 ese entorno tiene la URL y las llaves de la Supabase de la nube, no de la local. Si lo usás como `.env.local`, `npm run dev` va a leer y escribir datos reales. Por eso el README pide bajarlo a un archivo aparte (`.env.vercel`) y copiar solo la llave del modelo.

El token `VERCEL_OIDC_TOKEN` de development vence a las pocas horas: si el chat dice que no autoriza, volvé a correr `vercel env pull .env.vercel` y copiá el token nuevo.

## Entrar a la app

El ingreso es con un código de seis dígitos por mail (`supabase/config.toml`, `otp_length = 6`). En local no sale ningún mail real: llegan a Mailpit en <http://127.0.0.1:54324>.

Los usuarios del seed (`admin-seed@innov.as` como `platform_admin` de `innovas-seed`, `ana@demo.test` como `tenant_admin` de `demo`) se insertan directo en `auth.users` y GoTrue no les manda código. El camino que funcionó en las etapas 20 y 21 es el ingreso por dominio:

1. Abrir la empresa `demo` al ingreso por dominio (su dominio es `demo.test`):

   ```bash
   docker exec supabase_db_agents psql -U postgres -c "update tenants set self_signup_by_domain = true where slug = 'demo'"
   ```

2. Entrar a <http://localhost:3000/login/demo> con cualquier mail `@demo.test` nuevo.
3. Tomar el código de Mailpit.

Para probar la consola de plataforma hay que ser `platform_admin` de `innovas-seed`: darle esa membresía por SQL al usuario nuevo.

## Problemas conocidos

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `failed to connect to the docker API` | Docker apagado | Abrir Docker Desktop y repetir |
| `port is already allocated` en 54321 o 54322 | Otro Supabase local corriendo | `npx supabase stop --all` y volver a `db:start` |
| `npm ci` falla con `EBADENGINE` | Node menor a 24 | `nvm install 24 && nvm use` |
| El chat o el agente fallan al llamar al modelo | `VERCEL_OIDC_TOKEN` vencido o ausente | Volver a bajar el token |
| El hook de Claude Code dice `GSTACK_MISSING` | gstack no está instalado | Instalar gstack en `~/.claude/skills/gstack` |

## Tests

| Comando | Qué necesita |
|---|---|
| `npm test` | Nada. Corre en segundos y no usa Docker |
| `npm run db:test` | Docker. Resetea la base local sin seed y corre los tests de SQL (RLS y funciones) |
| `npm run test:it` y `npm run test:it:workflows` | Docker, base arriba y `.env.eval` |
| `npm run evals` | Docker, base arriba, `.env.local` y `.env.eval` |

Para las evals: copiar `.env.eval.example` a `.env.eval`, completar las dos llaves de Supabase con `npx supabase status -o env`. El script se niega a correr si `NEXT_PUBLIC_SUPABASE_URL` no es local.

## Después

Leer el [índice de la documentación](../README.md), empezando por [orquestación](../arquitectura/orquestacion.md), que es la ley para crear nodos, workflows y agentes.
