# Etapa 17.1 · Aislamiento del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partir `lib/brain` en `core/` (sin dependencias de la plataforma) y `adapters/` (todo lo que toca Supabase, Next, eve y el resto de la plataforma), sumar `list()` e `history()` al proveedor y pasar el editor web a leer por ahí, sin ningún cambio visible.

**Architecture:** Refactor por movimiento de archivos con `git mv`, empezando por lo que ya está limpio y terminando por lo que hay que desacoplar. Un test de frontera crece junto con `core/`: nunca falla a mitad de camino porque solo vigila lo que ya se movió. Lo que `core` necesitaba de la plataforma entra por parámetro (la respuesta 401 del endpoint) o se define localmente (tipos de rol y de conexión).

**Tech Stack:** TypeScript, Next.js (App Router), Vitest, Biome, Supabase JS, `@modelcontextprotocol/sdk`, eve (solo en `adapters`).

**Spec:** `docs/superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md` §6 (aislamiento) y §5.1 (`list`). Esta entrega es la 17.1 de §8.

## Global Constraints

- Sin cambio visible: `/brain` en producción se ve y se comporta igual (spec §8, 17.1).
- `lib/brain/core` no importa nada fuera de `lib/brain/core`, salvo `zod`, `yaml`, `@modelcontextprotocol/sdk/*`, `node:*` y, solo como `import type`, `@supabase/supabase-js` (spec §6.1 y §6.2; `yaml` y `node:*` los suma este plan porque `core/import/` los usa, ver Desvíos).
- Solo `lib/brain/adapters` importa de `@/lib/...`, de `next`, de `react` o de `eve`.
- Los archivos que corren con Node directo (`scripts/brain-import.mts`, `scripts/connections-bind.mts`) exigen imports relativos con extensión `.ts` en toda su cadena de dependencias (comentario de `lib/brain/config.ts`).
- Cada tabla lleva `tenant_id`; `list` e `history` reciben el tenant del closure del proveedor, nunca como argumento (regla del repo y spec §5).
- Código e identificadores en inglés; mensajes y comentarios en español rioplatense.
- Commits con prefijo `refactor:` / `feat:` / `docs:` y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No correr `npm run lint:fix` sobre todo el repo: reformatea cuatro archivos ajenos. Formatear solo los archivos tocados con `npx biome check --write <rutas>`.
- Identidad git del repo: `innovasbuild` / `matias@innov.as` (ya configurada en este worktree).

## Desvíos respecto de la spec

Esta entrega se aparta de la spec en seis puntos. Todos son menores y no cambian el diseño.

1. **`BrainProvider` suma también `history(slug)`**, no solo `list()`. Sin ella el editor tendría que leer `brain_revisions` por fuera del proveedor, y en la 17.2 `withAccess` no podría filtrar el historial: quedaría un agujero de lectura.
2. **El editor no tiene `core/editor/load-context.ts`**. Todo el armado del contexto del editor (tenant, rol, binding) es cableado de plataforma y vive en `adapters/editor.ts`. La 17.2 agrega la lógica de acceso donde corresponda.
3. **Los adapters no se llaman `supabase.ts` ni `platform.ts`**. Se mantienen los nombres por archivo (`provider.ts`, `agent-access.ts`, `tools.ts`, `mcp-supabase.ts`, `mcp-production.ts`, `editor.ts`). La consolidación tiene sentido cuando la 17.2 sume `AccessRulesStore`.
4. **Los tests se quedan en `tests/brain/`**, con los imports actualizados. Es el directorio de pruebas del módulo; mudarlo de repo es llevarse `lib/brain/core` y `tests/brain`.
5. **El proveedor `mcp` falla con `BrainProviderError` en `list()` e `history()`**, no con una clase `BrainUnsupported` (spec §5.1): esa clase no existe y el editor ya bloquea los brains externos antes de llamar.
6. **Los consumidores externos importan funciones de runtime de `core`** (`resolveBrainBinding`, `savePage`, `buildLinkIndex`, `diffLines`, `slugFromParams`, `parseWikiConfig`, `BRAIN_STATUSES`…), no solo tipos: la spec §6.1 dice "solo de adapters o de los tipos de core". Se mantiene así porque son funciones puras del módulo, no cableado de plataforma.

## Review Focus

Entradas y condiciones que la spec insinúa y ninguna tarea cubriría sola. Cada línea tiene su prueba en la tarea indicada.

1. **Scripts con Node directo.** Si algún import de la cadena `core/wiki-store.ts` → `core/wiki.ts` → `core/import/*` pierde su extensión `.ts`, `npm run brain:import` y `connections:bind` se rompen en producción aunque `npm test` pase. Prueba: Tarea 7, paso de humo con `node` directo.
2. **`list()` e `history()` filtran por el tenant del closure.** Un tenant no puede ver páginas ni revisiones de otro aunque el editor tenga un bug. Prueba: Tarea 4, `tests/brain/wiki-store.test.ts` y `tests/brain/wiki-list.test.ts`.
3. **`extractBearer` local igual a la de eve** en los bordes: `null`, `Bearer ` vacío, `Basic`, mayúsculas, espacios de más. Prueba: Tarea 3, `tests/brain/mcp-server/bearer.test.ts` compara las dos.
4. **El 401 del endpoint no cambia** después de inyectar `unauthorized`: mismos headers `www-authenticate` con `resource_metadata`. Prueba: Tarea 3, el test existente de `handler.test.ts` (línea 270) sigue pasando con la inyección.
5. **El guardia de frontera detecta de verdad.** Un test de frontera que nunca falla no protege nada. Prueba: Tarea 1, `tests/brain/boundary.test.ts` verifica el detector con fuentes que violan la regla antes de escanear el disco.
6. **Brain externo (`mcp`).** `list()` e `history()` del proveedor remoto fallan con un error del brain y no intentan conectarse. Prueba: Tarea 4, `tests/brain/mcp-provider-unsupported.test.ts`.

---

## Mapa de archivos

Estado final de `lib/brain/`:

```
lib/brain/
├── README.md                          (nuevo, Tarea 7)
├── core/
│   ├── types.ts  contract.ts  errors.ts  limits.ts  config.ts  mcp-config.ts
│   ├── resolve.ts  approval.ts  wiki.ts  wiki-store.ts  mcp.ts
│   ├── links.ts  wikilinks.ts  diff.ts
│   ├── editor/   autocomplete.ts  markdown-links.ts  slug.ts  save.ts
│   ├── import/   document.ts  files.ts  manifest.ts  plan.ts
│   └── mcp-server/   access.ts  bearer.ts (nuevo)  handler.ts  rate-limit.ts  server.ts
└── adapters/
    ├── provider.ts          (era lib/brain/provider.ts)
    ├── agent-access.ts      (era lib/brain/agent-access.ts)
    ├── tools.ts             (era lib/brain/tools.ts)
    ├── editor.ts            (era lib/brain/editor/load.ts, reescrito en la Tarea 6)
    ├── mcp-supabase.ts      (era lib/brain/mcp-server/supabase.ts)
    └── mcp-production.ts    (era lib/brain/mcp-server/production.ts)
```

