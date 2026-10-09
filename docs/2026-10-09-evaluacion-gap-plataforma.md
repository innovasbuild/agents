---
title: Evaluación de la plataforma contra la visión de producto — gap
fecha: 2026-10-09
base: origin/main e3dc003 (PR #83) · roadmap docs/01-roadmap-etapas.md
autor: Claude (sesión de evaluación con Mati)
plan: docs/2026-10-09-plan-cierre-gap-plataforma.md
---

> **Actualización del mismo día.** La primera versión se escribió sobre a3bb5b8 (PR #79). Durante el día se publicaron los PR #80 a #83: el ingreso por dominio quedó implementado (G3 cerrado en lo esencial) y el canal MCP del agente quedó alineado con el tenant dueño (parte de G6). Las secciones de abajo están corregidas; el plan de cierre vive en el documento enlazado arriba.

# Evaluación de gap: plataforma INNOV.AS hoy contra la visión

## 1. La visión, en nueve capacidades

Lo que Mati describió se descompone así. Cada fila tiene un estado honesto según el código en `origin/main`:

| # | Capacidad | Estado | Resumen |
|---|---|---|---|
| V1 | Varias empresas, cada una con sus usuarios corporativos | 🟢 | Tenants, membresías con tres roles, RLS por `tenant_id`, consola `/plataforma`, landing de login por empresa con marca propia. |
| V2 | Brain por empresa con permisos granulares de lectura y escritura | 🟢 | Reglas por carpeta y página, por persona o para todos los miembros, con herencia. Valen igual en web, MCP y chat del agente. Falta verificar en producción (etapas 17 y 18 siguen abiertas). |
| V3 | Brain accesible por web y por conector MCP | 🟢 | Editor visual, árbol, historial, borrado. MCP con OAuth 2.1 de Supabase en `/brain/<slug>/mcp`. Probado en Claude Code; claude.ai, Codex y ChatGPT sin probar. |
| V4 | Entrada por mail corporativo o por invitación, configurable | 🟢 | Invitación funciona de punta a punta. Ingreso por dominio publicado hoy (PR #81): modo elegido por el admin de la empresa, dominios cargados por plataforma, `join_tenants_by_domain()` con evento. Quedan: "Confirm email" a confirmar en producción, métodos de login aplicados solo en pantalla, sin Microsoft, sin bloqueo por persona. |
| V5 | Configuración por empresa desde el panel del tenant | 🟡 | La consola edita nombre, dominios, modelos, marca, login y estado. Agentes, conectores, ejecutores y brain se configuran **por scripts** (`connections:bind`, `executors:set`, `outreach:config`), no desde la UI. |
| V6 | Catálogo de agentes preprogramados (comercial, postventa, compras, decisor) | 🔴 | Hay un solo agente, `outreach`. La arquitectura "un agente, N tenants" está probada con un solo tenant real (Etapa 7, segundo tenant, nunca corrió). `create_tenant` hardcodea `outreach`. |
| V7 | Permisos por agente: qué datos usa y quién lo puede usar | 🟡 | Qué datos: `tenant_agents.config.brain` (`none/read/read_write`) y conexiones por tenant. Quién lo usa: **no hay control**; alcanza con ser miembro. Para actuar hace falta además fila en `executors`. |
| V8 | Herramientas de la empresa conectadas con permisos granulares, visibles desde la plataforma o por MCP | 🔴 | Las conexiones (HubSpot, ColdIQ, Places, Apollo, Gmail) existen por tenant, pero **solo las usa el agente por dentro**. Ningún usuario puede ver ni usar las tools de su empresa desde su Claude. Sin permisos por usuario o rol sobre conexiones. |
| V9 | Listado para el usuario de lo que tiene disponible, con instrucciones de conexión | 🔴 | Solo dos markdown en el repo (`docs/brain-mcp-conexion.md`, `docs/agente-mcp-conexion.md`). Nada en la UI. Uno de los dos está desactualizado. |

Lectura rápida: **la base multi-tenant y el brain están sólidos; lo que falta es la capa de producto** que convierte eso en "cada empresa configura sus agentes y herramientas, y cada persona se conecta desde donde trabaja".

## 2. Lo que existe hoy, con evidencia

### 2.1 Identidad, tenants y acceso

- Login con Google OAuth y magic link (`app/(auth)/login/login-form.tsx`). Sin password, sin Microsoft, sin SSO/SAML, sin MFA.
- `/login/<slug>`: landing pública con logo, colores y solo los `auth_methods` del tenant (`app/(auth)/login/[tenant]/page.tsx`). La restricción es de pantalla: desde `/login` se entra por cualquier método (spec alta, decisión A2).
- La membresía nace en `joinOnLogin` (`lib/auth/join-on-login.ts`), llamada desde `/auth/callback` y `/auth/confirmar`: primero `accept_pending_invitations()`, después `join_tenants_by_domain()` (PR #81). Una invitación como admin gana sobre el dominio.
- `tenants.allowed_domains` los carga plataforma en `/plataforma/<slug>`; `tenants.self_signup_by_domain` lo elige el admin de la empresa en `/<slug>/settings` (sección "Ingreso"). El modo abierto exige al menos un dominio y rechaza dominios de correo público; un trigger impide que un tenant_admin toque otras columnas de `tenants`.
- Condición de producción pendiente: "Confirm email" prendido en Supabase Auth; sin eso, "correo verificado" no vale (spec ingreso por dominio §6).
- Roles: `platform_admin`, `tenant_admin`, `tenant_member`. El `platform_admin` real es el del tenant dueño (`PLATFORM_OWNER_TENANT_SLUG`). No se puede otorgar desde la app.
- Consola `/plataforma`: lista, alta (con primer admin invitado) y edición de empresas. Sin borrado, sin cambio de rol, sin reenvío de invitación.
- `/<slug>/settings`: modelo default editable; ejecutores y conexiones en solo lectura. `/<slug>/settings/usuarios`: invitar, revocar invitación, sacar miembro.
- PR #80 (mergeado hoy) cerró el hueco de RLS en `memberships`; PR #83 dejó el login por mail sin oráculo de correos.

### 2.2 Brain

- Modelo: `brain_pages` con slug jerárquico (la carpeta es el prefijo), revisiones append-only, búsqueda full-text en español. Un brain por tenant (`tenant_connections_one_brain`).
- Permisos: `brain_access_rules(path, principal user|members, level lector|editor|administrador|ninguno)`. La decisión se toma en TypeScript (`lib/brain/core/access/resolve-access.ts`) y envuelve al provider (`with-access.ts`); la lectura directa de `brain_pages` por API quedó revocada. Admins del tenant y plataforma siempre son administradores.
- Compartir: menú de tres puntos y diálogo con personas, niveles, heredados y acceso general (`components/brain/share-dialog.tsx`).
- UI: árbol estilo Obsidian, índice con búsqueda, editor Tiptap con vista de código, vista de papel, historial con diff y restaurar, mapa de links, borrado con limpieza de links entrantes.
- MCP: `app/brain/[tenant]/mcp/route.ts` sobre `@modelcontextprotocol/sdk`, OAuth 2.1 de Supabase con registro dinámico, consentimiento en `/oauth/consent`, rate limit 60/10 por minuto. Las tres tools se listan siempre; el acceso lo decide la regla. **Este endpoint es la prueba de que la plataforma sabe servir un MCP propio con permisos finos**: es el patrón a reusar para las herramientas (V8).
- Agente: actúa en el chat con los permisos de la persona (`acting-provider.ts`). En corridas desatendidas (schedules, workflows) ve todo como administrador. `brain_upsert` del agente pide aprobación de un admin.

### 2.3 Agentes y canal MCP

- Un agente, `outreach`, en `next.config.ts`. Modelo, instrucciones, conexiones y tools del brain son dinámicos por tenant (`defineDynamic` en `session.started`). Skills estáticas.
- `tenant_agents (tenant_id, agent, enabled, model, daily_quota, config)`. Sin UI para prender o apagar; `create_tenant` inserta siempre `outreach`.
- Canal MCP del agente (`agents/outreach/channels/mcp.ts`): `mcpChannel` de eve con el mismo emisor OAuth. Expone solo `agent_start/get/update/cancel`; el tenant viaja en `?tenant=<slug>`. No chequea `tenant_agents.enabled` (el canal web sí). Desde PR #82 reconoce como plataforma solo al `platform_admin` del tenant dueño, igual que web y brain. Las aprobaciones por este canal se contestan con `agent_update` desde el cliente, sin pasar por `/cola`.
- Niveles de efecto 0 a 3 con aprobación según efecto (`lib/workflows/registry.ts`, `docs/02-orquestacion.md`). Es la pieza que hace viable exponer herramientas hacia afuera sin perder el control.

### 2.4 Conexiones a herramientas de la empresa

- `tenant_connections (tenant_id, capability, provider, connector_uid, config, enabled)`; escritura solo por service role vía `scripts/connections-bind.mts`.
- Proveedores (`lib/connectors/providers.ts`): hubspot (MCP remoto, solo lectura por allowlist + REST para escribir), coldiq y google-places (OpenAPI con allowlist), apollo (solo REST en un schedule, sin builder), gmail (tool propia), wiki y mcp (brain).
- Credenciales: api-key por tenant "como app"; OAuth (HubSpot, Gmail) con grant por `tenant:usuario` (`lib/connectors/auth.ts`). Cada persona autoriza su propia cuenta. El modelo nunca ve credenciales.
- Permisos por conexión: no existen. Filtros reales: `enabled`, tener grant propio, ser ejecutor.
- Exposición hacia afuera: ninguna. `hubspot-innov` y `coldiq-innov` del `CLAUDE.md` son servers locales del desarrollador, no algo que sirva la plataforma.

## 3. Los gaps, uno por uno

Ordenados por distancia entre lo que se promete y lo que hay. Esfuerzo en talles: S (días), M (una o dos semanas), L (varias semanas, con decisiones de diseño).

### G1 · Un usuario no puede ver ni usar las herramientas de su empresa desde su Claude o ChatGPT — L

Es el gap más grande y el que más depende de diseño. Hoy la plataforma tiene dos superficies MCP: el brain (propio, con permisos) y el agente (eve, cuatro tools genéricas). `mcpChannel` de eve no expone las tools de las conexiones, por diseño: delega trabajo al agente completo.

Lo que hace falta es una tercera superficie: un **MCP de herramientas por tenant** (`/tools/<slug>/mcp` o similar) que:

1. autentique con el mismo emisor OAuth (ya resuelto);
2. liste las tools de las conexiones habilitadas del tenant que esa persona tiene permitidas;
3. ejecute cada tool con el grant de esa persona (Vercel Connect con subject `tenant:usuario`, que ya existe) o con la api-key del tenant;
4. aplique el nivel de efecto: nivel 2 y 3 por MCP exigen una política explícita (hoy el canal MCP del agente delega la aprobación al cliente; para tools sueltas hay que decidir si se permite, se niega o se deja pieza pendiente);
5. registre uso en `usage_entries` como cualquier nodo.

Decisiones de diseño abiertas: cómo generalizar `brain_access_rules` a "reglas de acceso a recursos" (brain, conexión, agente) sin duplicar el motor; si el MCP de herramientas reusa las definiciones de eve (`catalog.ts`) o llama a los servidores remotos directo con el SDK de MCP; y qué pasa con tools de escritura (hoy HubSpot por MCP es solo lectura por allowlist).

### G2 · No hay dónde ver "qué tengo disponible y cómo lo conecto" — S

Dos markdown en el repo, ninguna pantalla. Y `docs/brain-mcp-conexion.md` sigue diciendo que solo los admins escriben por MCP, cuando desde la Etapa 17 la regla por carpeta decide.

Hace falta una página por usuario (por ejemplo `/<slug>/conectar` o una pestaña en el perfil) que liste, según sus permisos:

- el brain, con su URL;
- cada agente habilitado, con su URL y `?tenant=`;
- más adelante, el MCP de herramientas (G1);

y para cada uno, instrucciones copiables para Claude Code (`claude mcp add ...`), claude.ai (conector personalizado), ChatGPT (conector MCP remoto con OAuth; para que aparezca en deep research la doc de OpenAI exige tools `search` y `fetch`, lo que el brain podría cumplir con un alias), Codex y Cursor (`.mcp.json`). Es el gap más barato de cerrar y el que más cambia la percepción del cliente.

### G3 · Entrada por dominio de mail corporativo — cerrado hoy en lo esencial (PR #81); resto S a M

Lo que queda, según la spec `2026-10-09-ingreso-por-dominio-design.md` §6:

- confirmar en producción "Confirm email" prendido en Supabase Auth (condición de deploy);
- imponer `auth_methods` en el servidor, no solo en pantalla (spec alta A2 lo deja como límite declarado);
- Microsoft (Entra ID) como tercer método, porque el primer cliente candidato es "del universo Microsoft" (spec alta §1). Es sumar un valor al check, el proveedor en Supabase y un botón, con cuidado de que el correo venga verificado (nOAuth). Ese cliente no podría usar el agente de outreach hasta que exista un proveedor Outlook;
- bloquear a una persona puntual de un dominio abierto, y decidir qué pasa con quienes ya entraron cuando se cierra el modo.

### G4 · Configuración del tenant desde la UI: agentes, conectores y ejecutores — M

Hoy un admin de tenant ve ejecutores y conexiones en solo lectura y la pantalla le dice "se editan con `npm run executors:set`". Para que "cada empresa decida qué usos le da" hace falta:

- en `/plataforma/<slug>` o en `/<slug>/settings`: prender y apagar agentes (`tenant_agents.enabled`), elegir su acceso al brain (`config.brain`) y su política de aprobaciones de nivel 2 (`config.approvals`);
- conectar un proveedor desde la UI: alta de `tenant_connections` con el flujo de Vercel Connect para api-key u OAuth, en vez de `connections:bind`;
- gestionar ejecutores (cupo, firma) desde `/settings`;
- cambiar rol de un miembro y reenviar invitación.

Decisión pendiente: qué queda en la consola de plataforma (lo hace INNOV.AS) y qué en el settings del tenant (lo hace el cliente). La regla del kickoff, "los agentes se preparan en acuerdo con la empresa e INNOV.AS los implementa", sugiere que el alta de agentes y conectores sea de plataforma y el uso diario sea del tenant.

### G5 · Catálogo de agentes y permisos de uso por agente — M a L

- Solo existe `outreach`. Los agentes de la visión (atención comercial, postventa, compras, decisor sobre información del cliente) no están ni diseñados, salvo la Etapa 10 (inbound y handoff) que está en el roadmap sin arrancar.
- Sumar un agente es mecánico en eve (una carpeta más en `agents/` y una clave en `withEve`), y el patrón de parametrizar por tenant ya existe. Lo que no existe es el **catálogo**: una tabla o registro que diga qué agentes hay, qué hacen, qué capacidades necesitan (CRM, mail, brain) y cómo se muestran en la UI. Hoy `create_tenant` y el chat asumen `outreach` por nombre.
- Quién puede usar cada agente: no hay nada. Alcanza con ser miembro. La forma más corta es reusar el motor de reglas del brain con un principal por agente (la spec 17 §9 ya lo lista como pendiente para el lado inverso: el agente como principal con permisos propios).
- El chat web tiene un solo agente implícito; con varios hace falta selector y un hilo por agente. El canal MCP del agente necesitaría una URL por agente (ya es así por construcción en eve).

### G6 · Cerrar lo que está hecho pero sin verificar en producción — S

- Etapas 17 y 18 figuran `[ ]` en el roadmap aunque el código está mergeado: falta el recorrido en navegador y por MCP en `innovas`, y el criterio de cierre de la 17 (restringir una carpeta y que otro miembro no la vea en árbol, MCP ni chat) no se ejecutó en producción.
- Ingreso por dominio (PR #81) sin recorrido en navegador contra producción, y "Confirm email" sin confirmar.
- El canal MCP del agente no chequea `tenant_agents.enabled`.
- claude.ai, Codex y ChatGPT no se probaron nunca como clientes del brain ni del agente.

### G7 · Segundo tenant real — M (es la prueba, no una feature)

La Etapa 7 es la que valida la promesa "la diferencia entre tenants es una fila y su brain". Nunca se corrió. Todo lo de G4 y G5 se va a diseñar mejor con un segundo cliente real en la base, aunque sea de prueba.

### Fuera de la visión descripta pero necesarios para vender la plataforma

- Observabilidad por cliente (Etapa 9): un admin de tenant hoy no ve sus corridas, fallas ni gasto.
- Canales Slack y WhatsApp (Etapa 8): la visión habla de "la herramienta de uso cotidiano"; hoy eso es MCP. Chat SDK está diseñado y no arrancado.

## 4. Orden sugerido

El orden y el detalle de cada etapa están en `docs/2026-10-09-plan-cierre-gap-plataforma.md`, y las etapas 19 a 23 quedaron agregadas a `docs/01-roadmap-etapas.md`. En una línea:

1. **Etapa 19** · página "Conectá tus herramientas" y cierre en producción de 17, 18 e ingreso por dominio (G2 y G6).
2. **Etapa 20** · Microsoft, imposición de métodos de login y bloqueo por persona (resto de G3).
3. **Etapa 21** · configuración de la empresa desde la UI, con la Etapa 7 como prueba (G4 y G7).
4. **Etapa 22** · catálogo de agentes y permisos de uso por agente (G5).
5. **Etapa 23** · MCP de herramientas por tenant con permisos (G1).

## 5. Notas de estado para esta sesión

- Evaluación hecha sobre `origin/main` e3dc003; el checkout local de `main` se adelantó a ese commit con fast-forward.
- No se modificó código. Archivos nuevos: este documento y el plan; archivo tocado: el roadmap (etapas 19 a 23).
