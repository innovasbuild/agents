# Etapa 0 · Bootstrap y spike de riesgo — Plan de implementación

> **Para quien ejecute este plan:** SUB-SKILL REQUERIDA: usá `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos usan checkbox (`- [ ]`) para tracking.

**Objetivo:** probar que eve corre dentro de Next.js 15 en Vercel, autentica con Supabase, pausa una sesión durable esperando aprobación humana, y manda un mail real desde la casilla de Gmail del usuario.

**Arquitectura:** una sola app Next.js sirve el dashboard y hospeda el agente `outreach` vía `withEve`. La sesión de Supabase en cookie se convierte en el principal de eve en el auth walk del canal. La tool `send_email` lleva `approval: always()`, así que la sesión parkea en `session.waiting` hasta que el chat la resuelve; recién entonces el server resuelve el token de Gmail desde una tabla que el modelo nunca ve.

**Stack:** Next.js 15 (App Router) · eve 0.54.2 · Supabase (Postgres + Auth) · Vercel AI Gateway · Biome · Vitest · Node 24.

**Spec:** `docs/superpowers/specs/00-bootstrap.md` — leela completa antes de empezar. Este plan argumenta desde ahí.

## Restricciones globales

Aplican a todas las tareas, no se repiten en cada una:

- **Node >= 24**, declarado en `engines` con `engine-strict=true` en `.npmrc` y `.nvmrc` con `24`.
- **`eve` pinneado en `0.54.2` exacto**, sin caret. Cualquier `npm install` que lo vuelva a poner con `^` hay que corregirlo.
- **Antes de escribir cualquier código de eve**, leer el archivo correspondiente de `node_modules/eve/docs/`. eve está en beta: la doc local manda sobre este plan y sobre cualquier recuerdo.
- **Ninguna tool recibe credenciales por `inputSchema`.** Toda credencial se resuelve del lado server a partir del `principalId` de la sesión.
- **`agents/` se organiza por capacidad, `tenants/` por cliente.** Nunca crear `agents/<cliente>/`.
- **Imports desde `agents/` hacia `lib/` van relativos**, no con el alias `@/`: eve compila el agente con su propio build.
- **Español rioplatense** en UI y textos; **inglés** en identificadores y nombres de archivo.
- **Commits:** prefijo `feat:` / `chore:` / `test:` / `fix:`. Cada sesión agrega su propia línea de atribución según su modelo — no está cableada en este plan.
- **Supabase se usa contra el proyecto cloud**, no con el stack local de Docker. El stack local y los tests pgTAP entran en la Etapa 1, cuando haya RLS multi-tenant que valga la pena testear en aislamiento. Un solo entorno en esta etapa reduce variables del spike.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `next.config.ts` | Monta el agente en la app con `withEve` |
| `.nvmrc` · `.npmrc` · `biome.json` · `vitest.config.ts` | Harness |
| `CLAUDE.md` · `.claude/settings.json` · `.claude/launch.json` · `.claude/hooks/check-gstack.sh` | Harness de Claude Code (contenido en kickoff §7) |
| `lib/supabase/server.ts` | Cliente Supabase server-side con cookies (`@supabase/ssr`) |
| `lib/supabase/browser.ts` | Cliente Supabase para el browser |
| `lib/supabase/admin.ts` | Cliente con `service_role`. **Nunca** importado desde código de cliente |
| `lib/auth/verify-caller.ts` | `verifyCaller(request)`: sesión Supabase → `{ userId, email }` o `null` |
| `lib/gmail/mime.ts` | `buildRawMessage()`: MIME en base64url. Puro, testeado |
| `lib/gmail/send.ts` | `getAccessToken()` y `sendMail()`. Server only, usa `service_role` |
| `supabase/migrations/<ts>_google_tokens.sql` | Tabla del refresh token, RLS sin políticas |
| `app/(auth)/login/page.tsx` | Botón de login con scopes de Gmail |
| `app/auth/callback/route.ts` | `exchangeCodeForSession` + upsert del refresh token |
| `app/chat/page.tsx` | Chat mínimo con `useEveAgent` y UI de aprobación |
| `agents/outreach/agent.ts` | `defineAgent({ model })` |
| `agents/outreach/instructions.md` | Instrucciones mínimas del spike |
| `agents/outreach/channels/eve.ts` | Auth walk: Supabase + `localDev()` condicionado |
| `agents/outreach/tools/send_email.ts` | Tool con `approval: always()` |
| `tests/gmail/mime.test.ts` | TDD de `buildRawMessage` |
| `tests/auth/verify-caller.test.ts` | `verifyCaller` falla cerrado |
| `tests/channel/auth.test.ts` | La ruta del canal rechaza sin cookie |

---

## Task 1: Accesos externos

No hay código en esta tarea, y bloquea todas las demás. Las Tasks 2 y 3 pueden avanzar en paralelo mientras Google aprueba pantallas.

**Files:**
- Create: `.env.local` (no se commitea)

**Interfaces:**
- Produces: `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `AI_GATEWAY_API_KEY`.

