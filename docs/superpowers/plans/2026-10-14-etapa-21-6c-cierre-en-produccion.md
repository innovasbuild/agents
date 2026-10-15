# Etapa 21.6c: cierre en producción del dominio propio por empresa (checklist)

**Fecha:** 2026-10-14
**Spec:** `docs/superpowers/specs/2026-10-14-etapa-21-6-dominio-por-empresa-design.md` (§7)
**Quién lo corre:** una persona con acceso a Vercel (equipo `team_x4c4V764cuicpcg6EkOj7CLG`, proyecto `agents`), a Supabase (proyecto `gxsebhduezvhnqkyxjdh`) y al DNS del dominio del cliente. Un agente no puede: hacen falta credenciales que no tiene y `db push` pide la contraseña de producción.
**Qué cierra:** lo que la 21.6a (PR #105) y la 21.6b (PR #106) dejaron sin verificar contra el mundo real: las dos APIs, `x-forwarded-host` en el canal MCP del agente (spike S1), el login por link mágico y por Google en un dominio propio (S4) y el primer dominio de punta a punta.

Caso de prueba: la empresa `okeefe` con `ai.okeefe.com.ar`. Si tu DNS no es el de okeefe, cambiá el dominio en todo el documento.

> **No pegues tokens en el chat, en un commit ni en la consola de la plataforma.** Los pasos de abajo los leen sin eco (`read -rs`) y los dejan solo en variables de esa terminal.

## 0. Antes de empezar

- [ ] El PR #106 está **mergeado** o lo vas a mergear después del paso 2 (el orden está explicado en el 2.4).
- [ ] Hay una terminal zsh con `vercel` y `npx supabase` andando, parada en el checkout principal (`/Users/mok/Sites/innovas/agents`: tiene el enlace a Vercel y a Supabase; los worktrees no).
  ```bash
  vercel whoami && npx supabase projects list | head -5
  ```
  Esperado: tu usuario de Vercel y el proyecto `gxsebhduezvhnqkyxjdh` en la lista. Si falla: `vercel login` y `npx supabase login`.
- [ ] Sabés **quién administra el DNS de `okeefe.com.ar`** y que esa persona puede crear un `CNAME` hoy.
- [ ] La empresa `okeefe` existe en producción: abrí `https://agentes.innov.as/plataforma` y buscala. Si no está, dala de alta primero ([alta de una empresa](../../guias/alta-de-tenant.md)).

## 1. Migración (antes que el código)

El código del corte a ya puede estar desplegado: con la base sin la función, solo fallarían (503) los hosts de empresa, que todavía no existen, y el host raíz no depende de la base. Aun así se aplica ya.

- [ ] Mirá qué hay pendiente:
  ```bash
  npx supabase migration list
  ```
  Esperado: `20261024120000_tenant_domains` con el remoto vacío. **Si hay otras pendientes que no son tuyas, frená**: `db push` aplica todas y no deja elegir. Nombralas y confirmá con quien las escribió ([migraciones a producción](../../guias/migraciones-a-produccion.md)).
- [ ] Aplicá:
  ```bash
  npx supabase db push
  ```
- [ ] Verificá que local y remoto quedaron iguales: `npx supabase migration list` (ninguna fila con el remoto vacío).
- [ ] Verificá en el SQL Editor de Supabase (proyecto de producción):
  ```sql
  select proname from pg_proc where proname = 'resolve_tenant_by_host';
  select count(*) from public.tenant_domains;
  ```
  Esperado: una fila y `0`.

## 2. Credenciales y variables de entorno

### 2.1 Tokens

- [ ] **Vercel:** vercel.com → Account Settings → Tokens → crear uno con alcance al equipo `team_x4c4V764cuicpcg6EkOj7CLG` y un vencimiento razonable. Anotá dónde lo vas a renovar.
- [ ] **Supabase:** supabase.com/dashboard/account/tokens → crear un token personal (`sbp_…`). Si usás uno de permisos finos, necesita `auth_config_write` y `project_admin_write`.
- [ ] Cargalos en tu terminal sin eco ni historial:
  ```bash
  read -rs "VERCEL_API_TOKEN?Token de Vercel: " && echo && export VERCEL_API_TOKEN
  read -rs "SUPABASE_ACCESS_TOKEN?Token de Supabase: " && echo && export SUPABASE_ACCESS_TOKEN
  export VERCEL_PROJECT_ID=prj_ML1hB7sY37RRKn14FxUCSRWofH69
  export VERCEL_TEAM_ID=team_x4c4V764cuicpcg6EkOj7CLG
  export SUPABASE_PROJECT_REF=gxsebhduezvhnqkyxjdh
  ```
  Los IDs salen de `.vercel/project.json` y de `supabase/.temp/project-ref`; no son secretos.

### 2.2 Probar la API de Vercel (solo lectura)

- [ ] ```bash
  curl -s -H "Authorization: Bearer $VERCEL_API_TOKEN" \
    "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID/domains?teamId=$VERCEL_TEAM_ID" \
    | jq '[.domains[]? | {name, verified}]'
  ```
  Esperado: la lista de dominios del proyecto (por lo menos `agentes.innov.as`). Un `{"error": …}` con `forbidden` o `invalid_token` significa que el token no tiene alcance al equipo: creá otro.
- [ ] **Límite de dominios:** en el dashboard del proyecto → Settings → Domains, o en la documentación de tu plan, confirmá cuántos dominios admite el proyecto. Cada empresa con dominio propio consume uno.

### 2.3 Probar la Management API de Supabase (spike S3)

La documentación no dice cómo separa las entradas `uri_allow_list` ni si el `PATCH` reemplaza el valor entero. El adaptador asume **coma** y **reemplazo**, y si no se cumple el dominio no se activa. Hay que confirmarlo.

**Lo mejor es hacerlo en un proyecto de Supabase que no sea el de producción.** Si no tenés uno, la variante de abajo es reversible y deja respaldo.

- [ ] Respaldá la configuración actual (solo los dos campos):
  ```bash
  curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
    | jq '{site_url, uri_allow_list}' > ~/uri_allow_list.backup.json
  cat ~/uri_allow_list.backup.json
  ```
  Esperado: `site_url` es `https://agentes.innov.as` y `uri_allow_list` es un texto con las URLs separadas por coma. **Guardá este archivo hasta terminar.**
- [ ] Sumá una entrada inofensiva (un dominio inválido que no abre nada):
  ```bash
  CURRENT=$(jq -r .uri_allow_list ~/uri_allow_list.backup.json)
  curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'content-type: application/json' \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
    -d "$(jq -n --arg v "$CURRENT,https://zz-prueba.invalid/auth/callback**" '{uri_allow_list: $v}')"
  ```
  Esperado: `200`. Si `CURRENT` está vacío el valor empieza con coma: borrá esa coma a mano.
- [ ] Leé de nuevo:
  ```bash
  curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
    | jq '{site_url, uri_allow_list}'
  ```
  Esperado: `site_url` sin cambios y `uri_allow_list` con **todas las entradas de antes más `zz-prueba`**. Eso confirma coma y que el campo se guarda tal cual lo mandaste.
- [ ] **Restauralo**, siempre:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'content-type: application/json' \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
    -d "$(jq -n --arg v "$CURRENT" '{uri_allow_list: $v}')"
  ```
  y repetí la lectura: tiene que ser idéntica al respaldo.
- [ ] Anotá el resultado en el §6 de la spec (S3). Si el `PATCH` **no** reemplaza el valor (lo fusiona) o no separa por coma, **no sigas**: el adaptador `lib/domains/supabase-auth.ts` hay que ajustarlo antes de activar un dominio.

### 2.4 Cargar las variables en Vercel (Production)

- [ ] ```bash
  printf %s "$VERCEL_API_TOKEN"      | vercel env add VERCEL_API_TOKEN production
  printf %s "$VERCEL_PROJECT_ID"     | vercel env add VERCEL_PROJECT_ID production
  printf %s "$VERCEL_TEAM_ID"        | vercel env add VERCEL_TEAM_ID production
  printf %s "$SUPABASE_ACCESS_TOKEN" | vercel env add SUPABASE_ACCESS_TOKEN production
  printf %s "$SUPABASE_PROJECT_REF"  | vercel env add SUPABASE_PROJECT_REF production
  ```
  Si tu versión del CLI ofrece `--sensitive`, usalo en los dos tokens (`vercel env add --help`). Solo **Production**: en Preview un valor fijo no tiene sentido y los dominios reales no se tocan desde un preview.
- [ ] Verificá que están (sin ver los valores):
  ```bash
  vercel env ls production | grep -E "VERCEL_API_TOKEN|VERCEL_PROJECT_ID|VERCEL_TEAM_ID|SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF"
  ```
- [ ] **Orden con el PR #106:** una variable nueva solo la ve un deploy nuevo. Si el #106 todavía no está mergeado, mergealo ahora: el deploy de `main` ya las toma. Si ya estaba mergeado, redeployá a mano (Deployments → el último de producción → Redeploy). Esperá a que termine.
- [ ] Limpiá tu terminal: `unset VERCEL_API_TOKEN SUPABASE_ACCESS_TOKEN` (las dejás hasta el final solo si las necesitás para el rollback).

## 3. Cargar el dominio

- [ ] Entrá a `https://agentes.innov.as/plataforma/okeefe` como administrador de plataforma. En la sección **Dominio** **no** tiene que aparecer el aviso rojo "Falta configurar en el servidor". Si aparece, una variable no llegó al deploy: volvé al 2.4.
- [ ] Escribí `ai.okeefe.com.ar` y "Agregar dominio". Esperado: queda **Esperando el DNS** y debajo aparece el registro que tiene que crear el cliente (un `CNAME` con el valor que devuelve Vercel y, si el dominio estaba en otra cuenta de Vercel, un `TXT`).
  - "Ese dominio ya está en otro proyecto de Vercel": está en otro proyecto o cuenta; hay que quitarlo de ahí o verificar la propiedad con el `TXT`.
  - "Vercel rechazó el token": el token no tiene alcance al equipo.
- [ ] Pasale el registro a quien administra el DNS con el texto de la [guía del dominio de un cliente](../../guias/dominio-de-un-cliente.md#qué-decirle-al-cliente).
- [ ] Cuando lo creen, comprobalo vos:
  ```bash
  dig +short CNAME ai.okeefe.com.ar
  ```
  Esperado: el valor que mostró la consola.
- [ ] Esperá hasta 10 minutos (el barrido `domain-sweep`) o apretá **Verificar ahora**. Esperado: **Activo** y **Principal**. Si queda en "Esperando el DNS" mirá el motivo que muestra debajo (DNS sin propagar, `TXT` faltante o "No pude registrar el dominio en Supabase Auth").
- [ ] En Vercel → proyecto → Settings → Domains, `ai.okeefe.com.ar` figura con **Valid Configuration**. En Supabase → Authentication → URL Configuration, la lista tiene `https://ai.okeefe.com.ar/auth/callback**` y sigue teniendo las entradas de antes y la Site URL `https://agentes.innov.as`.

## 4. Verificación de punta a punta

### 4.1 Con `curl` (sin sesión)

- [ ] **Login y redirección a la URL limpia**
  ```bash
  curl -s -o /dev/null -w "login: %{http_code}\n" https://ai.okeefe.com.ar/login
  curl -si https://ai.okeefe.com.ar/okeefe/chat | grep -iE "^HTTP|^location"
  ```
  Esperado: `200`, y `308` con `location: /chat`. Si el certificado todavía no está, `curl` falla con un error de TLS: esperá unos minutos.
- [ ] **No se sirve lo que no es de la empresa**
  ```bash
  for p in /plataforma /oauth/consent /brain/okeefe/mcp; do
    curl -s -o /dev/null -w "$p: %{http_code}\n" https://ai.okeefe.com.ar$p
  done
  ```
  Esperado: `404` en los tres.
- [ ] **MCP del brain** (S1/S4 del brain)
  ```bash
  curl -si -X POST https://ai.okeefe.com.ar/brain/mcp -H 'content-type: application/json' -d '{}' | grep -iE "^HTTP|www-authenticate"
  curl -s https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/brain/mcp
  ```
  Esperado: `401` con `resource_metadata="https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/brain/mcp"`, y un JSON con `"resource":"https://ai.okeefe.com.ar/brain/mcp"`.
- [ ] **MCP del agente: este es el spike S1** (que `x-forwarded-host` llegue al canal de eve en Vercel)
  ```bash
  curl -si -X POST https://ai.okeefe.com.ar/eve/outreach/v1/mcp \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"prueba","version":"1"}}}' \
    | grep -iE "^HTTP|www-authenticate"
  ```
  Esperado: `401` con `resource_metadata="https://ai.okeefe.com.ar/.well-known/oauth-protected-resource/eve/outreach/v1/mcp"`. **Si dice `https://agentes.innov.as/…`, `x-forwarded-host` no llega** y el desafío cae al origen fijo: hay que pasar a buscar el host por otro header en `mcpChallenge` (`lib/agents/mcp-channel-auth.ts`) antes de dar por cerrado el agente. El resto del dominio anda igual.
- [ ] **Regresión en el host raíz**
  ```bash
  curl -s -o /dev/null -w "raíz login: %{http_code}\n" https://agentes.innov.as/login
  curl -si -X POST https://agentes.innov.as/brain/okeefe/mcp -H 'content-type: application/json' -d '{}' | grep -iE "^HTTP|www-authenticate"
  curl -s https://agentes.innov.as/.well-known/oauth-protected-resource/brain/okeefe/mcp
  ```
  Esperado: `200`; `401` con `resource_metadata` en `agentes.innov.as` y la forma con slug; y `"resource":"https://agentes.innov.as/brain/okeefe/mcp"`.
- [ ] **Un host inventado no se refleja**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: evil.example' https://agentes.innov.as/login
  ```
  Esperado: `404` (Vercel puede responder otra cosa si no deja pasar un `Host` ajeno; lo que **no** puede pasar es un `200` que muestre contenido o un origen `evil.example` en alguna respuesta).

### 4.2 En el navegador

Usá una ventana privada para no mezclar sesiones.

- [ ] **Login por código** en `https://ai.okeefe.com.ar/login`: pedí el código, entrá y aterrizás en `https://ai.okeefe.com.ar/chat` (URL limpia).
- [ ] **Login por link mágico: spike S4.** Cerrá sesión, pedí el código de nuevo y, en el mail, **usá el link** en vez del código. Mirá el link antes de abrirlo: el `redirect_to` tiene que ser `https://ai.okeefe.com.ar/auth/callback…`. Esperado: entrás y aterrizás en el dominio de la empresa. Si el `redirect_to` es `https://agentes.innov.as` y el login falla, el dominio no está en las Redirect URLs de Supabase: revisá el paso 3 (última viñeta).
- [ ] **Login con Google** (si la empresa lo tiene como método): "Entrar con Google" tiene que devolverte a `https://ai.okeefe.com.ar/…` con la sesión abierta, no a `agentes.innov.as`.
- [ ] **Navegación**: hacé clic en el menú (Brain, Conectar, Métricas…). La barra de direcciones tiene que quedar sin `/okeefe/` y la página no se recarga entera.
- [ ] **`/conectar`** muestra `https://ai.okeefe.com.ar/brain/mcp` y `https://ai.okeefe.com.ar/eve/outreach/v1/mcp` (sin `?tenant=`).
- [ ] **Conexión real de Claude al brain:**
  ```bash
  claude mcp add --transport http okeefe-brain https://ai.okeefe.com.ar/brain/mcp
  ```
  En Claude Code: `/mcp` → `okeefe-brain` → autenticar. Esperado: se abre el navegador, la pantalla de consentimiento aparece en `agentes.innov.as/oauth/consent` (**esto es lo esperado y aceptado**, spec §4.7), aprobás y la herramienta lista las tools del brain. Anotá en qué host aterrizó el consentimiento.
- [ ] **Conexión del agente** con el comando de `/conectar` (`outreach-okeefe`). Esperado: autentica y lista sus tools. Si el 4.1 del agente dio el origen fijo, acá falla el descubrimiento.
- [ ] **Invitación:** desde `https://agentes.innov.as/plataforma/okeefe` (host raíz) invitá un correo de prueba, o reenviá una invitación desde `/okeefe/settings/usuarios`. El link del mail tiene que apuntar a `https://ai.okeefe.com.ar/auth/callback?…`.
- [ ] **Aislamiento de sesión:** estando logueado en `ai.okeefe.com.ar`, abrí `https://agentes.innov.as/okeefe/chat` en la misma ventana: pide login (la sesión es por host, es lo esperado).
- [ ] **Settings del cliente** (`/settings`) muestra "Tu dominio: ai.okeefe.com.ar (Activo, principal)".

## 5. Si algo sale mal

| Situación | Qué hacer |
|---|---|
| El dominio no sirve y hay que apagarlo ya | En la consola, **Quitar** el dominio (lo saca de Vercel, de la base y de las Redirect URLs). La empresa vuelve a entrar por `agentes.innov.as/okeefe`, que nunca dejó de andar |
| Quitar falla porque Vercel no responde | La fila no se borra a propósito. Reintentá; si Vercel sigue caído, sacá el dominio en Vercel (Settings → Domains) y después reintentá en la consola |
| El `PATCH` de Supabase dejó la lista mal | Restaurá con el respaldo `~/uri_allow_list.backup.json` (paso 2.3, último bloque) |
| Hay que desactivar la función en toda la plataforma | Sacar las cinco variables de Vercel (`vercel env rm <NOMBRE> production`) y redeployar: la consola avisa y no deja cargar dominios; los ya activos siguen sirviendo (no dependen de las variables) |
| Un token se filtró | Revocalo en Vercel o en Supabase, creá otro y recargalo (2.1 y 2.4) |

Nada de esto exige revertir la migración: la tabla vacía no tiene efecto.

## 6. Registro de resultados

Copiá esta tabla al cerrar y completala (va a la spec, §6, y al roadmap).

| Verificación | Resultado | Fecha | Quién |
|---|---|---|---|
| Migración `20261024120000_tenant_domains` aplicada | OK: figura en local y remoto; `db push` dice que está al día | 2026-10-15 | Mati |
| API de Vercel con el token (lista de dominios) | OK: el alta devolvió el `CNAME` y el `TXT` de verificación | 2026-10-15 | Claude (consola) |
| Límite de dominios del plan | Sin verificar | | |
| S3: `PATCH` de `uri_allow_list` (coma y reemplazo) | OK: conserva y agrega (las 4 `https://` anotadas siguen; quedaron 8 con la nueva); Site URL intacta. Sin prueba aislada previa | 2026-10-15 | Claude (dashboard) |
| Dominio activo desde la consola (tiempo desde el `CNAME`) | OK: **Activo** y **Principal** por el barrido, sin apretar Verificar. Tiempo exacto no medido | 2026-10-15 | Claude |
| S1: `x-forwarded-host` llega al canal MCP del agente | OK: el 401 apunta a `ai.okeefe.com.ar` | 2026-10-15 | Claude (`curl`) |
| S4: login por link mágico en el dominio propio | Sin verificar: la landing de okeefe solo ofrece Google | | |
| S4: login con Google en el dominio propio | OK | 2026-10-15 | Mati |
| Conexión real de Claude al brain y al agente | OK: la conexión de Claude funciona (metadata del brain con `resource` en `ai.okeefe.com.ar`); el agente de outreach solo se probó hasta el 401 | 2026-10-15 | Mati |
| Dónde aterriza el consentimiento OAuth | No registrado (decisión A1: en el host raíz) | | |
| Link de invitación con el dominio de la empresa | Sin verificar | | |
| Regresión en el host raíz | OK: `agentes.innov.as/login/okeefe` responde 200 y `/okeefe/chat` pide sesión como antes. Sin recorrer un flujo completo | 2026-10-15 | Claude (`curl`) |

## 7. Cierre de la etapa

- [ ] Los resultados del §6 están anotados en la spec (§6, spikes S1, S3 y S4) y las limitaciones nuevas, si aparecieron.
- [ ] El roadmap (21.6) pasa a `[x]` con lo verificado y lo que quedó sin verificar.
- [ ] La fila de la 21.6 en `docs/decisiones/README.md` pasa de "en curso" a "cerrada" y nombra sus páginas de la wiki: [Tenancy](../../arquitectura/tenancy.md), [Identidad y acceso](../../arquitectura/identidad-y-acceso.md), [Entornos y deploy](../../arquitectura/entornos-y-deploy.md), [Plataforma y settings por empresa](../../dominios/plataforma.md) y la guía [Dominio propio de un cliente](../../guias/dominio-de-un-cliente.md).
- [ ] `/docs-wiki` y `npm run docs:check` en verde.
- [ ] `/ship` para el bump de `VERSION` y el `CHANGELOG`.
- [ ] Borrá el respaldo `~/uri_allow_list.backup.json` y los tokens que ya no uses (`unset` en la terminal y revocalos si fueron de un solo uso).