Nuevos fuera de `lib/brain`: `tests/brain/boundary-check.ts`, `tests/brain/boundary.test.ts`, `tests/brain/wiki-store.test.ts`, `tests/brain/wiki-list.test.ts`, `tests/brain/mcp-provider-unsupported.test.ts`, `tests/brain/mcp-server/bearer.test.ts`.

## Helper de reescritura de imports

Cada movimiento de archivo exige reescribir los imports de todo el repo, que usan tres formas: `@/lib/brain/x`, `../lib/brain/x` (con cualquier cantidad de `../`) y `../brain/x` (desde `lib/outreach`). Definir esta función en la terminal antes de la Tarea 1 (la shell de la sesión no persiste: redefinirla si hace falta):

```bash
rebrain() {
  # $1 = ruta vieja bajo lib/brain (sin extensión), $2 = ruta nueva bajo lib/brain
  grep -rlE "brain/$1(\.ts)?[\"']" app lib agents components scripts tests \
    --include='*.ts' --include='*.tsx' --include='*.mts' \
    --exclude-dir=node_modules --exclude-dir=.eve --exclude-dir=.next \
  | tr '\n' '\0' | OLD="$1" NEW="$2" xargs -0 perl -pi -e \
    's#((?:\@/lib/|(?:\.\./)+lib/|\.\./)brain)/\Q$ENV{OLD}\E(\.ts)?(["\x27])#$1/$ENV{NEW}$2$3#g'
}
```

Todos los comandos se corren desde la raíz del worktree: `/Users/mok/Sites/innovas/agents/.claude/worktrees/etapa-17-permisos-brain`.

---

### Tarea 0: Preparar el worktree (sin commit)

**Files:** ninguno.

- [ ] **Step 1: Instalar dependencias**

El worktree no tiene `node_modules`.

Run: `npm ci`
Expected: termina sin errores.

- [ ] **Step 2: Línea base verde**

Run: `npm run typecheck && npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: typecheck sin errores y todos los tests en verde. Si algo falla acá, frenar y reportarlo: no es de esta entrega.

---

### Tarea 1: Test de frontera y movimiento de los archivos que ya están limpios

**Files:**
- Create: `tests/brain/boundary-check.ts`, `tests/brain/boundary.test.ts`
- Move (a `lib/brain/core/`): `types.ts`, `contract.ts`, `errors.ts`, `limits.ts`, `config.ts`, `mcp-config.ts`, `wiki.ts`, `wiki-store.ts`, `links.ts`, `wikilinks.ts`, `diff.ts`, `mcp.ts`, `editor/autocomplete.ts`, `editor/markdown-links.ts`, `editor/slug.ts`, `import/document.ts`, `import/files.ts`, `import/manifest.ts`, `import/plan.ts`, `mcp-server/rate-limit.ts`, `mcp-server/server.ts`
- Modify: todos los que importaban esos archivos (por `rebrain`)

**Interfaces:**
- Produces: `findViolations(file: string, source: string, coreDir: string): string[]` en `tests/brain/boundary-check.ts`. Devuelve una descripción por cada import que viola la frontera; lista vacía si cumple.

- [ ] **Step 1: Escribir el detector y su test**

`tests/brain/boundary-check.ts`:

```ts
import { dirname, resolve, sep } from "node:path";

// import x from "a" · import { x } from "a" · import type { x } from "a" ·
// import "a" · export { x } from "a" (también en varias líneas).
const IMPORT_PATTERN =
	/\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;

const ALLOWED_PACKAGES = [
	/^zod$/,
	/^yaml$/,
	/^@modelcontextprotocol\/sdk\//,
	/^node:/,
];
const TYPE_ONLY_PACKAGES = [/^@supabase\/supabase-js$/];

export function findViolations(
	file: string,
	source: string,
	coreDir: string,
): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const typeOnly = match[1] !== undefined;
		const specifier = match[2];
		if (specifier.startsWith(".")) {
			const target = resolve(dirname(file), specifier);
			if (target !== coreDir && !target.startsWith(coreDir + sep)) {
				found.push(`${specifier}: sale de lib/brain/core`);
			}
		} else if (TYPE_ONLY_PACKAGES.some((p) => p.test(specifier))) {
			if (!typeOnly) found.push(`${specifier}: solo se admite con import type`);
		} else if (!ALLOWED_PACKAGES.some((p) => p.test(specifier))) {
			found.push(`${specifier}: no está entre las dependencias de core`);
		}
	}
	return found;
}
```

`tests/brain/boundary.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolations } from "./boundary-check";

const CORE = fileURLToPath(new URL("../../lib/brain/core", import.meta.url));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
	});
}

describe("detector de frontera", () => {
	const file = join(CORE, "editor", "x.ts");

	it("acepta imports internos, zod, yaml, el SDK de MCP y node:*", () => {
		const source = [
			'import { a } from "../types.ts";',
			'import { z } from "zod";',
			'import { parse } from "yaml";',
			'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
			'import { createHash } from "node:crypto";',
			'import type { SupabaseClient } from "@supabase/supabase-js";',
		].join("\n");
		expect(findViolations(file, source, CORE)).toEqual([]);
	});

	it("rechaza el alias @/, un relativo que sale de core y paquetes ajenos", () => {
		expect(
			findViolations(file, 'import { x } from "@/lib/supabase/admin";', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'import { x } from "../../connectors/auth";', CORE),
		).toHaveLength(1);
		expect(findViolations(file, 'import { cache } from "react";', CORE)).toHaveLength(1);
		expect(
			findViolations(file, 'import { defineTool } from "eve/tools";', CORE),
		).toHaveLength(1);
	});

	it("detecta imports en varias líneas y re-exports", () => {
		const multiline = 'import {\n  a,\n  b,\n} from "eve/channels/auth";';
		expect(findViolations(file, multiline, CORE)).toHaveLength(1);
		expect(
			findViolations(file, 'export { x } from "@/lib/foo";', CORE),
		).toHaveLength(1);
	});

	it("exige import type para @supabase/supabase-js", () => {
		expect(
			findViolations(file, 'import { createClient } from "@supabase/supabase-js";', CORE),
		).toHaveLength(1);
	});
});