- [ ] **Step 1: Crear el proyecto de Google Cloud y el client OAuth**

En la consola de Google Cloud: proyecto nuevo, habilitar la **Gmail API**, y crear credenciales OAuth 2.0 de tipo **Web application**. En la pantalla de consentimiento, modo **testing**, agregando tu casilla como test user. Scopes a declarar: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`.

El **redirect URI autorizado** es el callback de Supabase, que se conoce recién en el Step 2: `https://<project-ref>.supabase.co/auth/v1/callback`. Si hacés este step primero, volvé a agregarlo después.

- [ ] **Step 2: Crear el proyecto Supabase y configurar el provider Google**

Proyecto nuevo llamado `innovas-agents`. En Authentication → Providers → Google, pegar el client ID y el client secret del step anterior. Copiar el project ref, la URL, la anon key y la service role key.

- [ ] **Step 3: Crear el proyecto en Vercel y linkearlo**

```bash
npm i -g vercel@latest
vercel link
```

Conectar Supabase desde el Marketplace de Vercel al proyecto, así las variables bajan solas.

- [ ] **Step 4: Bajar las variables y verificar**

```bash
vercel env pull .env.local
```

Verificar que estén las seis variables. `GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_CLIENT_SECRET` hay que agregarlas a mano (en `.env.local` y en el proyecto de Vercel con `vercel env add`), porque no vienen del Marketplace.

Esperado: `grep -c '=' .env.local` devuelve al menos 6, y ninguna variable con valor vacío.

- [ ] **Step 5: Confirmar Node**

```bash
node -v
```

Esperado: `v24.x` o superior. Si no, `nvm install 24 && nvm use 24`.

---

## Task 2: Scaffold de Next.js y harness

**Files:**
- Create: `package.json`, `next.config.ts` (base), `.nvmrc`, `.npmrc`, `biome.json`, `vitest.config.ts`, `CLAUDE.md`, `.claude/settings.json`, `.claude/launch.json`, `.claude/hooks/check-gstack.sh`, `.gitignore`
- Create: `app/` (scaffold)

**Interfaces:**
- Produces: `npm run dev`, `npm run typecheck`, `npm test`, `npm run lint:fix` funcionando. Alias `@/*` resolviendo a la raíz.

- [ ] **Step 1: Scaffold**

El repo ya tiene `.git` y `docs/`, así que `create-next-app` puede rechazarlo por no estar vacío.

```bash
npx create-next-app@latest . --ts --app --tailwind --no-eslint --src-dir=false --import-alias "@/*" --use-npm
```

Si rechaza el directorio: scaffoldear aparte y mover, preservando `docs/` y `.git`.

```bash
npx create-next-app@latest /tmp/innovas-scaffold --ts --app --tailwind --no-eslint --src-dir=false --import-alias "@/*" --use-npm
rsync -a --exclude=.git /tmp/innovas-scaffold/ .
rm -rf /tmp/innovas-scaffold
```

- [ ] **Step 2: Fijar la versión de Node**

