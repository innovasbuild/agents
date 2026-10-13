---
title: Plan para cerrar el gap entre la plataforma y la visión de producto
fecha: 2026-10-09
base: docs/2026-10-09-evaluacion-gap-plataforma.md · origin/main e3dc003 (PR #83)
estado: propuesta, a confirmar con Mati
---

# Plan de cierre del gap

Este plan convierte los gaps de la evaluación en **cinco etapas nuevas del roadmap (19 a 23)**, en el orden en que conviene ejecutarlas. Cada etapa sigue el proceso del repo: sesión propia, `superpowers:brainstorming` → spec → plan → TDD → `/ship`. Acá se fija el alcance, el orden y el criterio de cierre; el diseño fino va en la spec de cada una.

## 0. Lo que cambió hoy

Los cuatro PRs de hoy mueven dos gaps de la evaluación:

| PR | Qué cerró | Gap |
|---|---|---|
| #80 | `memberships` sin INSERT ni UPDATE de `user_id`/`tenant_id` para `authenticated` | G6 (seguridad) |
| #81 | **Ingreso por dominio**: modo "solo por invitación" o "todos los del dominio", elegido por el admin de la empresa en settings; dominios cargados por plataforma; `join_tenants_by_domain()` con evento `membership.joined_by_domain`; candado de columnas en `tenants`; dominios públicos rechazados | **G3, cerrado en lo esencial** |
| #82 | El canal MCP del agente reconoce como plataforma solo al `platform_admin` del tenant dueño | G6 (el "todavía no alineado" del README del brain) |
| #83 | El login por mail responde igual con o sin acceso (sin oráculo de correos) | G3 |

Lo que queda de G3 después de hoy, según la spec §6 del ingreso por dominio:

- Confirmar en producción que Supabase Auth tiene **"Confirm email" prendido** (condición de deploy; sin eso, el "correo verificado" no vale).
- Los `auth_methods` por empresa siguen aplicándose solo en pantalla.
- No hay login con Microsoft; el primer cliente candidato es del universo Microsoft.
- Bloquear a una persona puntual de un dominio abierto no existe (sacarla no la bloquea mientras el modo siga abierto).
- Cerrar el modo no saca a quienes ya entraron.

## 1. Orden y dependencias

```
19 Conectá tus herramientas + cierre en producción      (S)   sin dependencias
20 Login: Microsoft, imposición de métodos, bloqueo     (S-M) sin dependencias; conviene después de 19
21 Configuración de la empresa desde la UI + 2° tenant  (M)   usa la página de 19 para mostrar lo configurado
22 Catálogo de agentes y permisos de uso                (M-L) necesita 21 (agentes se prenden desde la UI)
23 MCP de herramientas por tenant con permisos          (L)   necesita 21 (conectores desde la UI) y 22 (reglas de acceso generalizadas)
```

19 y 20 se pueden correr en paralelo en dos sesiones. 21 → 22 → 23 van en serie. La Etapa 7 (segundo tenant) se ejecuta dentro de la 21 como prueba.

Por qué este orden y no otro:

- **19 primero** porque es lo más barato y lo que el cliente ve: el brain ya anda por MCP, pero nadie lo sabe desde la plataforma. Además cierra deuda de verificación (17, 18, ingreso por dominio) que hoy frena marcar etapas como terminadas.
- **23 último** porque es la única etapa con decisiones de diseño abiertas, y porque el modelo de reglas de acceso tiene que servir para brain, agentes y conexiones a la vez. Diseñarlo antes de tener catálogo de agentes (22) y conectores desde la UI (21) sería diseñar en el aire.
- **Observabilidad por cliente (Etapa 9)** no entra en este plan porque no está en la visión descripta hoy, pero conviene ubicarla después de la 21: un admin de tenant que configura agentes y conectores va a querer ver qué corrió.

## 2. Las etapas

### Etapa 19 · "Conectá tus herramientas" y cierre en producción — S

**Objetivo.** Que cada persona vea, dentro de la plataforma, qué tiene disponible para conectar a Claude, ChatGPT, Claude Code, Codex o Cursor, con instrucciones copiables, y que lo hecho en 17, 18 e ingreso por dominio quede verificado en producción.

**Modelo Claude Code:** Sonnet 5 (UI y docs). Opus 5 solo si la verificación en producción destapa un defecto de permisos.

**Entregables.**

- [ ] Página `/<slug>/conectar` (nombre a decidir en la spec; aparece en el menú para todos los roles). Lista por usuario, según lo que tiene permitido: el brain (URL `/brain/<slug>/mcp`), cada agente habilitado en `tenant_agents` (URL `/eve/<agente>/v1/mcp?tenant=<slug>`), y un lugar reservado para el MCP de herramientas (Etapa 23).
- [ ] Por ítem, pestañas con instrucciones para Claude Code (`claude mcp add ...`), claude.ai (conector personalizado), ChatGPT (conector MCP remoto con OAuth), Codex y Cursor (`.mcp.json`). Texto en castellano, botón de copiar, sin exponer tokens: la autenticación la hace el OAuth de Supabase al conectar.
- [ ] Probar de verdad claude.ai y ChatGPT contra el brain de `innovas` en producción. Para ChatGPT, averiguar si hace falta exponer tools `search` y `fetch` (lo exige para deep research) y decidir si el brain las ofrece como alias.
- [ ] Corregir `docs/brain-mcp-conexion.md` (hoy dice que solo admins escriben) y `docs/agente-mcp-conexion.md` para que coincidan con la página. La página es la fuente; los markdown quedan como referencia o se borran.
- [ ] Verificación en producción de lo pendiente: criterio de cierre de la 17 (restringir una carpeta y que otro miembro no la vea en árbol, MCP ni chat), recorrido de la 18 (borrado, editor, 375 px, modo oscuro), e ingreso por dominio (una persona nunca invitada entra por `/login/<slug>`). Confirmar "Confirm email" prendido en Supabase Auth y `PLATFORM_OWNER_TENANT_SLUG` en Vercel.
- [ ] Marcar 17 y 18 como `[x]` en el roadmap.
- [ ] El canal MCP del agente chequea `tenant_agents.enabled` como ya lo hace el canal web (hoy el freno llega recién en las tools).

**Terminado cuando:** un `tenant_member` de `innovas` entra a la página, copia las instrucciones, conecta el brain desde claude.ai y desde ChatGPT y `brain_search` le responde su canon; y las etapas 17 y 18 figuran cerradas con su verificación en producción anotada.

### Etapa 20 · Login: Microsoft, imposición de métodos y bloqueo por persona — S a M

**Objetivo.** Que una empresa del universo Microsoft entre con su cuenta corporativa, que los métodos de login elegidos por empresa se cumplan en el servidor y no solo en la pantalla, y que un admin pueda sacar a una persona de un dominio abierto sin cerrar el modo para todos.

**Modelo Claude Code:** Opus 5 para la spec (es auth). Sonnet 5 para implementar.

**Entregables.**

- [ ] Microsoft (Entra ID) como tercer valor de `auth_methods`: proveedor Azure en Supabase Auth, botón en `LoginForm`, check de la columna ampliado. Cuidado con nOAuth (spec ingreso por dominio §6): el correo tiene que venir verificado o se rechaza el join por dominio para ese proveedor.
- [ ] Imposición en el servidor: en `/auth/callback` y `/auth/confirmar`, si la persona entra por un método que ninguna de sus empresas permite, no se une por dominio y se le muestra la landing de su empresa con los métodos válidos. Decidir en la spec qué pasa con alguien que ya tiene membresía y entra por un método ahora prohibido.
- [ ] Bloqueo por persona: tabla o columna (`memberships.blocked_at` o lista de exclusión por tenant) que `join_tenants_by_domain()` respeta. Botón "Bloquear" en `/settings/usuarios`, con evento.
- [ ] Cambio de rol de un miembro existente y reenvío de invitación desde `/settings/usuarios` (dos faltantes chicos de la consola que molestan en la operación diaria).
- [ ] Dejar escrito en la spec qué pasa con Gmail para un cliente solo-Microsoft: el agente de outreach sigue necesitando Gmail hasta que exista un proveedor Outlook, que es otra etapa.

**Terminado cuando:** en producción, una empresa de prueba con `auth_methods = {microsoft}` y modo abierto recibe a una persona con cuenta Microsoft de su dominio sin invitación; esa misma persona no puede entrar por Google desde `/login`; y una persona bloqueada no vuelve a entrar aunque el modo siga abierto.

### Etapa 21 · Configuración de la empresa desde la UI y segundo tenant — M

**Objetivo.** Que dar de alta y operar un cliente no requiera la terminal: agentes, conectores, ejecutores y brain se configuran desde la consola de plataforma o el settings del tenant, según a quién le corresponda. La Etapa 7 (segundo tenant) se corre como prueba de esta etapa.

**Modelo Claude Code:** Opus 5 para la spec (decide la frontera plataforma/tenant). Sonnet 5 para implementar.

**Decisión central para la spec:** qué configura INNOV.AS desde `/plataforma/<slug>` y qué configura el cliente desde `/<slug>/settings`. Propuesta de partida, alineada con el kickoff ("los agentes se preparan en acuerdo con la empresa e INNOV.AS los implementa"):

| Qué | Dónde | Quién |
|---|---|---|
| Habilitar agentes, acceso al brain de cada agente (`config.brain`) | `/plataforma/<slug>` | platform_admin |
| Alta de conectores (`tenant_connections`): proveedor, api-key u OAuth por Vercel Connect, habilitado | `/plataforma/<slug>` | platform_admin |
| Brain: alta del binding `wiki` (hoy script) | `/plataforma/<slug>` | platform_admin |
| Política de aprobaciones de nivel 2 por nodo (`config.approvals`), cupos, ejecutores (quién, cupo, firma) | `/<slug>/settings` | tenant_admin |
| Autorizar la propia cuenta de Gmail o HubSpot | `/<slug>/settings` (sección "Mis cuentas") | cada usuario |

**Entregables.**

- [ ] Reemplazar `scripts/connections-bind.mts`, `executors-set.mts` y el alta de brain por pantallas con server actions y RLS (hoy `tenant_connections` y `executors` solo se escriben con service role: la spec decide si abrir RLS por rol o mantener funciones `security definer`).
- [ ] `create_tenant` deja de hardcodear `outreach`: el alta elige agentes de un catálogo (lo mínimo para la 22).
- [ ] Sección "Mis cuentas" para que cada persona autorice o reautorice Gmail y HubSpot sin esperar a que falle una acción de la cola (hoy el link aparece solo al fallar).
- [ ] **Etapa 7 como prueba:** dar de alta un segundo tenant real o de ensayo con otro CRM (o ninguno), configurarlo entero desde la UI y correr el piloto de 5 contactos sin tocar `agents/` ni `lib/`. Medir horas contra la Etapa 3.
- [ ] Mostrar en la página de la 19 lo que quedó habilitado.

**Terminado cuando:** un platform_admin da de alta una empresa, le habilita agentes y conectores, y un tenant_admin de esa empresa configura ejecutores y aprobaciones, todo desde el navegador; y el piloto del segundo tenant corre sin cambios de código.

### Etapa 22 · Catálogo de agentes y permisos de uso por agente — M a L

**Objetivo.** Que la plataforma tenga más de un agente, que cada empresa vea un catálogo y elija, que el chat permita elegir con cuál hablar, y que un admin decida qué personas o roles pueden usar cada agente.

**Modelo Claude Code:** Opus 5 para la spec (toca el modelo de permisos). Sonnet 5 para implementar.

**Entregables.**

- [ ] Registro de agentes en código (`lib/agents/catalog.ts` o similar): nombre, descripción en castellano, capacidades que necesita (crm, mail, brain, leads), nivel máximo de efecto de sus tools. El test falla si hay una carpeta en `agents/` que no está en el catálogo, igual que con `TOOL_LABELS` y el registry de workflows.
- [ ] Segundo agente real. Candidato: el agente inbound de la Etapa 10 (califica a un prospecto que escribe y deriva a un comercial), o uno de los de la visión (postventa, compras). Elegirlo con Mati en el brainstorming; conviene el que tenga un cliente esperándolo.
- [ ] Chat con selector de agente e hilos por agente (`conversations.agent` ya existe). El canal MCP ya da una URL por agente.
- [ ] Permisos de uso: quién puede usar cada agente dentro de la empresa. Reusar el motor de reglas del brain generalizándolo a recursos (`resource_access_rules` con `kind = brain | agent | connection`, principal persona o todos los miembros, nivel usar o ninguno). Es la misma tabla que después usa la 23. Esta es la decisión de diseño más importante de la etapa y la spec la tiene que cerrar.
- [ ] El agente como principal con permisos propios sobre el brain (pendiente de la spec 17 §9): reemplaza `config.brain` por reglas en la misma tabla.
- [ ] La página de la 19 y el chat muestran solo los agentes que la persona puede usar; el canal MCP del agente rechaza a quien no.

**Terminado cuando:** una empresa tiene dos agentes habilitados; un admin le da uso de uno solo a una persona; esa persona lo ve en el chat, en la página de conexión y por MCP, y el otro no aparece ni responde por ningún canal.

### Etapa 23 · MCP de herramientas por tenant con permisos — L

**Objetivo.** Que una persona conecte su Claude o ChatGPT a las herramientas de su empresa (HubSpot, ColdIQ, Places, y lo que se sume) a través de la plataforma, viendo solo las tools que su empresa le permitió, con cada llamada hecha con su propia cuenta cuando el proveedor es OAuth y con el nivel de efecto respetado.

**Modelo Claude Code:** Fable 5.1 o Opus 5 `high` para la spec (auth, credenciales, efectos). Sonnet 5 para implementar sobre la spec.

**Decisiones que la spec tiene que cerrar.**

1. **Dónde vive.** Tercera superficie MCP, `/tools/<slug>/mcp` (o `/mcp/<slug>`), construida como el brain sobre `@modelcontextprotocol/sdk` y el mismo emisor OAuth. `mcpChannel` de eve no sirve: expone solo `agent_*` por diseño.
2. **Cómo ejecuta.** Si reusa las definiciones de `lib/connectors/catalog.ts` (hoy atadas a eve) o llama a los proveedores directo: cliente MCP contra `mcp.hubspot.com` con el token de Vercel Connect del subject `tenant:usuario`, OpenAPI contra ColdIQ y Places con la api-key del tenant. Lo segundo es más simple y no depende de una sesión de eve.
3. **Qué tools se publican.** Por conexión, la allowlist que ya existe (HubSpot solo lectura, ColdIQ operaciones fijas) filtrada por las reglas de acceso de la 22 (`kind = connection`). Nivel de efecto por tool: las de nivel 0 y 1 pasan (1 con presupuesto y `metered()`); las de nivel 2 solo con política `auto` del tenant; las de nivel 3 no se exponen por este canal (dejan pieza pendiente en `/cola` si tiene sentido, o directamente no existen acá).
4. **Credenciales por persona.** Si la persona no autorizó HubSpot, la tool responde con el link de autorización (ya existe `startAuthorizationForSubject`) en vez de fallar.
5. **Uso y límites.** Cada llamada deja asiento en `usage_entries` y respeta un rate limit por persona como el del brain.

**Entregables.**

- [ ] Spec y plan con las cinco decisiones.
- [ ] Endpoint, metadata OAuth en `.well-known`, consentimiento reusado.
- [ ] Reglas de acceso por conexión desde la UI de la 21 (mismo diálogo de compartir del brain, adaptado).
- [ ] Página de la 19 completa: aparece el MCP de herramientas con las tools que esa persona va a ver.
- [ ] Tests de aislamiento entre tenants y entre personas, como los del brain.

**Terminado cuando:** desde su claude.ai, una persona de `innovas` conecta el MCP de herramientas, ve solo las tools de HubSpot de lectura que le dieron, busca un contacto con su propia cuenta de HubSpot, y otra persona sin ese permiso no ve esas tools; cada llamada aparece en `usage_entries`.

## 3. Riesgos del plan

- **La 23 depende de que el modelo de reglas de la 22 salga bien.** Si la 22 resuelve los permisos de agentes con un atajo (una lista de usuarios en `tenant_agents.config`), la 23 lo va a tener que rehacer. Por eso la 22 es la etapa con spec más cuidada.
- **Microsoft trae el problema del correo.** Un cliente solo-Microsoft no puede usar el agente de outreach hasta que haya proveedor Outlook. Hay que decirlo en la reunión comercial y, si ese cliente avanza, agregar la etapa "proveedor Outlook" entre la 20 y la 21.
- **ChatGPT como cliente MCP** tiene reglas propias (tools `search`/`fetch` para deep research, revisión de apps). La 19 lo prueba antes de prometerlo.
- **Costo de verificación en producción.** Las etapas 17 y 18 quedaron abiertas por falta de `.env.local` y login sembrado en los worktrees. La 19 debería dejar un procedimiento repetible para verificar en producción (cuenta de prueba de `tenant_member`, tenant de ensayo) y evitar que se repita.

## 4. Qué se le pide a Mati para arrancar

1. Confirmar el orden, o cambiarlo si hay un cliente esperando algo puntual (por ejemplo Microsoft antes que la página de conexión).
2. Elegir el segundo agente de la 22.
3. Decidir si la frontera plataforma/tenant propuesta en la 21 es la correcta.

Con eso, la Etapa 19 arranca en una sesión nueva con `superpowers:brainstorming`.