describe("lib/brain/core", () => {
	it("no importa nada de afuera del módulo", () => {
		const violations = sourceFiles(CORE).flatMap((file) =>
			findViolations(file, readFileSync(file, "utf8"), CORE).map(
				(v) => `${file.slice(CORE.length + 1)}: ${v}`,
			),
		);
		expect(violations).toEqual([]);
	});
});
```

- [ ] **Step 2: Correr el test de frontera**

Run: `npx vitest run tests/brain/boundary.test.ts`
Expected: los cuatro tests del detector pasan. El test de `lib/brain/core` **falla** con `ENOENT` porque el directorio todavía no existe.

- [ ] **Step 3: Mover los archivos limpios**

```bash
mkdir -p lib/brain/core/editor lib/brain/core/import lib/brain/core/mcp-server
for f in types contract errors limits config mcp-config wiki wiki-store links wikilinks diff mcp \
         editor/autocomplete editor/markdown-links editor/slug \
         import/document import/files import/manifest import/plan \
         mcp-server/rate-limit mcp-server/server; do
  git mv "lib/brain/$f.ts" "lib/brain/core/$f.ts"
  rebrain "$f" "core/$f"
done
```

Los imports relativos entre estos archivos no cambian porque se mueven todos juntos con la misma estructura de carpetas.

- [ ] **Step 4: Verificar que nada quedó apuntando a la ruta vieja**

Run: `npm run typecheck`
Expected: sin errores. Si aparece `Cannot find module '.../lib/brain/<archivo>'`, hay un import con una forma que `rebrain` no cubrió: corregirlo a mano y anotarlo.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts tests/scripts`
Expected: todo en verde, incluido `boundary.test.ts` (ahora `core/` existe y está limpio).

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/brain tests/brain app/\[tenant\]/brain components/brain agents/outreach/tools/brain.ts lib/outreach/canon.ts scripts
git status --short   # solo deben figurar archivos del brain y sus importadores
git add -A lib/brain tests app components agents scripts lib/outreach
git commit -m "refactor: mover a lib/brain/core los archivos del brain que no dependen de la plataforma" \
  -m "Suma un test de frontera que vigila que core no importe de afuera del módulo." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Desacoplar `resolve`, `approval` y `editor/save` y moverlos a `core`

**Files:**
- Modify: `lib/brain/resolve.ts`, `lib/brain/approval.ts`, `lib/brain/editor/save.ts`, `lib/brain/core/types.ts`
- Move (a `lib/brain/core/`): `resolve.ts`, `approval.ts`, `editor/save.ts`

**Interfaces:**
- Produces: `BrainConnection` (en `core/resolve.ts`), `BrainRole` (en `core/types.ts`), `BrainApprovalDecision` (en `core/approval.ts`).
- Consumes: nada nuevo.

- [ ] **Step 1: Definir los tipos locales**

En `lib/brain/core/types.ts`, debajo de `BrainStatus`:

```ts
// Rol del usuario en el tenant, tal como lo estampa la plataforma. Es el mismo
// conjunto de literales que TenantRole: el módulo no importa de la plataforma.
export type BrainRole = "platform_admin" | "tenant_admin" | "tenant_member";
```

En `lib/brain/resolve.ts`, reemplazar la línea `import type { Binding } from "../connectors/providers.ts";` por:

```ts
// Lo que el módulo necesita saber de una conexión del tenant. Es un subconjunto
// de Binding de la plataforma: cualquier Binding la satisface.
export interface BrainConnection {
	id: string;
	tenantId: string;
	capability: string;
	provider: string;
	connectorUid: string | null;
	config: Record<string, unknown>;
}
```

y en la firma de `resolveBrainBinding` cambiar `load: (tenantId: string) => Promise<Binding[]>` por `load: (tenantId: string) => Promise<BrainConnection[]>`.

En `lib/brain/approval.ts`, reemplazar el import de `ApprovalResponseDecision` por un tipo local y usarlo en la firma:

```ts
export type BrainApprovalDecision =
	| { status: "allowed" }
	| { status: "rejected"; reason: string };
```

(la función pasa a devolver `BrainApprovalDecision`; el cuerpo no cambia).

En `lib/brain/editor/save.ts`, reemplazar `import type { TenantRole } from "@/lib/tenants/resolve";` por `import type { BrainRole } from "../types";` (agregándolo al import de tipos que ya existe de `../types`) y en `SaveDeps.access` cambiar `role: TenantRole` por `role: BrainRole`.

- [ ] **Step 2: Mover los tres archivos**

```bash
for f in resolve approval editor/save; do
  git mv "lib/brain/$f.ts" "lib/brain/core/$f.ts"
  rebrain "$f" "core/$f"
done
```

Los relativos de `resolve.ts`, `approval.ts` y `editor/save.ts` (`./config.ts`, `./mcp-config.ts`, `../errors`, `../types`) ya apuntan a hermanos que están en `core`.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: sin errores. `agents/outreach/tools/brain.ts` pasa `Binding[]` a `resolveBrainBinding` y `app/[tenant]/brain/actions.ts` entrega un `TenantRole` a `SaveDeps`: ambos son asignables a los tipos locales. Si `tools.ts` se queja porque `decideBrainUpsertResponse` no cabe en el tipo de eve, agregar a `BrainApprovalDecision` la forma que falte según el mensaje de error de TypeScript.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: todo en verde, `boundary.test.ts` incluido.

- [ ] **Step 4: Commit**

```bash
npx biome check --write lib/brain tests/brain app/\[tenant\]/brain agents/outreach/tools/brain.ts lib/outreach/canon.ts
git add -A lib app agents tests
git commit -m "refactor: resolve, approval y save del brain dejan de depender de la plataforma" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: El endpoint MCP entra a `core` con el 401 inyectado

**Files:**
- Create: `lib/brain/core/mcp-server/bearer.ts`, `tests/brain/mcp-server/bearer.test.ts`
- Modify: `lib/brain/mcp-server/access.ts`, `lib/brain/mcp-server/handler.ts`, `tests/brain/mcp-server/handler.test.ts`
- Move (a `lib/brain/core/mcp-server/`): `access.ts`, `handler.ts`

**Interfaces:**
- Produces: `extractBearer(header: string | null): string | null` (`core/mcp-server/bearer.ts`); `UnauthorizedOptions` y `BrainMcpDeps.unauthorized` (`core/mcp-server/handler.ts`).
- Consumes: `createUnauthorizedResponse` de eve, solo en el test y en la Tarea 5.

- [ ] **Step 1: Test de paridad de `extractBearer` (falla)**

`tests/brain/mcp-server/bearer.test.ts`:

```ts
import { extractBearerToken } from "eve/channels/auth";
import { describe, expect, it } from "vitest";
import { extractBearer } from "@/lib/brain/core/mcp-server/bearer";

