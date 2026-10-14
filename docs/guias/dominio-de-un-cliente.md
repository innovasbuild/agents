---
title: Dominio propio de un cliente
category: guias
status: activo
tags: [dominio, dns, vercel, supabase, consola, plataforma, mcp]
updated: 2026-10-14
sources:
  - docs/superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md
  - app/plataforma/[slug]/domain-actions.ts
  - app/plataforma/[slug]/console/domain-section.tsx
  - lib/domains
  - agents/outreach/schedules/domain-sweep.ts
  - supabase/migrations/20261024120000_tenant_domains.sql
---

# Dominio propio de un cliente

Cómo dejar a una empresa sirviéndose desde su dominio (por ejemplo `ai.tuempresa.com`): la app, el login, el chat y las URLs de conexión por MCP salen con ese dominio, y los links de invitación también. Lo hace una persona de plataforma desde la consola; el cliente solo crea un registro DNS. El diseño está en la [spec de la 21.6](../superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md) y cómo resuelve el host la plataforma, en [tenancy](../arquitectura/tenancy.md).

## Antes de empezar

- Las variables del servidor, solo en Production ([entornos y deploy](../arquitectura/entornos-y-deploy.md)): `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (y `VERCEL_TEAM_ID` si el proyecto es de un equipo) y `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. Sin ellas la consola lo avisa arriba de la sección "Dominio" y no deja cargar ni activar dominios.
- Un **subdominio completo** del cliente (`ai.tuempresa.com`), nunca el dominio sin subdominio: lo puede crear cualquiera que administre el DNS con un `CNAME`. No se aceptan hosts de la plataforma (`*.innov.as`), `*.vercel.app` ni IPs.

## Pasos

1. **Cargar el dominio.** En `/plataforma/<slug>`, sección **Dominio**, escribí el hostname y apretá "Agregar dominio". La consola lo valida, lo agrega al proyecto de Vercel y lo deja en "Esperando el DNS". Solo plataforma puede hacerlo; el administrador de la empresa ve el estado en su `/settings`, sin acciones.
2. **Pasarle al cliente las instrucciones.** Debajo del dominio, la consola muestra el registro que tiene que crear: un `CNAME` con el valor que devuelve Vercel (no se escribe a mano) y, solo si el dominio estaba en otra cuenta de Vercel, un `TXT` de propiedad. El texto para mandarle está abajo.
3. **Esperar.** Cuando el DNS responde, el dominio se activa solo: un barrido corre cada 10 minutos (`domain-sweep`), o apretá "Verificar ahora". Para activarlo, la plataforma lo registra también en las Redirect URLs de Supabase Auth; si eso falla, el dominio **no** se activa y la consola muestra el motivo.
4. **Comprobar.** Entrá por el dominio y recorré: `/login` (código y link), `/chat`, `/conectar` (las URLs tienen que ser del dominio: `/brain/mcp` y `/eve/outreach/v1/mcp`), una conexión real de Claude al brain y una invitación (el link tiene que salir con el dominio).
5. **Principal.** El primer dominio activo es el principal: es el que usan los links de invitación. Con más de uno, "Hacer principal" cambia cuál.
6. **Quitar.** "Quitar" lo saca de Vercel, de las Redirect URLs y de la base. Si Vercel no responde, no borra la fila: reintentá.

## Qué decirle al cliente

> **Para usar la plataforma desde tu propio dominio**
>
> 1. Elegí un subdominio de tu empresa, por ejemplo `ai.tuempresa.com`. No uses el dominio sin subdominio (`tuempresa.com`).
> 2. Pedile a quien administra tu DNS que cree este registro: tipo `CNAME`, nombre el subdominio que elegiste y valor el que te pasamos. Si tu proveedor lo pide, TTL de 5 minutos.
> 3. Avisanos cuando esté creado. En unos minutos el dominio queda activo con su certificado.
> 4. A partir de ahí tu equipo entra por `https://ai.tuempresa.com` y las conexiones a Claude o ChatGPT usan esa dirección.
>
> Una cosa a tener en cuenta: cuando alguien conecta Claude o ChatGPT por primera vez, la pantalla de autorización que aparece es la de la plataforma (`agentes.innov.as`), no la de tu dominio. Es normal y pasa una sola vez por persona.

## Qué va a fallar si te olvidás de algo

| Síntoma | Causa |
|---|---|
| La sección avisa "Falta configurar en el servidor" | Faltan las variables de Vercel o de Supabase. No se puede cargar nada |
| "Ese dominio ya está en otro proyecto de Vercel" | Otro proyecto o cuenta lo tiene. Hay que quitarlo de ahí o verificar la propiedad con el `TXT` |
| Queda en "Esperando el DNS" | El `CNAME` no existe todavía o no propagó. Probar `dig CNAME <dominio>` |
| Queda en "Esperando el DNS" con "No pude registrar el dominio en Supabase Auth" | El token de Supabase no tiene permiso o Supabase no guardó la lista. Revisar `SUPABASE_ACCESS_TOKEN` y las Redirect URLs |
| El login por link o por Google vuelve a `agentes.innov.as` y falla | El dominio no está en las Redirect URLs de Supabase. El login por código anda igual |
| El MCP rechaza la conexión | El cliente se conectó a una URL que no es la de `/conectar` o el dominio no está activo |

## Qué no se oculta

La pantalla de consentimiento OAuth que Supabase abre al conectar Claude o ChatGPT vive en la Site URL del proyecto, o sea en `agentes.innov.as`, y el emisor es el de Supabase. Son de la plataforma, no de cada empresa (spec 21.6 §4.7).
