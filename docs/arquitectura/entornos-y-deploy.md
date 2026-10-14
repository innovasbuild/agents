---
title: Entornos y deploy
category: arquitectura
status: activo
tags: [vercel, supabase, deploy, variables, migraciones]
updated: 2026-10-13
sources:
  - vercel.json
  - next.config.ts
  - supabase/config.toml
  - supabase/templates/magic_link.html
  - lib/brain/adapters/mcp-production.ts
  - lib/tenants/origin.ts
  - lib/tenants/platform-owner.ts
  - lib/connectors/env.ts
  - docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md
  - docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md
  - docs/superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md
  - docs/producto/roadmap.md
---

# Entornos y deploy

Dónde corre cada pieza, qué variable la configura y en qué orden se sube un cambio. Para levantar todo en tu máquina, [instalación local](../guias/instalacion-local.md). Para subir migraciones paso a paso, [migraciones a producción](../guias/migraciones-a-produccion.md).

## Los tres entornos

| Entorno | App | Base | Para qué |
|---|---|---|---|
| Local | `npm run dev` (puerto 3000) | Supabase en Docker (`npm run db:start`, API en 54321, mail en Mailpit) | Desarrollo, `npm test`, `npm run db:test`, evals |
| Preview (Vercel) | Un deploy por rama o PR, con URL propia | La que tengan sus variables; el proyecto no fija una base de preview | Smoke de un cambio antes de mergear, cuando el preview tiene variables cargadas |
| Producción (Vercel) | Deploy de `main` | Supabase en la nube | Los clientes |

La documentación del repo solo menciona una Supabase de la nube, la de producción. La Etapa 14 lo dejó dicho: si el preview del PR no tiene variables de entorno, no se hace smoke ahí y se va directo a producción, como en la Etapa 6 (spec 14 §5.1).

## Qué configura qué

- `vercel.json` solo fuerza `"framework": "nextjs"`.
- `next.config.ts` envuelve la config con `withEve(...)` y registra el agente (`agents: { outreach: "./agents/outreach" }`). Eso es lo que monta las rutas del agente en `/eve/outreach/v1/*` y lo que convierte cada `defineSchedule` en un cron de Vercel (`dispatch` figura en Settings → Cron Jobs con `*/5 * * * *`; los schedules del agente están en [orquestación](orquestacion.md)). También sube a 2 MB el límite de las server actions, por el logo que sube la consola.
- `proxy.ts` refresca la sesión de Supabase en cada navegación; deja afuera `eve/`, `brain/` y `.well-known/` (ver [identidad y acceso](identidad-y-acceso.md)).

## Variables y de dónde salen

La lista completa y quién lee cada una están en [variables de entorno](../referencia/variables-de-entorno.md) (generada). Acá, el criterio:

| Variable | Local | Producción | Notas |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | URL del proyecto de la nube | Es también el `issuer` del OAuth y de las sesiones de eve. `publicSettings()` tira un error claro si falta |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `npx supabase status -o env` | Panel de Supabase | Clave pública, bajo RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | `npx supabase status -o env` | Panel de Supabase | Solo servidor. Salta la RLS: nunca al navegador ni a un log |
| `PUBLIC_APP_URL` | `http://localhost:3000` | Cargada en Production, con el dominio real | Es el host raíz y el origen de las URLs de MCP del host raíz (`fallbackPublicUrl`); `originFrom` la usa como último recurso para los links de invitación. En el dominio propio de una empresa el origen sale del host del request (ver [tenancy](tenancy.md)). En Preview no tiene sentido un valor fijo: `publicSettings()` cae a `VERCEL_URL`, que Vercel pone solo, porque si no un canal de eve que la lee al compilar rompe el build de cualquier preview |
| `PLATFORM_OWNER_TENANT_SLUG` | `innovas-seed` | Slug del tenant dueño de la plataforma | Sin ella la consola `/plataforma` queda cerrada para todos y nadie entra como administrador de plataforma por MCP ni por la web (spec 21.4, PR [#79](https://github.com/innovasbuild/agents/pull/79) y [#82](https://github.com/innovasbuild/agents/pull/82)) |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | No hacen falta | Solo Production | La API de Vercel para los dominios propios de las empresas: agregar, verificar y quitar un dominio del proyecto. El team es opcional. Nunca al navegador ni a un log. Sin token o sin proyecto la consola avisa y no deja cargar dominios ([dominio de un cliente](../guias/dominio-de-un-cliente.md)) |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | No hacen falta | Solo Production | La Management API de Supabase, para sumar cada dominio activo a las Redirect URLs de Auth. Es un token de cuenta, no la service role. Sin ellas un dominio no se activa: el link mágico y Google fallarían en ese host |
| `AI_GATEWAY_API_KEY` | En `.env.local`, o `VERCEL_OIDC_TOKEN` | En Vercel el gateway autentica por OIDC; la llave sirve fuera de Vercel | Sin ella todo anda menos lo que gasta modelo. El team necesita créditos pagos del AI Gateway: sin ellos los modelos dan `Free tier users do not have access to this model`. Ver [modelos y costos](modelos-y-costos.md) |

Tres cuidados:

- **No uses el `.env.local` que baja `vercel env pull` tal cual**: el entorno `development` de Vercel apunta a la Supabase de la nube. Se baja a `.env.vercel` y se copia solo la llave del modelo. El `VERCEL_OIDC_TOKEN` de development vence a las pocas horas.
- **Las llaves de los clientes no son variables de entorno.** Viven en Vercel Connect y la plataforma guarda solo el identificador del conector ([llaves de clientes](../guias/llaves-de-clientes.md)). `inVercel()` (`VERCEL_ENV`) decide si la verificación de un conector corre: solo en un deploy, que es donde hay OIDC.
- **Nunca se commitea un `.env`.**

## Supabase: local contra producción

El código es el mismo, la configuración de Auth no.

| | Local (`supabase/config.toml`) | Producción (panel de Supabase) |
|---|---|---|
| Mail | Mailpit, sin envío real | El que tenga configurado el proyecto de Supabase Auth |
| Plantillas de mail | Versionadas en `supabase/templates/` (`magic_link.html`, `confirmation.html`), que traen el código | Se pegan **a mano** en Authentication → Email Templates; sin eso el mail no trae el código y solo anda el link |
| `enable_confirmations` | apagado | **"Confirm email" tiene que estar prendido**: si no, alguien puede registrarse por la API con el correo de otro (ingreso por dominio, PR [#81](https://github.com/innovasbuild/agents/pull/81)) |
| `otp_length` / `otp_expiry` | 6 / 3600 | Verificar el largo (el cliente acepta de 6 a 10) y decidir el vencimiento: el único freno a adivinar el código es el límite por IP de Supabase |
| OAuth Server y hook | Prendidos en `config.toml` (`auth.oauth_server`, `auth.hook.custom_access_token`) | Se prenden en el panel: OAuth Server con registro dinámico, Authorization Path `/oauth/consent`, Redirect URLs y el hook `public.custom_access_token_hook` |
| Site URL | `http://127.0.0.1:3000` | La URL real. Supabase arma el link de `/oauth/consent` como Site URL más Authorization Path: la Etapa 11 la encontró en `localhost:3000` y mandaba el consentimiento a la máquina de cada persona ([#53](https://github.com/innovasbuild/agents/pull/53)) |
| Proveedores | Google y Microsoft sin configurar; se entra por código | Google prendido; Microsoft apagado hasta completar el anexo A de la spec de la Etapa 20 |

Tipos: `npm run db:types` apunta a la instancia **local** (`--local`) y no pisa `lib/supabase/database.types.ts` si falla ([#63](https://github.com/innovasbuild/agents/pull/63)). Corré `db:types` después de cada migración nueva y commiteá el archivo.

## La regla: migración antes que código

Varias migraciones de esta plataforma cambian algo de lo que el código nuevo depende (una función, una tabla, un check). Con el código nuevo y la base vieja, el alta de empresas falla (consola, [#87](https://github.com/innovasbuild/agents/pull/87)) o nadie puede entrar (`login_gate` no existe, [#85](https://github.com/innovasbuild/agents/pull/85)). El orden es siempre:

1. `npx supabase migration list`. Mirá **todas** las pendientes, no solo la tuya.
2. **`npx supabase db push` aplica todas las pendientes**, incluidas las de otras ramas ya mergeadas. Si aparece una que no es tuya, nombrala y confirmala antes de seguir. Ejemplos reales: el PR [#32](https://github.com/innovasbuild/agents/pull/32) arrastró dos migraciones de realtime que llevaban días mergeadas sin aplicar y dejaban `/cola` y `/pipeline` sin actualizarse sola; el [#51](https://github.com/innovasbuild/agents/pull/51) y el [#79](https://github.com/innovasbuild/agents/pull/79) piden correr `migration list` antes de `db push` por lo mismo.
3. Volvé a correr `migration list` (remoto igual a local) y regenerá tipos.
4. Recién ahí, deploy del código.

Casos que piden una consulta de solo lectura antes de aplicar: la consola (ningún conector en dos empresas, o la migración falla nombrándolo) y la limpieza de reglas del brain (personas reinvitadas con reglas viejas). Están en el cuerpo de sus PR y en las specs.

El caso contrario también existe: una migración puramente aditiva puede ir con el código sin orden estricto, pero si dudás, aplicala primero.

## Deploy

- El merge a `main` deploya producción. En la Etapa 11 el deploy no se disparó solo y hubo que promoverlo a mano desde el dashboard de Vercel ([#53](https://github.com/innovasbuild/agents/pull/53)); si pasa de nuevo, es esa deuda de infraestructura.
- `dispatch` corre cada 5 minutos con un lock por tick, así que no hay ventana libre: se mergea apenas termina un tick (minutos :01 a :03 de cada bloque de 5). `morning-sweep` (10:00 UTC) y `followups` (11:00 UTC) corren de lunes a viernes: el merge va fuera de 9:45 a 11:30 UTC (spec 14 §5.2).
- Vercel deja viva la deployment anterior. Un rollback (instant rollback) vuelve solo el código; no deshace migraciones ni sesiones que eve ya importó al modelo nuevo.
- Subir eve de versión cambia rutas y contratos: la 0.58 movió el MCP del agente a `/eve/outreach/v1/mcp` y la URL vieja da 404 sin redirect, así que hay que reconfigurar los conectores después del deploy ([#60](https://github.com/innovasbuild/agents/pull/60)).

## Qué verifica un cierre en producción

Una etapa con efecto en producción no se da por cerrada al mergear: se cierra cuando un criterio observable pasó contra el deploy real. Las specs y los PR de cierre ([#7](https://github.com/innovasbuild/agents/pull/7), [#39](https://github.com/innovasbuild/agents/pull/39), [#53](https://github.com/innovasbuild/agents/pull/53), [#59](https://github.com/innovasbuild/agents/pull/59)) muestran la forma:

- **Los criterios de la spec, uno por uno, con su evidencia**: el id de la pasada en `runs`, la fila en `usage_entries`, el asiento con `source: gateway`. No un "anda".
- **El camino negativo**: con el presupuesto en cero, la pasada cierra `budget_exhausted` sin perder ítems; un ítem forzado a fallar queda `failed` a la tercera; sin filas en `tenant_workflows` no corre nada; un usuario de otra empresa recibe 403 o 404.
- **Aislamiento entre empresas**: el cierre de la Etapa 2 encontró una fuga real de credenciales de HubSpot entre tenants, que se corrigió y se re-verificó ahí mismo ([#7](https://github.com/innovasbuild/agents/pull/7)).
- **Lo que solo existe en producción**: el cron registrado en Vercel, el hook de Auth, OIDC, la verificación de conectores, el login con el proveedor real. Si no se pudo probar, el PR lo dice en "Sin verificar" y la etapa queda abierta en el roadmap hasta que alguien lo haga.
- **Que lo viejo siga igual**: tras un deploy, el tenant existente aterriza donde siempre y ve su menú completo.

Las verificaciones con login real las corre una persona; un agente no puede autenticarse en producción.

## Cómo se prueba

- `npm run typecheck`, `npm test`, `npm run db:test` y `npm run build` antes de mergear. `db:test` resetea la base local y corre los pgTAP de `supabase/tests/`.
- Las constantes que protegen el deploy tienen test: `tests/workflows/dispatch.test.ts` verifica que `TICK_BUDGET_MS + ITEM_TIMEOUT_MS` quede debajo del timeout de 300 s de la función de Vercel.
- Lo de Vercel y Supabase en la nube no se prueba en automático: es el cierre en producción de arriba.

## Decisiones

- Specs: [subida de eve (Etapa 14)](../superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md) · [segundo tenant (21.4)](../superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md) · plan de [cierre de la Entrega 3 de la Etapa 12](../superpowers/plans/2026-09-21-etapa-12-e3-refresh-fichas.md) (Task 23, el modelo de runbook: migraciones, merge, cron, criterios).
- [#60](https://github.com/innovasbuild/agents/pull/60): eve 0.54 a 0.67, ventana de merge y rollback.
- [#63](https://github.com/innovasbuild/agents/pull/63): `db:types` contra la base local.
- [#87](https://github.com/innovasbuild/agents/pull/87): orden de despliegue de la consola (consulta de conectores, `migration list`, migración antes del código).
- [#91](https://github.com/innovasbuild/agents/pull/91): plantillas de mail pegadas a mano, `otp_length` y `otp_expiry`, migración antes del código.
- Cierres: [#7](https://github.com/innovasbuild/agents/pull/7) (Etapa 2), [#39](https://github.com/innovasbuild/agents/pull/39) (Etapa 12 E3), [#53](https://github.com/innovasbuild/agents/pull/53) (Etapa 11), [#59](https://github.com/innovasbuild/agents/pull/59) (Etapa 6).