// core no puede importar de eve, así que tiene su propia copia. Este test
// compara las dos en los bordes: si eve cambia el parseo, esto avisa.
const CASES: Array<string | null> = [
	null,
	"",
	"Bearer abc",
	"bearer abc",
	"BEARER abc",
	"Bearer    abc   ",
	"Bearer ",
	"Bearer",
	"Basic abc",
	"Bearer a b",
	"abc",
];

describe("extractBearer", () => {
	it.each(CASES)("coincide con eve para %j", (header) => {
		expect(extractBearer(header)).toEqual(extractBearerToken(header));
	});
});
```

Run: `npx vitest run tests/brain/mcp-server/bearer.test.ts`
Expected: FALLA (`Cannot find module '@/lib/brain/core/mcp-server/bearer'`).

- [ ] **Step 2: Implementar `extractBearer`**

`lib/brain/core/mcp-server/bearer.ts`:

```ts
// Token de un header Authorization: Bearer. Misma semántica que
// extractBearerToken de eve, copiada para que core no dependa de eve.
export function extractBearer(header: string | null): string | null {
	if (header === null) return null;
	const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
	return token === undefined || token.length === 0 ? null : token;
}
```

Run: `npx vitest run tests/brain/mcp-server/bearer.test.ts`
Expected: PASA.

- [ ] **Step 3: Mover `access.ts` y `handler.ts` y desacoplarlos de eve**

```bash
for f in mcp-server/access mcp-server/handler; do
  git mv "lib/brain/$f.ts" "lib/brain/core/$f.ts"
  rebrain "$f" "core/$f"