```bash
echo "24" > .nvmrc
echo "engine-strict=true" > .npmrc
```

Y en `package.json`, agregar:

```json
"engines": { "node": ">=24" }
```

- [ ] **Step 3: Instalar el harness de calidad**

```bash
npm install -D @biomejs/biome vitest
npx @biomejs/biome init
```

- [ ] **Step 4: Configurar Vitest**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 5: Agregar los scripts**

En `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "lint:fix": "biome check --write ."
}
```

- [ ] **Step 6: Copiar el harness de Claude Code**

Crear `CLAUDE.md`, `.claude/settings.json`, `.claude/launch.json` y `.claude/hooks/check-gstack.sh` con el contenido exacto del kickoff §7. Hacer ejecutable el hook:

```bash
chmod +x .claude/hooks/check-gstack.sh
```

- [ ] **Step 7: Verificar que el harness corre**

```bash
npm run typecheck && npm test && npm run dev
```

Esperado: typecheck sin errores; vitest dice "No test files found" (todavía no hay tests, y eso está bien); `npm run dev` levanta en `localhost:3000`. Cortar el dev server.

- [ ] **Step 8: Confirmar que `.env.local` está ignorado**

```bash
git check-ignore -v .env.local
```

Esperado: una línea señalando la regla de `.gitignore` que lo cubre. Si no devuelve nada, agregar `.env.local` a `.gitignore` **antes** de commitear.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js 15 con harness de calidad"
```

---

## Task 3: eve montado en Next.js

**Files:**
- Create: `agents/outreach/agent.ts`, `agents/outreach/instructions.md`
- Modify: `next.config.ts`, `package.json`

**Interfaces:**
- Consumes: el scaffold de la Task 2.
- Produces: el agente `outreach` respondiendo en `/eve/agents/outreach/eve/v1/*`.

- [ ] **Step 1: Scaffoldear el agente**

```bash
npx eve@0.54.2 init . --model anthropic/claude-sonnet-5
```

Genera `agent/` **en singular**, con `instructions.md`, y `evals/` al lado. Agrega también `ai` y `zod` como dependencias.

- [ ] **Step 2: Mover a la estructura del repo**

```bash
mkdir -p agents
mv agent agents/outreach
```

- [ ] **Step 3: Pinnear eve exacto**

`eve init` puede haber dejado un caret en `package.json`.

```bash
npm install eve@0.54.2 --save-exact
grep '"eve"' package.json
```

Esperado: `"eve": "0.54.2"`, sin `^` ni `~`.

- [ ] **Step 4: Leer la doc local antes de tocar la config**

```bash
cat node_modules/eve/docs/README.md
cat node_modules/eve/docs/guides/frontend/nextjs.mdx
```

Confirmar la firma de `withEve` y la forma del mapeo de agentes. Si difiere de lo que sigue, **manda la doc local** y hay que anotar la diferencia en la spec.

- [ ] **Step 5: Montar el agente en Next**

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

export default withEve(nextConfig, {
  agents: { outreach: "./agents/outreach" },
});
```

- [ ] **Step 6: Declarar el modelo del agente**

```ts
// agents/outreach/agent.ts
import { defineAgent } from "eve";

export default defineAgent({ model: "anthropic/claude-sonnet-5" });
```

`model` es obligatorio cuando el archivo existe. En la Etapa 1 pasa a `defineDynamic`.

- [ ] **Step 7: Instrucciones mínimas del spike**

`agents/outreach/instructions.md`, en español rioplatense, corto: el agente ayuda a mandar mails desde la casilla del usuario, siempre pasando por aprobación, y no inventa direcciones de destino.

- [ ] **Step 8: Verificar el health**

```bash
npm run dev
```

En otra terminal:

```bash
curl -s localhost:3000/eve/agents/outreach/eve/v1/health
```

Esperado: `{"ok":true,"status":"ready","workflowId":"..."}`.

**No corras `npx eve dev` aparte:** `npm run dev` ya bootea el dev server de eve y reescribe las rutas hacia él. Levantarlo a mano choca de puertos.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: montar el agente outreach en next con withEve"
```

---

## Task 4: Tabla del refresh token de Google

**Files:**
- Create: `supabase/migrations/<timestamp>_google_tokens.sql`, `lib/supabase/admin.ts`

**Interfaces:**
- Produces: tabla `public.google_tokens` inalcanzable salvo por `service_role`; `createAdminClient()` para usarla.

- [ ] **Step 1: Cargar las buenas prácticas de Postgres**

Antes de escribir SQL, cargar el skill `supabase:supabase-postgres-best-practices`. Es regla del repo.

- [ ] **Step 2: Inicializar y linkear Supabase**

```bash
npx supabase init
npx supabase link --project-ref <project-ref>
```

- [ ] **Step 3: Crear la migración**

```bash
npx supabase migration new google_tokens
```

Contenido:

```sql
create table public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  scope text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on table public.google_tokens from anon, authenticated;
```

RLS habilitada **sin políticas**: nadie pasa. `service_role` bypassea RLS y es el único camino. El `revoke` es defensa en profundidad.

- [ ] **Step 4: Aplicar la migración**

```bash
npx supabase db push
```

- [ ] **Step 5: Verificar que la tabla es inalcanzable con la anon key**

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/google_tokens?select=user_id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Esperado: un error de permisos, **no** una lista vacía `[]`. Una lista vacía significaría que la tabla es legible y la protección no quedó puesta.

- [ ] **Step 6: Cliente admin**

```ts
// lib/supabase/admin.ts
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

Este módulo **nunca** se importa desde un componente de cliente. Si aparece en un bundle del browser, la service key queda expuesta.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: tabla google_tokens con acceso solo por service_role"
```

---

## Task 5: Login con Google y persistencia del refresh token

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createAdminClient()` de la Task 4.
- Produces: sesión de Supabase en cookie, y una fila en `google_tokens` para el usuario logueado.

- [ ] **Step 1: Instalar los clientes de Supabase**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Clientes server y browser**

Dos módulos, con estos nombres exactos porque los usan las tareas siguientes:

- `lib/supabase/server.ts` exporta **`createServerSupabase()`**, armado con `createServerClient` de `@supabase/ssr`, leyendo y escribiendo cookies vía `cookies()` de `next/headers`. Sirve para Server Components y Route Handlers.
- `lib/supabase/browser.ts` exporta **`createBrowserSupabase()`**, armado con `createBrowserClient`.

Ambos usan `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 3: Pantalla de login**

```tsx
// app/(auth)/login/page.tsx  → la ruta es /login: (auth) es route group y no aparece en la URL
"use client";

import { createBrowserSupabase } from "@/lib/supabase/browser";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export default function LoginPage() {
  const supabase = createBrowserSupabase();

  async function entrar() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: SCOPES,
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main>
      <h1>INNOV.AS Agents</h1>
      <button type="button" onClick={entrar}>Entrar con Google</button>
    </main>
  );
}
```

`access_type: offline` **y** `prompt: consent` son los dos necesarios para que Google devuelva refresh token.

- [ ] **Step 4: Callback que persiste el refresh token**

`app/auth/callback/route.ts`: toma el `code` del query string, llama `exchangeCodeForSession(code)`, y si la sesión trae `provider_refresh_token`, lo upsertea en `google_tokens` con el cliente admin. Después redirige a `/chat`.

Dos reglas que importan: si en un login Google **no** devuelve refresh token (pasa cuando el usuario ya consintió antes), **no** sobreescribir el guardado con `null`; y si `exchangeCodeForSession` falla, redirigir a `/login` con un mensaje, sin tocar la tabla.

- [ ] **Step 5: Probar el login de punta a punta**

```bash
npm run dev
```

Entrar a `localhost:3000/login`, loguearse con la casilla que cargaste como test user. Verificar que la pantalla de consentimiento de Google pide los permisos de Gmail.

- [ ] **Step 6: Verificar la fila**

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/google_tokens?select=user_id,scope,updated_at" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Esperado: una fila, con `scope` incluyendo `gmail.send`. **No** imprimir el `refresh_token` en la terminal.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: login con google y persistencia del refresh token"
```

---

## Task 6: Auth del canal de eve

**Files:**
- Create: `lib/auth/verify-caller.ts`, `agents/outreach/channels/eve.ts`, `tests/auth/verify-caller.test.ts`, `tests/channel/auth.test.ts`

**Interfaces:**
- Consumes: `lib/supabase/server.ts` de la Task 5.
- Produces: `verifyCaller(request: Request): Promise<{ userId: string; email: string } | null>`, y el canal con el auth walk. La sesión queda con `principalId = userId`, `principalType = "user"`, `attributes = { email }`.

- [ ] **Step 1: Leer la doc local de auth**

```bash
cat node_modules/eve/docs/guides/auth-and-route-protection.md
cat node_modules/eve/docs/patterns/multi-tenant-auth.md
```

Confirmar la forma de `AuthFn` y de `SessionAuthContext`. La doc local manda.

- [ ] **Step 2: Escribir el test de `verifyCaller` (falla cerrado)**

```ts
// tests/auth/verify-caller.test.ts
import { describe, expect, it } from "vitest";
import { verifyCaller } from "../../lib/auth/verify-caller";

describe("verifyCaller", () => {
  it("devuelve null cuando el request no trae cookies", async () => {
    const caller = await verifyCaller(new Request("https://app.test/eve/v1/info"));
    expect(caller).toBeNull();
  });

  it("devuelve null cuando la cookie de sesión es inválida", async () => {
    const request = new Request("https://app.test/eve/v1/info", {
      headers: { cookie: "sb-access-token=basura" },
    });
    expect(await verifyCaller(request)).toBeNull();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

```bash
npm test -- tests/auth/verify-caller.test.ts
```

Esperado: FALLA porque `lib/auth/verify-caller.ts` no existe.

- [ ] **Step 4: Implementar `verifyCaller`**

Parsea el header `cookie` del `Request` que recibe, arma un cliente con `createServerClient` de `@supabase/ssr` alimentado por esas cookies, llama `getUser()`, y devuelve `{ userId, email }` o `null`.

Dos cosas que importan acá:

- **No uses `createServerSupabase()` ni `cookies()` de `next/headers`.** Esta función corre en el contexto del canal de eve, con un `Request` crudo, fuera del scope de request de Next: `cookies()` ahí tira o devuelve vacío. El cliente se arma a mano desde el header.
- **Devolver `null`, no tirar.** Es lo que hace avanzar el auth walk de eve al siguiente autenticador; una excepción rechaza el request de una y saltea `localDev()` en desarrollo.

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
npm test -- tests/auth/verify-caller.test.ts
```

Esperado: PASA.

- [ ] **Step 6: Escribir el canal**

```ts
// agents/outreach/channels/eve.ts
import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { verifyCaller } from "../../../lib/auth/verify-caller";

function supabaseAuth(): AuthFn<Request> {
  return async (request) => {
    const caller = await verifyCaller(request);
    if (caller === null) return null;
    return {
      authenticator: "app",
      issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      principalId: caller.userId,
      principalType: "user",
      subject: caller.userId,
      attributes: { email: caller.email },
    };
  };
}

export default eveChannel({
  auth: process.env.VERCEL_ENV ? [supabaseAuth()] : [supabaseAuth(), localDev()],
});
```

`localDev()` acepta a cualquiera, así que no puede existir en un deploy: `VERCEL_ENV` está definida en todos los entornos de Vercel y no en local. `principalType: "user"` es requisito de `connect()` en la Etapa 2.

- [ ] **Step 7: Test de que la ruta rechaza sin cookie**

```ts
// tests/channel/auth.test.ts
import { describe, expect, it } from "vitest";

const BASE = process.env.SPIKE_BASE_URL ?? "http://localhost:3000";

describe("canal eve", () => {
  it("rechaza a un caller sin sesión", async () => {
    const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/info`);
    expect([401, 403]).toContain(res.status);
  });

  it("deja pasar el health, que es público por diseño", async () => {
    const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/health`);
    expect(res.status).toBe(200);
  });
});
```

Apunta a `/info`, **no** a `/health`: health saltea el auth walk, así que testearlo no probaría nada sobre la protección. `SPIKE_BASE_URL` permite correr el mismo test contra el preview en la Task 10.

- [ ] **Step 8: Correr el test contra el server local**

Con `npm run dev` levantado:

```bash
npm test -- tests/channel/auth.test.ts
```

Esperado: ambos casos pasan. Ojo que en local `localDev()` está activo; si el primer caso pasa igual, es porque `localDev()` no autentica requests sin credenciales, que es lo esperado. Si **falla** en local, dejalo documentado y verificá que en la Task 10 pase contra el preview, que es donde importa.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: auth del canal de eve con sesión de supabase"
```

---

## Task 7: Armado del MIME (TDD)

La única lógica pura de la etapa, y donde más fácil se cuelan bugs silenciosos.

**Files:**
- Create: `lib/gmail/mime.ts`, `tests/gmail/mime.test.ts`

**Interfaces:**
- Produces: `buildRawMessage(input: { to: string; subject: string; body: string }): string` — el MIME codificado en base64url, listo para el campo `raw` de la API de Gmail.

- [ ] **Step 1: Escribir los tests**

```ts
// tests/gmail/mime.test.ts
import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../../lib/gmail/mime";

const decodeMime = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const decodeBody = (raw: string) => {
  const [, body] = decodeMime(raw).split("\r\n\r\n");
  return Buffer.from(body, "base64").toString("utf8");
};

describe("buildRawMessage", () => {
  it("incluye los headers mínimos", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Hola", body: "Cuerpo" }),
    );
    expect(mime).toContain("To: ana@example.com");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain("Content-Transfer-Encoding: base64");
  });

  it("deja el subject en texto plano si es ASCII puro", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Quick question", body: "x" }),
    );
    expect(mime).toContain("Subject: Quick question");
  });

  it("codifica el subject con acentos como encoded-word RFC 2047", () => {
    const mime = decodeMime(
      buildRawMessage({ to: "ana@example.com", subject: "Diseño para Ñandú", body: "x" }),
    );
    expect(mime).not.toContain("Subject: Diseño");
    const match = mime.match(/Subject: =\?UTF-8\?B\?(.+)\?=/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf8")).toBe("Diseño para Ñandú");
  });

  it("preserva el body en UTF-8", () => {
    const body = "Mañana te escribo. ¿Dale? — Mati";
    expect(decodeBody(buildRawMessage({ to: "ana@example.com", subject: "x", body }))).toBe(body);
  });

  it("devuelve base64url, sin padding ni caracteres de base64 estándar", () => {
    const raw = buildRawMessage({
      to: "ana@example.com",
      subject: "Una prueba más larga para forzar padding",
      body: "Contenido suficientemente largo como para que el base64 necesite relleno.",
    });
    expect(raw).not.toMatch(/[+/=]/);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npm test -- tests/gmail/mime.test.ts
```

Esperado: FALLAN, porque `lib/gmail/mime.ts` no existe.

- [ ] **Step 3: Implementar**

```ts
// lib/gmail/mime.ts
type MailInput = { to: string; subject: string; body: string };

const isAscii = (value: string) => /^[\x20-\x7E]*$/.test(value);

const encodeSubject = (subject: string) =>
  isAscii(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

export function buildRawMessage({ to, subject, body }: MailInput): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(mime, "utf8").toString("base64url");
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npm test -- tests/gmail/mime.test.ts
```

Esperado: los cinco pasan.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: armado del mime para gmail con subject rfc 2047"
```

---

## Task 8: Envío por Gmail y tool con aprobación

**Files:**
- Create: `lib/gmail/send.ts`, `agents/outreach/tools/send_email.ts`

**Interfaces:**
- Consumes: `buildRawMessage()` (Task 7), `createAdminClient()` (Task 4), el principal de la sesión (Task 6).
- Produces: `getAccessToken(userId: string): Promise<string>`, `sendMail(userId: string, input: { to: string; subject: string; body: string }): Promise<{ id: string; threadId: string }>`, y la tool `send_email`.

- [ ] **Step 1: Leer la doc local de tools y aprobaciones**

```bash
cat node_modules/eve/docs/tools.md
cat node_modules/eve/docs/human-in-the-loop.md
```

Confirmar la firma de `defineTool`, de dónde se importa `always()`, y la forma de `ctx.session.auth.current`.

- [ ] **Step 2: Implementar `getAccessToken`**

Lee `google_tokens` con `createAdminClient()` filtrando por `user_id`. Si no hay fila, tira un error con un mensaje que el agente pueda repetirle al usuario sin filtrar nada: "no encontré una conexión de Google para este usuario; hay que volver a entrar con Google". Si hay fila, cambia el refresh token por un access token:

```ts
const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
```

Si Google responde `invalid_grant`, el mensaje de error tiene que decir que la conexión venció y hay que reconectar: es exactamente lo que va a pasar a los 7 días con la app en modo testing.

- [ ] **Step 3: Implementar `sendMail`**

```ts
const res = await fetch(
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: buildRawMessage(input) }),
  },
);
```

`users/me` resuelve la casilla del dueño del token, así que no hace falta header `From`. Si la respuesta no es ok, tirar con el status y el body de Google: sin eso, debuggear un 403 de scopes es a ciegas.

- [ ] **Step 4: Escribir la tool**

```ts
// agents/outreach/tools/send_email.ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { sendMail } from "../../../lib/gmail/send";

export default defineTool({
  description: "Envía un email desde la casilla de Gmail del usuario autenticado.",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  approval: always(),
  async execute(input, ctx) {
    const userId = ctx.session.auth.current?.principalId;
    if (!userId) throw new Error("send_email requiere un usuario autenticado");
    return sendMail(userId, input);
  },
});
```

El `inputSchema` no tiene campo de token, credencial ni casilla de origen. Esa ausencia es la barrera: aunque el modelo quisiera, no tiene por dónde pasar una credencial.

- [ ] **Step 5: Verificar tipos y lint**

```bash
npm run typecheck && npm run lint:fix
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: tool send_email con aprobación obligatoria"
```

---

## Task 9: Chat web con aprobación

**Files:**
- Create: `app/chat/page.tsx`

**Interfaces:**
- Consumes: el agente `outreach` y su canal.
- Produces: chat que manda mensajes y resuelve la pausa con `{ requestId, optionId }`.

- [ ] **Step 1: Leer la doc local del frontend**

```bash
cat node_modules/eve/docs/guides/frontend/nextjs.mdx
cat node_modules/eve/docs/guides/client/overview.md
```

Extraer de ahí la forma exacta en que `useEveAgent({ agent: "outreach" })` expone los input requests y el método para responderlos. **Este plan no la fija a propósito**: el contrato de fondo es `requestId` + `optionId` con `"approve"` y `"cancel"`, y eso no cambia, pero el nombre exacto de la propiedad del hook sale de la doc local, no de acá.

- [ ] **Step 2: Escribir el chat**

Un client component con `useEveAgent({ agent: "outreach" })` que renderice los mensajes y, cuando haya un input request pendiente, muestre el `toolInput` (destinatario, asunto, cuerpo) con dos botones: aprobar y rechazar. Aprobar responde `optionId: "approve"`; rechazar, `"cancel"`.

Es andamio para probar la aprobación, no la UI del producto: la Etapa 4 lo reemplaza con `/cola`. Sin estilos más allá de lo que haga legible el cuerpo del mail.

- [ ] **Step 3: Probar el flujo en local**

Con `npm run dev` y sesión iniciada, entrar a `/chat` y pedir que mande un mail a una casilla tuya. Verificar en orden: el agente llama a `send_email`, la UI muestra la aprobación y **el mail no salió todavía**. Eso último es lo que se está probando: si el mail sale antes de aprobar, `approval` no está funcionando y no hay que seguir.

- [ ] **Step 4: Aprobar y verificar**

Aprobar en la UI. Esperado: el mail llega a la casilla destino, con el asunto bien codificado si tiene acentos.

- [ ] **Step 5: Probar el rechazo**

Pedir otro mail y rechazarlo. Esperado: no llega nada, y el agente dice que se canceló.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: chat web con cola de aprobación del spike"
```

---

## Task 10: Deploy a preview y cierre de la etapa

**Files:**
- Modify: ninguno esperado. Si el deploy exige cambios de config, se commitean acá.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el criterio de cierre cumplido en un deploy real.

- [ ] **Step 1: Subir las variables a Vercel**

```bash
vercel env add GOOGLE_OAUTH_CLIENT_ID preview
vercel env add GOOGLE_OAUTH_CLIENT_SECRET preview
```

Las de Supabase ya vienen del Marketplace. Verificar con `vercel env ls`.

- [ ] **Step 2: Agregar el redirect URI del preview**

Las URLs de preview de Vercel cambian por deploy, así que en Supabase (Authentication → URL Configuration) hay que permitir el patrón de redirect del proyecto, y en Google Cloud el callback de Supabase ya está autorizado del Step 1 de la Task 1. Sin esto, el login en preview falla con `redirect_uri_mismatch`.

- [ ] **Step 3: Deploy**

```bash
vercel deploy
```

Guardar la URL que devuelve.

- [ ] **Step 4: Health contra el preview**

```bash
curl -s https://<preview-url>/eve/agents/outreach/eve/v1/health
```

Esperado: `{"ok":true,"status":"ready",...}`.

- [ ] **Step 5: Verificar que `localDev()` no quedó activo**

```bash
SPIKE_BASE_URL=https://<preview-url> npm test -- tests/channel/auth.test.ts
```

Esperado: PASA. Si `/info` responde 200 sin cookie, `localDev()` se colcó en el deploy y **la puerta está abierta a internet**: frenar todo y arreglar el condicional de `VERCEL_ENV` antes de seguir.

- [ ] **Step 6: Correr el flujo completo en el preview**

Entrar al preview, loguearse con Google, ir a `/chat`, pedir un mail a una casilla propia con **acentos y una ñ en el asunto**, aprobarlo.

- [ ] **Step 7: Confirmar contra el evento, no contra la UI**

Verificar que el mail llegó, con el asunto legible. Y confirmar el resultado contra el evento `input.resolved` de la sesión (por el stream o por `GET /eve/v1/session/<id>`), no contra lo que muestre la pantalla: la doc de eve es explícita en que hay que persistir ese evento y no el estado optimista del cliente.

- [ ] **Step 8: Suite completa y typecheck**

```bash
npm run typecheck && npm test
```

Esperado: todo verde.

- [ ] **Step 9: Cerrar la etapa**

Usar `superpowers:verification-before-completion` antes de declarar la etapa terminada. Después:

- Tildar las tareas en `docs/01-roadmap-etapas.md` y pasar la Etapa 0 a `[x]`.
- Anotar en la spec cualquier diferencia que la doc local de eve haya impuesto sobre este plan.
- `/ship` para el PR.
- `/context-save`.

---

## Notas para quien ejecute

**Si el spike se traba más de dos intentos en el mismo punto**, pará y subí de modelo para ese problema puntual (kickoff §3a), en lugar de seguir iterando.

**Qué significa que esta etapa falle.** Si el mail no sale, el orden de sospecha es: primero los scopes de Google (el error viene con `insufficientPermissions`), después el refresh token (`invalid_grant` = venció o nunca se guardó), después la aprobación de eve (si el mail sale **antes** de aprobar, el problema es `approval` y es el más grave de los tres, porque significa que el diseño de toda la plataforma no se sostiene).

**Lo que esta etapa deja anotado** está en la §11 de la spec: `request_id`, ownership de sesión, `runs` con `status` y `error`, Vault, y la limitación de schedules sin tenant. No resolverlo acá es deliberado.