done
```

En `lib/brain/core/mcp-server/access.ts`: borrar `import { extractBearerToken } from "eve/channels/auth";`, agregar `import { extractBearer } from "./bearer.ts";` y reemplazar `extractBearerToken(input.authorization)` por `extractBearer(input.authorization)`.

En `lib/brain/core/mcp-server/handler.ts`: borrar `import { createUnauthorizedResponse } from "eve/channels/auth";`, agregar encima de `BrainMcpDeps`:

```ts
// Forma mínima de createUnauthorizedResponse de eve. La plataforma inyecta la
// real; core solo conoce esta firma.
export interface UnauthorizedOptions {
	code: string;
	message: string;
	challenges: {
		scheme: "Bearer";
		parameters: Record<string, string>;
	}[];
}
```

sumar a `BrainMcpDeps` el campo `unauthorized: (options: UnauthorizedOptions) => Response;` y reemplazar la llamada `return createUnauthorizedResponse({` por `return deps.unauthorized({`.

- [ ] **Step 4: Inyectar `unauthorized` en el test del handler**

En `tests/brain/mcp-server/handler.test.ts` agregar `import { createUnauthorizedResponse } from "eve/channels/auth";` y, dentro del objeto que devuelve `deps()`, la línea `unauthorized: createUnauthorizedResponse,` antes de `...overrides`.

- [ ] **Step 5: Verificar**

Run: `npm run typecheck`
Expected: el único error esperado es en `lib/brain/mcp-server/production.ts` (falta `unauthorized` en `productionDeps`). Arreglarlo ahora, antes de seguir: agregar `import { createUnauthorizedResponse } from "eve/channels/auth";` y en el objeto de `productionDeps()` la propiedad `unauthorized: createUnauthorizedResponse,`. Ese archivo se mueve en la Tarea 5. Repetir el typecheck: sin errores. Si TypeScript rechaza que `createUnauthorizedResponse` cumpla `UnauthorizedOptions`, ajustar el tipo local a lo que pida el mensaje (por ejemplo `parameters` opcional), sin importar el tipo de eve.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: todo en verde. El test de la línea 270 de `handler.test.ts` (`www-authenticate` con `resource_metadata`) sigue pasando: el 401 no cambió.

- [ ] **Step 6: Commit**

```bash
npx biome check --write lib/brain tests/brain
git add -A lib app agents tests
git commit -m "refactor: el endpoint MCP del brain entra a core y recibe el 401 por parámetro" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: `list()` e `history()` en el proveedor

**Files:**
- Create: `tests/brain/wiki-store.test.ts`, `tests/brain/wiki-list.test.ts`, `tests/brain/mcp-provider-unsupported.test.ts`
- Modify: `lib/brain/core/types.ts`, `lib/brain/core/wiki-store.ts`, `lib/brain/core/wiki.ts`, `lib/brain/core/mcp.ts`, y los dobles de test que implementen `WikiStore` o `BrainProvider`

**Interfaces:**
- Produces, en `core/types.ts`:

```ts
export interface BrainRevision {
	revision: number;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	authorKind: "user" | "agent" | "import";
	authorUserId: string | null;
	reason: string;
	createdAt: string;
}
// BrainProvider suma:
//   list(): Promise<BrainPage[]>;
//   history(slug: string): Promise<BrainRevision[] | null>;   // null si la página no existe
```

- Produces, en `WikiStore` (`core/wiki-store.ts`):
  `list(tenantId: string): Promise<BrainPage[]>` y `listRevisions(tenantId: string, slug: string): Promise<BrainRevision[] | null>`.

- [ ] **Step 1: Tests que fallan**

`tests/brain/wiki-store.test.ts` (cliente falso que registra los filtros):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseWikiStore } from "@/lib/brain/core/wiki-store";

type Call = { table: string; filters: Record<string, unknown> };

// Imita la cadena de PostgREST: select/eq/order devuelven la cadena, y la
// cadena es "esperable" (devuelve todas las filas) o termina en maybeSingle.
function fakeClient(rows: Record<string, Array<Record<string, unknown>>>) {
	const calls: Call[] = [];
	const client = {
		from(table: string) {
			const filters: Record<string, unknown> = {};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				order: () => chain,
				maybeSingle: async () => {
					calls.push({ table, filters: { ...filters } });
					return { data: rows[table]?.[0] ?? null, error: null };
				},
				then: (resolve: (value: unknown) => void) => {
					calls.push({ table, filters: { ...filters } });
					resolve({ data: rows[table] ?? [], error: null });
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

const pageRow = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: {},
	body: "cuerpo",
	revision: 3,
	updated_at: "2026-10-01T00:00:00Z",
};

describe("createSupabaseWikiStore.list", () => {
	it("filtra por el tenant y mapea las columnas", async () => {
		const { client, calls } = fakeClient({ brain_pages: [pageRow] });
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		expect(calls).toEqual([
			{ table: "brain_pages", filters: { tenant_id: "tenant-a" } },
		]);
		expect(pages).toEqual([
			{
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: ["canon:icp"],
				frontmatter: {},
				body: "cuerpo",
				revision: 3,
				updatedAt: "2026-10-01T00:00:00Z",
			},
		]);
	});
});

describe("createSupabaseWikiStore.listRevisions", () => {
	it("devuelve null si la página no existe", async () => {
		const { client } = fakeClient({ brain_pages: [] });
		expect(
			await createSupabaseWikiStore(client).listRevisions("tenant-a", "nada"),
		).toBeNull();
	});

	it("filtra la página y las revisiones por el tenant", async () => {
		const { client, calls } = fakeClient({
			brain_pages: [{ id: "page-1" }],
			brain_revisions: [
				{
					revision: 2,
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: [],
					frontmatter: {},
					body: "v2",
					author_kind: "user",
					author_user_id: "user-1",
					reason: "ajuste",
					created_at: "2026-10-02T00:00:00Z",
				},
			],
		});
		const revisions = await createSupabaseWikiStore(client).listRevisions(
			"tenant-a",
			"comercial/icp",
		);
		expect(calls).toEqual([
			{
				table: "brain_pages",
				filters: { tenant_id: "tenant-a", slug: "comercial/icp" },
			},
			{
				table: "brain_revisions",
				filters: { tenant_id: "tenant-a", page_id: "page-1" },
			},
		]);
		expect(revisions?.[0]).toMatchObject({
			revision: 2,
			authorKind: "user",
			authorUserId: "user-1",
			reason: "ajuste",
			createdAt: "2026-10-02T00:00:00Z",
		});
	});
});
```

`tests/brain/wiki-list.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BrainValidation } from "@/lib/brain/core/errors";
import type { WikiConfig } from "@/lib/brain/core/config";
import { createWikiProvider } from "@/lib/brain/core/wiki";
import type { WikiStore } from "@/lib/brain/core/wiki-store";

const config: WikiConfig = {
	categories: ["comercial"],
	requiredFrontmatter: [],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

function provider(store: Partial<WikiStore>) {
	return createWikiProvider({
		tenantId: "tenant-a",
		bindingId: "binding-1",
		config,
		store: store as WikiStore,
	});
}

describe("wiki provider · list", () => {
	it("pide al store las páginas del tenant del closure", async () => {
		const list = vi.fn(async () => []);
		await provider({ list }).list();
		expect(list).toHaveBeenCalledWith("tenant-a");
	});
});

describe("wiki provider · history", () => {
	it("pide las revisiones del tenant del closure", async () => {
		const listRevisions = vi.fn(async () => []);
		await provider({ listRevisions }).history("comercial/icp");
		expect(listRevisions).toHaveBeenCalledWith("tenant-a", "comercial/icp");
	});

	it("devuelve null si la página no existe", async () => {
		const listRevisions = vi.fn(async () => null);
		expect(await provider({ listRevisions }).history("comercial/nada")).toBeNull();
	});

	it("rechaza un slug inválido sin tocar la base", async () => {
		const listRevisions = vi.fn();
		await expect(provider({ listRevisions }).history("../etc")).rejects.toBeInstanceOf(
			BrainValidation,
		);
		expect(listRevisions).not.toHaveBeenCalled();
	});
});
```

`tests/brain/mcp-provider-unsupported.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BrainProviderError } from "@/lib/brain/core/errors";
import type { McpBrainConfig } from "@/lib/brain/core/mcp-config";
import { createMcpBrainProvider } from "@/lib/brain/core/mcp";

// Un brain externo se edita en su origen: no se lista ni tiene historial acá.
// El transporte tira si alguien intenta conectarse.
const provider = createMcpBrainProvider({
	config: {} as McpBrainConfig,
	transport: async () => {
		throw new Error("no debe conectarse");
	},
});

describe("proveedor mcp · list e history", () => {
	it("list falla con un error del brain", async () => {
		await expect(provider.list()).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("history falla con un error del brain", async () => {
		await expect(provider.history("comercial/icp")).rejects.toBeInstanceOf(
			BrainProviderError,
		);
	});
});
```

Run: `npx vitest run tests/brain/wiki-store.test.ts tests/brain/wiki-list.test.ts tests/brain/mcp-provider-unsupported.test.ts`
Expected: FALLAN (`list is not a function`).

- [ ] **Step 2: Tipos**

En `lib/brain/core/types.ts` agregar `BrainRevision` (definido arriba en Interfaces) después de `BrainPage`, y en `BrainProvider` sumar:

```ts
	list(): Promise<BrainPage[]>;
	history(slug: string): Promise<BrainRevision[] | null>;
```

- [ ] **Step 3: Store**

En `lib/brain/core/wiki-store.ts`: importar `BrainRevision` junto con los otros tipos; extraer el mapeo de fila a página que hoy está dentro de `read` a una función de módulo y usarla desde `read` y `list`:

```ts
function toPage(row: Record<string, unknown>): BrainPage {
	return {
		slug: row.slug as string,
		title: row.title as string,
		category: row.category as string,
		status: row.status as BrainStatus,
		tags: (row.tags as string[] | null) ?? [],
		frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
		body: row.body as string,
		revision: row.revision as number,
		updatedAt: row.updated_at as string,
	};
}

const PAGE_COLUMNS =
	"slug, title, category, status, tags, frontmatter, body, revision, updated_at";
```

`read` pasa a `.select(PAGE_COLUMNS)` y termina con `return data ? toPage(data as Record<string, unknown>) : null;`. En la interfaz `WikiStore` sumar:

```ts
	list(tenantId: string): Promise<BrainPage[]>;
	listRevisions(
		tenantId: string,
		slug: string,
	): Promise<BrainRevision[] | null>;
```

y en `createSupabaseWikiStore`:

```ts
		async list(tenantId) {
			const { data, error } = await client
				.from("brain_pages")
				.select(PAGE_COLUMNS)
				.eq("tenant_id", tenantId)
				.order("slug");
			if (error) throw storeError(error);
			return ((data ?? []) as Array<Record<string, unknown>>).map(toPage);
		},

		async listRevisions(tenantId, slug) {
			const { data: page, error: pageError } = await client
				.from("brain_pages")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("slug", slug)
				.maybeSingle();
			if (pageError) throw storeError(pageError);
			if (!page) return null;

			const { data, error } = await client
				.from("brain_revisions")
				.select(
					"revision, title, category, status, tags, frontmatter, body, author_kind, author_user_id, reason, created_at",
				)
				.eq("tenant_id", tenantId)
				.eq("page_id", (page as { id: string }).id)
				.order("revision", { ascending: false });
			if (error) throw storeError(error);

			return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
				revision: row.revision as number,
				title: row.title as string,
				category: row.category as string,
				status: row.status as BrainStatus,
				tags: (row.tags as string[] | null) ?? [],
				frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
				body: row.body as string,
				authorKind: row.author_kind as BrainRevision["authorKind"],
				authorUserId: (row.author_user_id as string | null) ?? null,
				reason: row.reason as string,
				createdAt: row.created_at as string,
			}));
		},
```

- [ ] **Step 4: Proveedor wiki y proveedor mcp**

En `lib/brain/core/wiki.ts`, dentro del objeto que devuelve `createWikiProvider`, junto a `search`:

```ts
		async list() {
			return store.list(tenantId);
		},

		async history(slug) {
			if (!isValidSlug(slug)) throw new BrainValidation(["slug"]);
			return store.listRevisions(tenantId, slug);
		},
```

En `lib/brain/core/mcp.ts`, dentro del objeto que devuelve `createMcpBrainProvider` (importar `BrainProviderError` ya está en ese archivo):

```ts
		async list() {
			throw new BrainProviderError(
				"este brain vive en un servidor externo y no se lista desde la plataforma",
			);
		},

		async history() {
			throw new BrainProviderError(
				"este brain vive en un servidor externo y no tiene historial en la plataforma",
			);
		},
```

- [ ] **Step 5: Tests en verde y dobles que faltan**

Run: `npx vitest run tests/brain/wiki-store.test.ts tests/brain/wiki-list.test.ts tests/brain/mcp-provider-unsupported.test.ts`
Expected: PASAN.

Run: `npm run typecheck`
Expected: errores solo en dobles de test que construyen un `WikiStore` o un `BrainProvider` a mano (por ejemplo en `tests/brain/wiki.test.ts`, `tests/brain/mcp-server/handler.test.ts`, `tests/brain/mcp-server/tools.test.ts`, `tests/brain/tools.test.ts`, `tests/outreach/canon.test.ts`). En cada doble de `WikiStore` agregar `list: async () => [], listRevisions: async () => null,`; en cada doble de `BrainProvider` agregar `list: async () => [], history: async () => null,`. Repetir hasta que `typecheck` quede sin errores.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
npx biome check --write lib/brain tests
git add -A lib tests
git commit -m "feat: list e history en el proveedor del brain" \
  -m "El editor las usa en vez de leer las tablas con el cliente de sesión. History queda en el proveedor para que la 17.2 pueda filtrarla por permisos." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Mover a `adapters` lo que toca la plataforma

**Files:**
- Move: `lib/brain/provider.ts` → `lib/brain/adapters/provider.ts`; `lib/brain/agent-access.ts` → `adapters/agent-access.ts`; `lib/brain/tools.ts` → `adapters/tools.ts`; `lib/brain/editor/load.ts` → `adapters/editor.ts`; `lib/brain/mcp-server/supabase.ts` → `adapters/mcp-supabase.ts`; `lib/brain/mcp-server/production.ts` → `adapters/mcp-production.ts`
- Modify: los imports relativos de cada archivo movido y todos los importadores externos

- [ ] **Step 1: Mover y reescribir importadores externos**

```bash
mkdir -p lib/brain/adapters
git mv lib/brain/provider.ts lib/brain/adapters/provider.ts
git mv lib/brain/agent-access.ts lib/brain/adapters/agent-access.ts
git mv lib/brain/tools.ts lib/brain/adapters/tools.ts
git mv lib/brain/editor/load.ts lib/brain/adapters/editor.ts
git mv lib/brain/mcp-server/supabase.ts lib/brain/adapters/mcp-supabase.ts
git mv lib/brain/mcp-server/production.ts lib/brain/adapters/mcp-production.ts
rebrain provider adapters/provider
rebrain agent-access adapters/agent-access
rebrain tools adapters/tools
rebrain editor/load adapters/editor
rebrain mcp-server/supabase adapters/mcp-supabase
rebrain mcp-server/production adapters/mcp-production
```

- [ ] **Step 2: Corregir los imports relativos de cada archivo movido**

Reemplazar el bloque de imports de cada archivo por el siguiente (el cuerpo de cada archivo no cambia, salvo lo indicado):

`lib/brain/adapters/provider.ts`:

```ts
import { apiKeyBearer } from "../../connectors/auth";
import { createAdminClient } from "../../supabase/admin";
import { createMcpBrainProvider, streamableTransport } from "../core/mcp.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider } from "../core/types.ts";
import { createWikiProvider } from "../core/wiki.ts";
import { createSupabaseWikiStore } from "../core/wiki-store.ts";
```

`lib/brain/adapters/agent-access.ts`: cambiar `from "../supabase/admin"` por `from "../../supabase/admin"`.

`lib/brain/adapters/tools.ts`:

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { decideBrainUpsertResponse } from "../core/approval.ts";
import { brainContract } from "../core/contract.ts";
import { toToolError } from "../core/errors.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider } from "../core/types.ts";
import { getBrainProvider } from "./provider.ts";
```

`lib/brain/adapters/mcp-supabase.ts`: los tres imports de plataforma (`../../auth/oauth-principal`, `../../connectors/bindings`, `../../supabase/admin`) conservan su ruta (misma profundidad); cambiar los otros tres a:

```ts
import { resolveBrainBinding } from "../core/resolve.ts";
import type { AccessStore, ClaimsVerifier } from "../core/mcp-server/access.ts";
import type { HitFn } from "../core/mcp-server/rate-limit.ts";
```

`lib/brain/adapters/mcp-production.ts`:

```ts
import { createUnauthorizedResponse } from "eve/channels/auth";
import type { BrainMcpDeps } from "../core/mcp-server/handler.ts";
import {
	supabaseAccessStore,
	supabaseClaimsVerifier,
	supabaseHit,
} from "./mcp-supabase.ts";
import { getBrainProvider } from "./provider.ts";
```

(el `import { createUnauthorizedResponse }` ya lo agregó la Tarea 3; dejarlo una sola vez, y `productionDeps()` conserva `unauthorized: createUnauthorizedResponse`).

`lib/brain/adapters/editor.ts` (por ahora sin reescribir, la Tarea 6 lo rehace): cambiar `from "../resolve"` por `from "../core/resolve"` y `from "../types"` por `from "../core/types"`.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: sin errores.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: todo en verde. El mock de `@/lib/supabase/admin` y `@/lib/connectors/bindings` en `tests/agents/outreach/tools/brain.test.ts` sigue funcionando porque se resuelve por especificador, no por importador.

Run: `ls lib/brain lib/brain/editor lib/brain/mcp-server 2>&1`
Expected: `lib/brain` solo contiene `adapters` y `core`; `lib/brain/editor` y `lib/brain/mcp-server` ya no existen (si quedó un directorio vacío, borrarlo).

- [ ] **Step 4: Commit**

```bash
npx biome check --write lib/brain tests app/\[tenant\]/brain components/brain agents/outreach lib/outreach/canon.ts app/brain app/.well-known
git add -A lib app agents components tests scripts
git commit -m "refactor: mover a lib/brain/adapters lo que toca Supabase, eve y la plataforma" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: El editor lee por el proveedor

**Files:**
- Modify: `lib/brain/adapters/editor.ts` (reescritura), `components/brain/page-list.tsx`, y los seis lugares de `app/[tenant]/brain/` que llaman a `loadBrainPages` o `loadRevisions`

**Interfaces:**
- Consumes: `BrainProvider.list()` / `.history()` (Tarea 4), `getBrainProvider` (Tarea 5).
- Produces, en `adapters/editor.ts`:
  - `EditorContext` con la variante `ok` ahora lleva `provider: BrainProvider`.
  - `OkEditorContext = Extract<EditorContext, { kind: "ok" }>`.
  - `loadBrainPages(ctx: OkEditorContext): Promise<BrainPage[]>`.
  - `loadRevisions(ctx: OkEditorContext, slug: string): Promise<RevisionRow[] | null>`.

- [ ] **Step 1: Reescribir `lib/brain/adapters/editor.ts`**

```ts
// Lecturas del editor (spec editor §4.3 y §6; etapa 17 §5.2). Todo se lee por
// el proveedor del brain: el editor deja de tocar brain_pages y brain_revisions
// con el cliente de sesión. El tenant sale de resolveTenantAccess, que ya
// verificó la membresía; el proveedor filtra siempre por ese tenant.
import { cache } from "react";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import { resolveBrainBinding } from "../core/resolve";
import type { BrainPage, BrainProvider, BrainRevision } from "../core/types";
import { getBrainProvider } from "./provider";

export type EditorContext =
	| {
			kind: "ok";
			tenant: TenantAccess;
			canEdit: boolean;
			categories: string[];
			provider: BrainProvider;
	  }
	| { kind: "no-brain"; tenant: TenantAccess }
	| { kind: "external"; tenant: TenantAccess };

export type OkEditorContext = Extract<EditorContext, { kind: "ok" }>;

export const loadEditorContext = cache(
	async (tenantSlug: string): Promise<EditorContext | null> => {
		const tenant = await resolveTenantAccess(tenantSlug);
		if (!tenant) return null;
		const binding = await resolveBrainBinding(tenant.id, loadTenantBindings);
		if (!binding) return { kind: "no-brain", tenant };
		if (binding.provider !== "wiki") return { kind: "external", tenant };
		return {
			kind: "ok",
			tenant,
			canEdit: tenant.role !== "tenant_member",
			categories: binding.config.categories,
			provider: getBrainProvider(binding),
		};
	},
);

// cache() compara por identidad: loadEditorContext devuelve el mismo objeto
// durante todo el request, así que la lista se lee una sola vez.
export const loadBrainPages = cache(
	async (ctx: OkEditorContext): Promise<BrainPage[]> => ctx.provider.list(),
);

export interface RevisionRow extends Omit<BrainRevision, "authorUserId"> {
	authorEmail: string | null;
}

export async function loadRevisions(
	ctx: OkEditorContext,
	slug: string,
): Promise<RevisionRow[] | null> {
	const revisions = await ctx.provider.history(slug);
	if (!revisions) return null;

	const emails = await memberEmails(ctx.tenant.id, [
		...new Set(
			revisions
				.map((r) => r.authorUserId)
				.filter((id): id is string => id !== null),
		),
	]);

	return revisions.map(({ authorUserId, ...revision }) => ({
		...revision,
		authorEmail: authorUserId ? (emails.get(authorUserId) ?? null) : null,
	}));
}

// Solo usuarios con membership en este tenant: un email de otra empresa no se
// muestra aunque haya quedado como autor.
async function memberEmails(
	tenantId: string,
	userIds: string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (userIds.length === 0) return result;
	const admin = createAdminClient();
	const { data: members } = await admin
		.from("memberships")
		.select("user_id")
		.eq("tenant_id", tenantId)
		.in("user_id", userIds);
	await Promise.all(
		((members ?? []) as Array<{ user_id: string }>).map(async ({ user_id }) => {
			const { data } = await admin.auth.admin.getUserById(user_id);
			if (data.user?.email) result.set(user_id, data.user.email);
		}),
	);
	return result;
}
```

- [ ] **Step 2: Actualizar los llamadores**

```bash
grep -rn "loadBrainPages\|loadRevisions\|BrainPageRow" app components --include='*.ts' --include='*.tsx'
```

Cambios:
- `loadBrainPages(ctx.tenant.id)` → `loadBrainPages(ctx)` en `app/[tenant]/brain/page.tsx`, `mapa/page.tsx`, `nueva/page.tsx`, `editar/[...slug]/page.tsx`, `p/[...slug]/page.tsx`.
- `loadRevisions(ctx.tenant.id, slug)` → `loadRevisions(ctx, slug)` en `historial/[...slug]/page.tsx`.
- `app/[tenant]/brain/raw/[...slug]/route.ts`: si llama a `loadBrainPages`, mismo cambio; en cada página, `ctx` ya está acotado a `kind === "ok"` antes de la llamada (si TypeScript marca lo contrario, agregar el chequeo que falte en el mismo `if` de `notFound()` existente).
- `components/brain/page-list.tsx`: reemplazar `import type { BrainPageRow } from "@/lib/brain/adapters/editor";` por `import type { BrainPage } from "@/lib/brain/core/types";` (fusionándolo con el import de `CANON_TAGS` de ese mismo módulo) y usar `BrainPage[]` donde decía `BrainPageRow[]`.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: sin errores.

Run: `npx vitest run tests/brain tests/agents tests/outreach/canon.test.ts`
Expected: todo en verde.

- [ ] **Step 4: Humo visual, si hay base local**

Si Docker y la base local están disponibles (`npm run db:start`), levantar el servidor con `preview_start` y recorrer en `/<tenant>/brain`: índice, una página, su historial (verifica `history`), la edición, el mapa de conexiones y `raw`. Esperado: idéntico a antes, sin errores en consola ni en `preview_logs`. Si no hay base local, anotarlo en el reporte final como verificación pendiente para el usuario: es el único paso que cubre el cambio de cliente de sesión a cliente admin en las lecturas.

- [ ] **Step 5: Commit**

```bash
npx biome check --write lib/brain app/\[tenant\]/brain components/brain
git add -A lib app components
git commit -m "refactor: el editor del brain lee por el proveedor y no por el cliente de sesión" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: README del módulo, humo con Node directo y cierre

**Files:**
- Create: `lib/brain/README.md`
- Modify: `docs/01-roadmap-etapas.md`

- [ ] **Step 1: Humo con Node directo (Review Focus 1)**

Los scripts de operación importan `core` sin bundler. Probar la misma cadena:

```bash
node --input-type=module -e "
await import('./lib/brain/core/config.ts');
await import('./lib/brain/core/mcp-config.ts');
await import('./lib/brain/core/wiki-store.ts');
await import('./lib/brain/core/wiki.ts');
await import('./lib/brain/core/import/manifest.ts');
await import('./lib/brain/core/import/files.ts');
await import('./lib/brain/core/import/plan.ts');
console.log('cadena de scripts OK');
"
```

Expected: imprime `cadena de scripts OK`. Si falla con `ERR_MODULE_NOT_FOUND`, algún import de esa cadena perdió su extensión `.ts`: corregirlo y repetir.

Run: `node --env-file=/dev/null scripts/connections-bind.mts --help 2>&1 | head -5`
Expected: no falla por módulos no encontrados (puede pedir variables de entorno; eso es esperable y no es un error de esta tarea).

- [ ] **Step 2: Escribir `lib/brain/README.md`**

```markdown
# Brain

Módulo del brain de cada cliente: páginas en markdown con revisiones, búsqueda,
editor, endpoint MCP y tools para el agente. Está pensado para poder mudarse a
su propio repo.

## Estructura

- `core/`: todo el módulo. No importa nada de afuera de `lib/brain/core`, salvo
  `zod`, `yaml`, `@modelcontextprotocol/sdk`, `node:*` y, como tipo,
  `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`.
- `adapters/`: lo que conecta el módulo con esta plataforma (Supabase admin,
  conexiones del tenant, sesión, eve, Next). Es lo que hay que reescribir en el
  repo nuevo.

## Qué viaja con el módulo

- `lib/brain/core/`
- `tests/brain/`
- Migraciones: `20260913233557_brain_tables`, `20260913234426_brain_upsert_page`,
  `20260913235330_brain_search_pages`, `20260924100200_brain_mcp_usage` y, desde
  la 17.2, la de permisos.
- Tests pgTAP del brain en `supabase/tests/`.

## Lo que el host tiene que proveer

| Interfaz | Dónde | Qué hace |
|---|---|---|
| `WikiStore` | `core/wiki-store.ts` | Lectura y escritura de páginas y revisiones. `createSupabaseWikiStore(client)` es la implementación sobre Supabase |
| `AccessStore`, `ClaimsVerifier`, `HitFn` | `core/mcp-server/` | Roles del usuario, verificación del token y contador de llamadas del endpoint MCP |
| `BrainMcpDeps.unauthorized` | `core/mcp-server/handler.ts` | Arma la respuesta 401 con su desafío |
| `load` de `resolveBrainBinding` | `core/resolve.ts` | Lista las conexiones del tenant (`BrainConnection[]`) |
| `SaveDeps` | `core/editor/save.ts` | Sesión, binding y proveedor para guardar desde el editor |

Los scripts de operación (`scripts/brain-import.mts`, `scripts/connections-bind.mts`)
corren con Node directo: en `core/`, los imports que ellos alcanzan llevan
extensión `.ts`.
```

- [ ] **Step 3: Marcar la entrega en el roadmap**

En `docs/01-roadmap-etapas.md`, en la Etapa 17, cambiar `- [ ] **17.1 · Aislamiento.**` por `- [x] **17.1 · Aislamiento.**` y agregar al final de esa viñeta ` Plan: \`docs/superpowers/plans/2026-10-05-etapa-17-1-aislamiento-brain.md\`.`

- [ ] **Step 4: Verificación final**

Run: `npm run typecheck && npm test`
Expected: sin errores y toda la suite en verde (los tests que necesitan la base, `npm run db:test`, no cambian en esta entrega y no hace falta correrlos).

Run: `git status --short`
Expected: limpio salvo los archivos de esta tarea; ningún archivo ajeno reformateado por Biome (los cuatro de `project_lint_fix_toca_archivos_ajenos`).

Run: `ls lib/brain && find lib/brain -name '*.ts' -not -path 'lib/brain/core/*' -not -path 'lib/brain/adapters/*'`
Expected: `adapters  core  README.md` y ningún `.ts` suelto.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/README.md docs/01-roadmap-etapas.md
git commit -m "docs: README del módulo brain y cierre de la entrega 17.1" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión del plan

**Cobertura de la spec (§6 y §8, 17.1):**
- `core/` sin imports de afuera → Tareas 1, 2, 3 y el test de frontera.
- `adapters/` con Supabase, Next y la plataforma → Tarea 5.
- `list()` en el store y el editor leyendo por el proveedor → Tareas 4 y 6.
- README con migraciones, tests e interfaces que viajan (§6.4) → Tarea 7.
- "Terminado cuando": el test de frontera pasa (Tarea 1 en adelante), los tests existentes pasan con otra ubicación (cada tarea), `/brain` se ve igual (Tarea 6, paso 4, con la salvedad explícita).

**Lo que la spec no pedía y el plan sumó:** `history()` (Desvío 1), `extractBearer` local con test de paridad, `yaml` y `node:*` en la lista blanca. Todo documentado arriba.

**Consistencia de nombres:** `BrainConnection`, `BrainRole`, `BrainApprovalDecision`, `BrainRevision`, `OkEditorContext`, `extractBearer`, `UnauthorizedOptions`, `findViolations`, `list`, `history`, `listRevisions` se definen en la tarea que los produce y se usan con el mismo nombre en las siguientes.

**Riesgo conocido sin cobertura automática:** el cambio de cliente de sesión (RLS) a cliente admin en las lecturas del editor. Es seguro porque `resolveTenantAccess` ya verificó la membresía y el proveedor filtra por ese tenant (probado en `wiki-store.test.ts`), pero solo se ve de punta a punta con la base local (Tarea 6, paso 4).
