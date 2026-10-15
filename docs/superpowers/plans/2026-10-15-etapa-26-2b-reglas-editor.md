# Etapa 26.2b · Reglas en el editor web (pantallas) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quien edita el brain desde la web ve las reglas que gobiernan la página que escribe (panel "Reglas que aplican" en el editor y en "Nueva página"), abre o crea las instrucciones del brain y las reglas de cada carpeta desde el menú del árbol, y las reservadas dejan de aparecer como páginas comunes en el árbol y el índice, sin dejar de encontrarse en la búsqueda con la insignia "Reglas".

**Architecture:** Todo es lectura y presentación sobre el núcleo de la 26.2a: el contexto del editor suma una fuente de reglas filtrada por los permisos de la persona (`withoutSkillRules(withRulesAccess(getBrainRules(binding), ctx.access))`, la misma garantía que el MCP), un núcleo puro arma la vista del panel, el servidor la entrega lista en el editor y una server action la refresca en "Nueva página" cuando cambia la carpeta del slug. El árbol (`visibleTree`) deja de crear hojas para `00-reglas` y `00-plantilla` y las cuelga como marcas sin cuerpo de su carpeta. Lo que importan los componentes de cliente vive en módulos sin `node:crypto` (`reserved-slugs.ts`, `editor/reserved.ts`). El servidor no cambia, salvo el permiso de borrado de una reservada (Task 9): escribir una `00-reglas` desde la web ya funciona desde la 26.2a.

**Tech Stack:** Next.js 16 (App Router, server components y server actions), React 19, TypeScript, Tailwind + shadcn (tokens del tema por tenant), `react-markdown` vía `BrainMarkdown`, Vitest (+ happy-dom para el hook), Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` (§4.1 páginas reservadas, §4.3 fila "Editor web", §3.2 pantallas de carpetas, D3, D6, D10, D15). Se apoya en lo que dejó la 26.2a: `docs/superpowers/plans/2026-10-14-etapa-26-2a-reglas-nucleo.md` y `docs/dominios/brain.md` ("Instrucciones y reglas (etapa 26.2a)"). La 26.3 (§5) no entra: el árbol guarda la marca `template` (la `00-plantilla`) como gancho y nada más.

## Decisiones que la spec dejaba abiertas o que el código obligó a tomar

1. **El panel va arriba del papel, plegado, no a un costado.** La columna de contenido ya comparte la pantalla con el árbol (`lg:grid-cols-[260px_minmax(0,1fr)]`) y a 375 px un costado no existe. Es un `<details>` (sin JS ni almacenamiento) que muestra cuántas reglas aplican; si la ruta no tiene reglas, el panel no aparece.
2. **Cómo carga:** en el editor de una página y al abrir "Nueva página", el servidor arma la vista (`loadPageRulesPanel`, `loadNewPageRulesPanel`) y la pasa como prop. En "Nueva página" la ruta se escribe a mano, así que el hook `useFolderRules` pide la vista de nuevo con la server action `loadNewPageRules` cuando cambia la **carpeta** del slug (300 ms de espera, una respuesta vieja se descarta). La cascada de una página que no existe se pide con una hoja de sondeo (`<carpeta>/nueva-pagina`): `rulesFor` depende solo de la carpeta.
3. **Permisos del panel = permisos del MCP.** `ctx.rules` es `withoutSkillRules(withRulesAccess(...))` con `ctx.access`, el principal real del editor. Una ruta que la persona no ve no tiene panel (ni un byte de cuerpo); una `00-reglas` que gobierna lo que ve pero que no puede abrir llega en el panel **sin link** (spec §4.2). Bajo `skills/` no hay panel (las skills tienen el suyo y el canal de reglas las excluye). Un brain `mcp` no tiene contexto `ok` y no llega al editor (D15).
4. **Reservadas en el árbol:** `TreeNode` suma `rules` y `template` (mismos campos que `page`, sin cuerpo). `withoutArchived` conserva la marca aunque la `00-reglas` esté archivada, para que el menú la **abra** en vez de ofrecer crear una que choca con la existente; el indicador del árbol aparece solo si está `activo`. `countPages` no las cuenta: una carpeta con solo su `00-reglas` dice "Vacía", pero "Borrar carpeta" queda deshabilitado con el motivo, porque `brain_delete_folder` cuenta toda página bajo el prefijo.
5. **Abrir o crear:** el menú enlaza a `/brain/p/<carpeta>/00-reglas` si la página existe en cualquier estado, y si no a `/brain/nueva?reglas=1[&en=<carpeta>]` (sin `en`, la raíz), que arranca con el slug fijo, el título "Instrucciones del brain" o "Reglas de <carpeta>" y estado **Borrador**: una regla en borrador no aplica, y el aviso lo dice. El permiso es el de la 26.2a: administrador de la carpeta (de la raíz, para la raíz); el servidor ya lo exige (`withAccess`) y el proveedor ya guarda la de la raíz con la categoría `brain`. Las carpetas `skills/` no ofrecen reglas (una `skills/00-reglas` sería una página de categoría `skill`).
6. **Índice y búsqueda:** sin consulta, el índice (raíz y `?carpeta=`) no lista las reservadas; con consulta aparecen con la insignia "Reglas" (o "Plantilla"), como pide la spec. Quien edita una reservada sin administrar su carpeta la ve en **lectura** (`entryLevel`), en vez de un editor que no puede guardar.
7. **Módulos de cliente sin `node:crypto`:** `rules.ts` importa `node:crypto` y el árbol y el editor son componentes de cliente. Las funciones de nombres reservados pasan a `lib/brain/core/reserved-slugs.ts` (que `rules.ts` re-exporta, sin cambiar a nadie), y lo que usa la UI vive en `lib/brain/core/editor/reserved.ts`. Un test recorre los imports de esos módulos y falla si alguno llega a `node:*`. De `editor/rules-panel.ts` el cliente solo importa tipos.
8. **La categoría la muestra el editor como la calcula el servidor** (pulido 1): sale de la ruta (`pageCategory`), sin selector. "Nueva página" arranca en la carpeta pedida o en la primera carpeta editable que no sea `skills`.

### Desajustes entre la spec y el código

- La spec ubica el panel "al lado del editor"; va arriba del papel por la decisión 1.
- La spec (§3.2) pone "Reglas de la carpeta" en el menú de toda carpeta. Una carpeta implícita (con páginas pero sin fila en `brain_folders`) no ofrece acciones de carpeta desde la 26.1a, y sigue sin ofrecer esta: el proveedor `wiki` exige la fila del padre para crear `<sub>/<carpeta>/00-reglas`. Después del backfill de la 26.1a no debería haber carpetas implícitas.
- La spec dice "Borrar (solo si está vacía)". Para la base, una carpeta con su `00-reglas` (o una página archivada) no está vacía aunque el índice diga "Vacía": el menú lo explica en vez de dejar que el borrado falle.
- La spec no dice en qué estado nace una `00-reglas` creada desde la web; nace en borrador (decisión 5).

## Global Constraints

- Nombres reservados: `RESERVED_LEAVES = ["00-reglas", "00-plantilla"]`; la `00-reglas` de la raíz son las "Instrucciones del brain" y la de una carpeta, las "Reglas de <carpeta>". Topes en caracteres: raíz 12 000, carpeta 20 000 (se muestran; los exige el proveedor al guardar una activa).
- Escribir, crear o borrar una reservada exige `administrador` de su carpeta (de la raíz, para la de la raíz). Los permisos de la UI son solo experiencia: el servidor ya los exige (`withAccess`, `delete.ts`).
- El panel es informativo: el editor web **no** exige `rulesRevision` (spec §4.3, "No exige nada a las personas"). `savePage` no cambia.
- El panel nunca muestra el cuerpo de una regla a quien no ve la ruta pedida: siempre por `ctx.rules` (`withoutSkillRules(withRulesAccess(getBrainRules(binding), ctx.access))`).
- El cuerpo de una regla se muestra con `BrainMarkdown` (`components/brain/markdown.tsx`, sin `rehype-raw`). Nunca `dangerouslySetInnerHTML`.
- Un componente de cliente nunca importa `lib/brain/core/rules.ts`, `rules-source.ts` ni nada que llegue a `node:*`. De `lib/brain/core/editor/rules-panel.ts` importa solo con `import type`.
- `lib/brain/core/` no importa fuera de sí mismo: imports relativos con extensión `.ts`, solo `zod`, `yaml`, el SDK de MCP y `node:*` (`tests/brain/boundary.test.ts`).
- Solo el proveedor `wiki` tiene reglas (D15).
- UI en español rioplatense; código e identificadores en inglés. Design system primero: Tailwind + shadcn con los tokens del tema (`bg-muted`, `text-muted-foreground`, `text-destructive`, `bg-secondary`, `border`), sin colores hardcodeados. Toda vista nueva se ve bien a 375 px: objetivos táctiles `min-h-11` en móvil (`lg:min-h-0` o `lg:min-h-8` en escritorio, como el resto del brain).
- Nada específico de un tenant en código.
- `"use server"` es la primera sentencia de un archivo de server actions.
- Tests de lógica y de UI como `.test.ts` (sin JSX: `createElement`). Ningún test lee producción ni una base real.
- Comandos: `npx vitest run <archivos>` · `npm test` · `npm run typecheck` · formateo con `npx biome check --write <archivos tocados>` (no `npm run lint:fix`, que reformatea archivos ajenos; si se usa, `git status` y `git checkout -- <archivo>` de todo lo que la tarea no tocaba) · `npm run docs:sync` · `npm run docs:check`.
- Commits con prefijo (`feat:`, `fix:`, `test:`, `docs:`) y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identidad git `innovasbuild` / `matias@innov.as`. Sin push.
- La QA en navegador la hace una persona al cierre (sección "Cierre"); los subagentes no la pueden hacer.

## Review Focus

1. **Una `00-reglas` con HTML o un `<script>` en el cuerpo** se ve como texto en el panel, nunca se ejecuta ni se inyecta; el markdown común (negrita, listas, wikilinks) sí se renderiza. Lo fija el test "el cuerpo se muestra como markdown y el HTML queda como texto" de la Task 4.
2. **Un miembro que no ve la carpeta** abre "Nueva página" con `?en=` de esa carpeta, o escribe esa ruta en el slug, y no recibe panel ni ningún cuerpo de reglas. Lo fija el test "quien no ve la carpeta no recibe panel ni cuerpos" de la Task 3.
3. **Escribir el slug rápido en "Nueva página"** (cambiar de carpeta dos veces antes de que vuelva la primera respuesta) deja el panel con la última carpeta, no con una respuesta vieja. Lo fija el test "descarta una respuesta vieja" de la Task 4.
4. **Una `00-reglas` archivada:** el árbol no muestra el indicador, pero el menú "Reglas de la carpeta" la abre en vez de ofrecer crear otra (que chocaría con "Ya existe una página con ese slug"). Lo fija el test "una 00-reglas archivada no muestra la marca pero el menú la abre" de la Task 6.
5. **Una carpeta con solo su `00-reglas`** sigue en el árbol y el índice como carpeta, cuenta 0 páginas, y "Borrar carpeta" aparece deshabilitado con el motivo. Lo fijan el test "una carpeta con solo su 00-reglas sigue siendo carpeta y cuenta 0 páginas" de la Task 2 y el test "una carpeta con solo reglas no se ofrece para borrar y dice por qué" de la Task 6.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/brain/core/reserved-slugs.ts` (nuevo) | Nombres reservados sin `node:crypto`: `leafOf`, `isReservedSlug`, `isRulesSlug`, `isTemplateSlug`, `rulesSlugFor`, `folderOfPage`, `rulesCharLimit` |
| `lib/brain/core/rules.ts` | Re-exporta lo de arriba; `checkRulesWrite` usa `rulesCharLimit` |
| `lib/brain/core/editor/reserved.ts` (nuevo) | Puro y apto para cliente: títulos, aviso, insignia, links de abrir o crear, página nueva de reglas, carpeta del slug, listado del índice, nivel de entrada |
| `lib/brain/core/access/tree.ts` | Reservadas como marcas `rules`/`template` de su carpeta; `countPages`; `folderDeleteBlocks` |
| `lib/brain/core/editor/rules-panel.ts` (nuevo) | Vista del panel (`RulesPanelView`), `editorRules`, `loadRulesPanel`, `loadFolderRulesPanel`, `probeSlugFor` |
| `lib/brain/adapters/editor.ts` | `ctx.rules`; `loadPageRulesPanel`, `loadNewPageRulesPanel` |
| `app/[tenant]/brain/rules-actions.ts` (nuevo) | Server action `loadNewPageRules` |
| `components/brain/rules-panel.tsx` (nuevo) | `RulesPanel` y el hook `useFolderRules` |
| `components/brain/reserved-notice.tsx` (nuevo) | Aviso de página reservada con contador de caracteres |
| `components/brain/editor/page-workspace.tsx` | Panel, aviso, slug fijo, categoría derivada de la ruta |
| `app/[tenant]/brain/p/[...slug]/page.tsx`, `app/[tenant]/brain/nueva/page.tsx` | Arman la vista del panel; `?reglas=1`; nivel de entrada de una reservada |
| `components/brain/tree-row-menu.tsx`, `components/brain/brain-tree.tsx` | "Instrucciones del brain", "Reglas de la carpeta", indicador, borrar deshabilitado con motivo |
| `app/[tenant]/brain/page.tsx`, `components/brain/page-list.tsx` | Índice sin reservadas fuera de la búsqueda; insignia "Reglas" |
| `lib/brain/core/editor/page-category.ts` (nuevo), `lib/brain/core/editor/new-page.ts` | Categoría derivada de la ruta; "Nueva página" arranca en una carpeta |
| `lib/brain/core/editor/delete.ts` | Borrar una reservada exige administrar su carpeta |
| `tests/brain/client-safe.ts` (nuevo, helper) | Recorre los imports de runtime de un módulo |
| `docs/dominios/brain.md`, `lib/brain/README.md`, `docs/producto/roadmap.md` | Documentación |

---

### Task 1: Núcleo de las reservadas apto para el cliente

**Files:**
- Create: `lib/brain/core/reserved-slugs.ts`
- Modify: `lib/brain/core/rules.ts` (imports, funciones de nombres, `checkRulesWrite`)
- Create: `lib/brain/core/editor/reserved.ts`
- Create: `tests/brain/client-safe.ts`
- Test: `tests/brain/editor-reserved.test.ts` (nuevo)

**Interfaces:**
- Consumes: `parentPath(path: string): string | null` de `lib/brain/core/access/resolve-access.ts` (`parentPath("a") === ""`, `parentPath("") === null`); `ROOT_PATH = ""`, `type Level = "lector" | "editor" | "administrador"` de `lib/brain/core/access/types.ts`; de `lib/brain/core/types.ts`: `RULES_LEAF`, `TEMPLATE_LEAF`, `RESERVED_LEAVES`, `MAX_ROOT_RULES_CHARS`, `MAX_FOLDER_RULES_CHARS`, `MAX_CASCADE_CHARS`, `SLUG_PATTERN`, `MAX_SLUG_LENGTH`; `SKILLS_PREFIX = "skills/"` de `lib/brain/core/skills/package.ts`; `pageHref(tenantSlug: string, pageSlug: string): string` de `lib/brain/core/editor/slug.ts` (`/${tenantSlug}/brain/p/${pageSlug}`).
- Produces:
  - En `reserved-slugs.ts`: `leafOf(slug: string): string`, `isReservedSlug(slug: string): boolean`, `isRulesSlug(slug: string): boolean`, `isTemplateSlug(slug: string): boolean`, `rulesSlugFor(folder: string): string`, `folderOfPage(slug: string): string`, `rulesCharLimit(slug: string): number | null`. `rules.ts` re-exporta las siete (son las mismas funciones).
  - En `editor/reserved.ts`: `RULES_LOAD_ERROR: string`, `rulesTitle(folder: string): string`, `interface ReservedNotice { title: string; text: string; limit: number | null }`, `reservedNotice(slug: string): ReservedNotice | null`, `reservedBadge(slug: string): "Reglas" | "Plantilla" | null`, `isSkillsFolder(folder: string): boolean`, `newRulesHref(tenantSlug: string, folder: string): string`, `rulesEntryHref(tenantSlug: string, node: { path: string; rules: { slug: string } | null }): string`, `resolveNewRulesPage(en: string | undefined, levelOf: (path: string) => Level | null): { slug: string; title: string } | null`, `typedFolder(slug: string): string | null`, `listedInIndex<T extends { slug: string }>(pages: readonly T[], searching: boolean): T[]`, `entryLevel(slug: string, levelOf: (path: string) => Level | null): Level | null`.
  - En `tests/brain/client-safe.ts`: `runtimePackages(entry: string): string[]` (ruta relativa a la raíz del repo; devuelve los paquetes no locales que el módulo alcanza por imports de runtime, ordenados y sin repetir).

- [ ] **Step 1: Escribir el helper de imports**

```ts
// tests/brain/client-safe.ts
// Paquetes que alcanza un módulo por imports de runtime (no `import type`),
// siguiendo los relativos y el alias @/. Sirve para verificar que lo que usa
// un componente de cliente no arrastra node:*. Corta en los paquetes y en los
// archivos "use server" (en el cliente son solo referencias).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;

function localFile(from: string, spec: string): string | null {
	const base = spec.startsWith("@/")
		? join(ROOT, spec.slice(2))
		: spec.startsWith(".")
			? resolve(dirname(from), spec)
			: null;
	if (base === null) return null;
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")])
		if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
	return null;
}

export function runtimePackages(entry: string): string[] {
	const packages = new Set<string>();
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const source = readFileSync(file, "utf8");
		if (/^\s*["']use server["']/.test(source)) return;
		for (const match of source.matchAll(IMPORT)) {
			const spec = match[1];
			const local = localFile(file, spec);
			if (local) walk(local);
			else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
		}
	};
	walk(join(ROOT, entry));
	return [...packages].sort();
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// tests/brain/editor-reserved.test.ts
import { describe, expect, it } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import {
	entryLevel,
	isSkillsFolder,
	listedInIndex,
	newRulesHref,
	reservedBadge,
	reservedNotice,
	resolveNewRulesPage,
	rulesEntryHref,
	rulesTitle,
	typedFolder,
} from "@/lib/brain/core/editor/reserved";
import * as reservedSlugs from "@/lib/brain/core/reserved-slugs";
import * as rules from "@/lib/brain/core/rules";
import { runtimePackages } from "./client-safe";

const every =
	(level: Level | null) =>
	(_path: string): Level | null =>
		level;

describe("reserved-slugs", () => {
	it("el tope de caracteres: 12 000 la raíz, 20 000 una carpeta, ninguno lo demás", () => {
		expect(reservedSlugs.rulesCharLimit("00-reglas")).toBe(12_000);
		expect(reservedSlugs.rulesCharLimit("talento/personal/00-reglas")).toBe(20_000);
		expect(reservedSlugs.rulesCharLimit("comercial/00-plantilla")).toBeNull();
		expect(reservedSlugs.rulesCharLimit("comercial/icp")).toBeNull();
	});

	it("reconoce la plantilla", () => {
		expect(reservedSlugs.isTemplateSlug("comercial/00-plantilla")).toBe(true);
		expect(reservedSlugs.isTemplateSlug("comercial/00-reglas")).toBe(false);
	});

	it("rules.ts re-exporta las mismas funciones", () => {
		expect(rules.isReservedSlug).toBe(reservedSlugs.isReservedSlug);
		expect(rules.isRulesSlug).toBe(reservedSlugs.isRulesSlug);
		expect(rules.folderOfPage).toBe(reservedSlugs.folderOfPage);
		expect(rules.rulesSlugFor).toBe(reservedSlugs.rulesSlugFor);
		expect(rules.leafOf).toBe(reservedSlugs.leafOf);
	});
});

describe("lo que importa el cliente no llega a node:*", () => {
	it.each([
		"lib/brain/core/reserved-slugs.ts",
		"lib/brain/core/editor/reserved.ts",
	])("%s", (entry) => {
		expect(runtimePackages(entry).filter((p) => p.startsWith("node:"))).toEqual(
			[],
		);
	});

	it("el detector ve el node:crypto de rules.ts", () => {
		expect(runtimePackages("lib/brain/core/rules.ts")).toContain("node:crypto");
	});
});

describe("títulos y avisos", () => {
	it("nombra las instrucciones del brain y las reglas de una carpeta", () => {
		expect(rulesTitle("")).toBe("Instrucciones del brain");
		expect(rulesTitle("talento/personal")).toBe("Reglas de talento/personal");
	});

	it("avisa qué gobierna cada reservada y con qué tope", () => {
		expect(reservedNotice("00-reglas")).toMatchObject({
			title: "Instrucciones del brain",
			limit: 12_000,
		});
		expect(reservedNotice("00-reglas")?.text).toContain("todo el brain");
		const folder = reservedNotice("talento/personal/00-reglas");
		expect(folder).toMatchObject({
			title: "Reglas de talento/personal",
			limit: 20_000,
		});
		expect(folder?.text).toContain("talento/personal");
		expect(folder?.text).toContain("el asistente del chat nunca las escribe");
		expect(reservedNotice("comercial/00-plantilla")).toMatchObject({
			title: "Plantilla de comercial",
			limit: null,
		});
	});

	it("una página común no tiene aviso ni insignia", () => {
		expect(reservedNotice("comercial/icp")).toBeNull();
		expect(reservedNotice("talento/00-reglas-viejas")).toBeNull();
		expect(reservedBadge("comercial/icp")).toBeNull();
	});

	it("la insignia de la búsqueda", () => {
		expect(reservedBadge("00-reglas")).toBe("Reglas");
		expect(reservedBadge("talento/personal/00-reglas")).toBe("Reglas");
		expect(reservedBadge("comercial/00-plantilla")).toBe("Plantilla");
	});
});

describe("abrir o crear", () => {
	it("skills/ y lo que cuelga no tienen reglas propias desde la web", () => {
		expect(isSkillsFolder("skills")).toBe(true);
		expect(isSkillsFolder("skills/facturacion")).toBe(true);
		expect(isSkillsFolder("skillset")).toBe(false);
		expect(isSkillsFolder("")).toBe(false);
	});

	it("sin reglas, el link crea; con reglas en cualquier estado, abre", () => {
		expect(newRulesHref("acme", "")).toBe("/acme/brain/nueva?reglas=1");
		expect(newRulesHref("acme", "comercial")).toBe(
			"/acme/brain/nueva?reglas=1&en=comercial",
		);
		expect(rulesEntryHref("acme", { path: "comercial", rules: null })).toBe(
			"/acme/brain/nueva?reglas=1&en=comercial",
		);
		expect(
			rulesEntryHref("acme", {
				path: "comercial",
				rules: { slug: "comercial/00-reglas" },
			}),
		).toBe("/acme/brain/p/comercial/00-reglas");
	});

	it("la página nueva de reglas la arma solo quien administra la carpeta", () => {
		expect(resolveNewRulesPage(undefined, every("administrador"))).toEqual({
			slug: "00-reglas",
			title: "Instrucciones del brain",
		});
		expect(resolveNewRulesPage("", every("administrador"))).toEqual({
			slug: "00-reglas",
			title: "Instrucciones del brain",
		});
		expect(
			resolveNewRulesPage("talento/personal", every("administrador")),
		).toEqual({
			slug: "talento/personal/00-reglas",
			title: "Reglas de talento/personal",
		});
		expect(resolveNewRulesPage("comercial", every("editor"))).toBeNull();
		expect(resolveNewRulesPage("comercial", every(null))).toBeNull();
		expect(resolveNewRulesPage("../x", every("administrador"))).toBeNull();
		expect(resolveNewRulesPage("skills", every("administrador"))).toBeNull();
	});
});

describe("typedFolder", () => {
	it("devuelve la carpeta de lo que se está escribiendo", () => {
		expect(typedFolder("comercial/")).toBe("comercial");
		expect(typedFolder("comercial/sub/x")).toBe("comercial/sub");
		expect(typedFolder("suelta")).toBe("");
		expect(typedFolder("")).toBe("");
	});

	it("null mientras la carpeta no es una ruta válida", () => {
		expect(typedFolder("Comercial/x")).toBeNull();
		expect(typedFolder("comercial//x")).toBeNull();
		expect(typedFolder("-x/y")).toBeNull();
	});
});

describe("listedInIndex", () => {
	const pages = [
		{ slug: "00-reglas" },
		{ slug: "comercial/icp" },
		{ slug: "comercial/00-reglas" },
		{ slug: "comercial/00-plantilla" },
	];

	it("sin búsqueda saca las reservadas", () => {
		expect(listedInIndex(pages, false).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
	});

	it("con búsqueda las deja", () => {
		expect(listedInIndex(pages, true)).toHaveLength(4);
	});
});

describe("entryLevel", () => {
	it("una reservada se edita solo administrando su carpeta; si no, se lee", () => {
		expect(entryLevel("comercial/00-reglas", every("editor"))).toBe("lector");
		expect(entryLevel("comercial/00-reglas", every("administrador"))).toBe(
			"administrador",
		);
		expect(entryLevel("comercial/icp", every("editor"))).toBe("editor");
		expect(entryLevel("comercial/00-reglas", every(null))).toBeNull();
	});

	it("mira la carpeta, no la página", () => {
		const levelOf = (path: string): Level | null =>
			path === "comercial/00-reglas" ? "administrador" : "editor";
		expect(entryLevel("comercial/00-reglas", levelOf)).toBe("lector");
	});
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/editor-reserved.test.ts`
Expected: FAIL (`Cannot find module '@/lib/brain/core/editor/reserved'`).

- [ ] **Step 4: Crear `reserved-slugs.ts`**

```ts
// lib/brain/core/reserved-slugs.ts
// Nombres reservados del brain (spec etapa 26 §4.1). Sin node:crypto: los
// importan también componentes de cliente (árbol, editor). rules.ts los
// re-exporta para los que ya los usaban desde ahí.
import { parentPath } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import {
	MAX_FOLDER_RULES_CHARS,
	MAX_ROOT_RULES_CHARS,
	RESERVED_LEAVES,
	RULES_LEAF,
	TEMPLATE_LEAF,
} from "./types.ts";

export function leafOf(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

export function isReservedSlug(slug: string): boolean {
	return (RESERVED_LEAVES as readonly string[]).includes(leafOf(slug));
}

export function isRulesSlug(slug: string): boolean {
	return leafOf(slug) === RULES_LEAF;
}

export function isTemplateSlug(slug: string): boolean {
	return leafOf(slug) === TEMPLATE_LEAF;
}

export function rulesSlugFor(folder: string): string {
	return folder === ROOT_PATH ? RULES_LEAF : `${folder}/${RULES_LEAF}`;
}

/** Carpeta en la que vive una página; "" para una de la raíz. */
export function folderOfPage(slug: string): string {
	return parentPath(slug) ?? ROOT_PATH;
}

/** Tope de una 00-reglas activa; null si la página no es una 00-reglas. */
export function rulesCharLimit(slug: string): number | null {
	if (!isRulesSlug(slug)) return null;
	return folderOfPage(slug) === ROOT_PATH
		? MAX_ROOT_RULES_CHARS
		: MAX_FOLDER_RULES_CHARS;
}
```

- [ ] **Step 5: Pasar `rules.ts` a usarlo**

En `lib/brain/core/rules.ts`, reemplazar el bloque de imports (las líneas desde `import { createHash } from "node:crypto";` hasta el cierre del import de `./types.ts`) por:

```ts
import { createHash } from "node:crypto";
import { ancestorChain } from "./access/resolve-access.ts";
import { ROOT_PATH } from "./access/types.ts";
import { BrainValidation } from "./errors.ts";
import {
	folderOfPage,
	isRulesSlug,
	rulesCharLimit,
	rulesSlugFor,
} from "./reserved-slugs.ts";
import {
	type BrainStatus,
	MAX_CASCADE_CHARS,
	MAX_FOLDER_RULES_CHARS,
} from "./types.ts";

export {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
	isTemplateSlug,
	leafOf,
	rulesCharLimit,
	rulesSlugFor,
} from "./reserved-slugs.ts";
```

Borrar de `rules.ts` las definiciones de `leafOf`, `isReservedSlug`, `isRulesSlug`, `rulesSlugFor` y `folderOfPage` (con el comentario `/** Carpeta en la que vive una página; "" para una de la raíz. */`). En `checkRulesWrite`, reemplazar:

```ts
	const folder = folderOfPage(write.slug);
	const limit =
		folder === ROOT_PATH ? MAX_ROOT_RULES_CHARS : MAX_FOLDER_RULES_CHARS;
```

por:

```ts
	const folder = folderOfPage(write.slug);
	// isRulesSlug ya pasó: el tope existe.
	const limit = rulesCharLimit(write.slug) ?? MAX_FOLDER_RULES_CHARS;
```

- [ ] **Step 6: Crear `editor/reserved.ts`**

```ts
// lib/brain/core/editor/reserved.ts
// Cómo se muestran las páginas reservadas en el editor web (spec etapa 26
// §4.1, §4.3). Puro y sin node:crypto ni rules.ts: lo importan componentes
// de cliente (árbol, menú, editor). Los permisos son solo experiencia: el
// servidor los exige igual (withAccess, delete.ts).
import { type Level, ROOT_PATH } from "../access/types.ts";
import {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
	isTemplateSlug,
	rulesCharLimit,
	rulesSlugFor,
} from "../reserved-slugs.ts";
import { SKILLS_PREFIX } from "../skills/package.ts";
import { MAX_SLUG_LENGTH, RULES_LEAF, SLUG_PATTERN } from "../types.ts";
import { pageHref } from "./slug.ts";

export const RULES_LOAD_ERROR =
	"No se pudieron leer las reglas de esta carpeta. Guardar no depende de ellas.";

// Una carpeta deja lugar para "/00-reglas" dentro del largo máximo de un slug.
const MAX_FOLDER_PATH = MAX_SLUG_LENGTH - RULES_LEAF.length - 1;

export function rulesTitle(folder: string): string {
	return folder === ROOT_PATH ? "Instrucciones del brain" : `Reglas de ${folder}`;
}

export interface ReservedNotice {
	title: string;
	text: string;
	/** Tope de caracteres de una 00-reglas; null para la plantilla. */
	limit: number | null;
}

const ROOT_TEXT =
	"Le llegan a todo asistente al arrancar una sesión, en el chat y por MCP, y valen para todo el brain. Solo las edita quien administra la raíz, y el asistente del chat nunca las escribe. Aplican cuando el estado es Activo.";
const TEMPLATE_TEXT =
	"Es una página reservada de la carpeta: solo la edita quien la administra, y el asistente del chat nunca la escribe.";

function folderText(folder: string): string {
	return `Gobiernan a quien escribe en ${folder} y en sus subcarpetas: por MCP, nadie escribe ahí sin haberlas leído. Solo las edita quien administra la carpeta, y el asistente del chat nunca las escribe. Aplican cuando el estado es Activo.`;
}

export function reservedNotice(slug: string): ReservedNotice | null {
	if (!isReservedSlug(slug)) return null;
	const folder = folderOfPage(slug);
	if (isRulesSlug(slug))
		return {
			title: rulesTitle(folder),
			text: folder === ROOT_PATH ? ROOT_TEXT : folderText(folder),
			limit: rulesCharLimit(slug),
		};
	return {
		title:
			folder === ROOT_PATH ? "Plantilla del brain" : `Plantilla de ${folder}`,
		text: TEMPLATE_TEXT,
		limit: null,
	};
}

export function reservedBadge(slug: string): "Reglas" | "Plantilla" | null {
	if (isRulesSlug(slug)) return "Reglas";
	if (isTemplateSlug(slug)) return "Plantilla";
	return null;
}

// Una skills/00-reglas sería una página de categoría skill (spec 24.1 S3): las
// carpetas de skills no ofrecen reglas propias desde la web.
export function isSkillsFolder(folder: string): boolean {
	return `${folder}/`.startsWith(SKILLS_PREFIX);
}

export function newRulesHref(tenantSlug: string, folder: string): string {
	return folder === ROOT_PATH
		? `/${tenantSlug}/brain/nueva?reglas=1`
		: `/${tenantSlug}/brain/nueva?reglas=1&en=${folder}`;
}

// Abre la 00-reglas si existe en cualquier estado (una archivada se reactiva
// desde el editor); si no, la crea. Crear una que ya existe chocaría.
export function rulesEntryHref(
	tenantSlug: string,
	node: { path: string; rules: { slug: string } | null },
): string {
	return node.rules
		? pageHref(tenantSlug, node.rules.slug)
		: newRulesHref(tenantSlug, node.path);
}

// ?reglas=1&en=<carpeta> de "Nueva página": sin en, la raíz.
export function resolveNewRulesPage(
	en: string | undefined,
	levelOf: (path: string) => Level | null,
): { slug: string; title: string } | null {
	const folder = en ?? ROOT_PATH;
	if (
		folder !== ROOT_PATH &&
		(folder.length > MAX_FOLDER_PATH || !SLUG_PATTERN.test(folder))
	)
		return null;
	if (isSkillsFolder(folder) || levelOf(folder) !== "administrador") return null;
	return { slug: rulesSlugFor(folder), title: rulesTitle(folder) };
}

// Carpeta del slug que se está escribiendo en "Nueva página"; null mientras no
// es una ruta válida.
export function typedFolder(slug: string): string | null {
	const cut = slug.lastIndexOf("/");
	if (cut === -1) return ROOT_PATH;
	const folder = slug.slice(0, cut);
	return folder.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(folder)
		? folder
		: null;
}

// El índice no mezcla las reservadas con las páginas comunes; la búsqueda sí
// las encuentra (spec etapa 26 §4.1).
export function listedInIndex<T extends { slug: string }>(
	pages: readonly T[],
	searching: boolean,
): T[] {
	return searching
		? [...pages]
		: pages.filter((page) => !isReservedSlug(page.slug));
}

// Con qué nivel se entra a una página: una reservada se edita solo
// administrando su carpeta; si no, se lee (no se ofrece un editor que no
// puede guardar).
export function entryLevel(
	slug: string,
	levelOf: (path: string) => Level | null,
): Level | null {
	const level = levelOf(slug);
	if (level === null || !isReservedSlug(slug)) return level;
	return levelOf(folderOfPage(slug)) === "administrador" ? level : "lector";
}
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/editor-reserved.test.ts tests/brain/rules.test.ts tests/brain/boundary.test.ts tests/brain/wiki-rules.test.ts tests/brain/access-with-access.test.ts`
Expected: PASS (los de `rules.test.ts` y `wiki-rules.test.ts` siguen verdes con las funciones movidas).

- [ ] **Step 8: Typecheck y formato**

Run: `npm run typecheck && npx biome check --write lib/brain/core/reserved-slugs.ts lib/brain/core/rules.ts lib/brain/core/editor/reserved.ts tests/brain/client-safe.ts tests/brain/editor-reserved.test.ts`
Expected: sin errores. Si biome marca imports sin usar en `rules.ts` (`MAX_ROOT_RULES_CHARS`, `RESERVED_LEAVES`, `RULES_LEAF`, `parentPath`), es que quedaron del bloque viejo: sacarlos.

- [ ] **Step 9: Commit**

```bash
git add lib/brain/core/reserved-slugs.ts lib/brain/core/rules.ts lib/brain/core/editor/reserved.ts tests/brain/client-safe.ts tests/brain/editor-reserved.test.ts
git commit -m "feat: núcleo de las páginas reservadas apto para el cliente (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: El árbol cuelga las reservadas de su carpeta

**Files:**
- Modify: `lib/brain/core/access/tree.ts` (`TreeNode`, `visibleTree`, `isFolderNode`, `withoutArchived`; nueva `countPages`)
- Modify: `tests/brain/tree-row-menu.test.ts` (helper `node`)
- Test: `tests/brain/access-tree.test.ts`

**Interfaces:**
- Consumes: de `lib/brain/core/reserved-slugs.ts` (Task 1): `folderOfPage(slug: string): string`, `isReservedSlug(slug: string): boolean`, `isRulesSlug(slug: string): boolean`.
- Produces: `TreeNode` con dos campos nuevos, `rules: TreePage | null` (la `00-reglas` de la carpeta) y `template: TreePage | null` (la `00-plantilla`); para la raíz, `root.rules` es la `00-reglas` de la raíz. Las reservadas ya no son hojas (`page`) de nadie. `isFolderNode(node)` es true también si el nodo tiene `rules` o `template`. `withoutArchived` conserva las marcas, también archivadas. `countPages(node: TreeNode): number` (páginas comunes del nodo y lo que cuelga, sin reservadas).

- [ ] **Step 1: Escribir el test que falla**

Al final de `tests/brain/access-tree.test.ts`, agregar `countPages` al import de `@/lib/brain/core/access/tree` y este bloque:

```ts
describe("páginas reservadas", () => {
	const all = () => "lector" as const;

	it("una 00-reglas no es una hoja: marca su carpeta, sin cuerpo", () => {
		const root = visibleTree(
			[
				page("comercial/icp"),
				page("comercial/00-reglas"),
				page("00-reglas"),
			],
			all,
			[{ path: "comercial", description: "" }],
		);
		expect(root.children.map((n) => n.path)).toEqual(["comercial"]);
		expect(root.rules).toEqual({
			slug: "00-reglas",
			title: "00-reglas",
			status: "activo",
		});
		const comercial = root.children[0];
		expect(comercial.children.map((n) => n.path)).toEqual(["comercial/icp"]);
		expect(comercial.rules?.slug).toBe("comercial/00-reglas");
		expect(comercial.template).toBeNull();
		expect(JSON.stringify(root)).not.toContain("contenido que no debe viajar");
	});

	it("la 00-plantilla tampoco se lista y queda como template", () => {
		const root = visibleTree([page("comercial/00-plantilla")], all, [
			{ path: "comercial", description: "" },
		]);
		expect(root.children[0].children).toEqual([]);
		expect(root.children[0].template?.slug).toBe("comercial/00-plantilla");
	});

	it("una carpeta con solo su 00-reglas sigue siendo carpeta y cuenta 0 páginas", () => {
		const root = visibleTree([page("talento/personal/00-reglas")], all, [
			{ path: "talento", description: "" },
			{ path: "talento/personal", description: "" },
		]);
		const clean = withoutArchived(root);
		const personal = clean.children[0].children[0];
		expect(personal.path).toBe("talento/personal");
		expect(isFolderNode(personal)).toBe(true);
		expect(personal.rules?.slug).toBe("talento/personal/00-reglas");
		expect(countPages(clean.children[0])).toBe(0);
	});

	it("una carpeta implícita con solo una 00-reglas archivada se poda; con una activa, no", () => {
		const archived = visibleTree([page("x/00-reglas", "archivado")], all);
		expect(withoutArchived(archived).children).toEqual([]);
		const active = visibleTree([page("x/00-reglas")], all);
		expect(withoutArchived(active).children.map((n) => n.path)).toEqual(["x"]);
	});

	it("withoutArchived conserva la marca de una 00-reglas archivada", () => {
		const root = visibleTree([page("comercial/00-reglas", "archivado")], all, [
			{ path: "comercial", description: "" },
		]);
		expect(withoutArchived(root).children[0].rules?.status).toBe("archivado");
	});

	it("quien no ve la 00-reglas no recibe la marca", () => {
		const access = (path: string) =>
			path === "comercial/00-reglas" ? null : ("lector" as const);
		const root = visibleTree([page("comercial/00-reglas")], access, [
			{ path: "comercial", description: "" },
		]);
		expect(root.children[0].rules).toBeNull();
	});

	it("countPages no suma las reservadas", () => {
		const root = visibleTree(
			[
				page("comercial/icp"),
				page("comercial/sub/a"),
				page("comercial/00-reglas"),
				page("comercial/sub/00-plantilla"),
			],
			all,
		);
		expect(countPages(root.children[0])).toBe(2);
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/access-tree.test.ts`
Expected: FAIL (`countPages` no existe; `root.rules` es `undefined`).

- [ ] **Step 3: Implementar en `tree.ts`**

Imports: agregar debajo de `import type { BrainFolder } from "../folders.ts";`:

```ts
import { folderOfPage, isReservedSlug, isRulesSlug } from "../reserved-slugs.ts";
```

En `interface TreeNode`, después del campo `folder`:

```ts
	// 00-reglas y 00-plantilla de esta carpeta (spec etapa 26 §4.1): no se
	// listan como hijas; el menú las abre. Sin cuerpo, como page. En la raíz,
	// rules son las instrucciones del brain.
	rules: TreePage | null;
	template: TreePage | null;
```

`isFolderNode` queda:

```ts
export function isFolderNode(node: TreeNode): boolean {
	return (
		node.path === ROOT_PATH ||
		node.folder !== null ||
		node.rules !== null ||
		node.template !== null ||
		node.children.length > 0
	);
}
```

En `visibleTree`, los dos literales de nodo (`root` y el de `ensure`) suman `rules: null, template: null,` después de `folder: null,`. El bucle de páginas queda:

```ts
	for (const page of pages) {
		if (access(page.slug) === null) continue;
		// Solo estos campos viajan al navegador: nunca el cuerpo.
		const shown: TreePage = {
			slug: page.slug,
			title: page.title,
			status: page.status,
			...(page.pending ? { pending: true } : {}),
		};
		if (isReservedSlug(page.slug)) {
			const folder = ensure(folderOfPage(page.slug));
			if (isRulesSlug(page.slug)) folder.rules = shown;
			else folder.template = shown;
			continue;
		}
		ensure(page.slug).page = shown;
	}
```

`withoutArchived` queda:

```ts
// Oculta las archivadas y las carpetas que quedan sin nada visible. Las marcas
// de reservadas se conservan aunque estén archivadas (el menú las abre en vez
// de ofrecer crear otra); una carpeta sin otra cosa que una archivada se poda.
export function withoutArchived(root: TreeNode): TreeNode {
	const live = (reserved: TreePage | null) =>
		reserved !== null && reserved.status !== "archivado";
	const prune = (node: TreeNode): TreeNode | null => {
		const children = node.children
			.map(prune)
			.filter((child): child is TreeNode => child !== null);
		const page = node.page?.status === "archivado" ? null : node.page;
		if (
			node.path !== ROOT_PATH &&
			page === null &&
			children.length === 0 &&
			node.folder === null &&
			!live(node.rules) &&
			!live(node.template)
		) {
			return null;
		}
		return { ...node, page, children };
	};
	return prune(root) ?? { ...root, page: null, children: [] };
}
```

Y al final del archivo:

```ts
// Páginas comunes del nodo y de lo que cuelga: las reservadas no son páginas
// del listado (una carpeta con solo su 00-reglas está "Vacía").
export function countPages(node: TreeNode): number {
	return (
		(node.page ? 1 : 0) +
		node.children.reduce((sum, child) => sum + countPages(child), 0)
	);
}
```

- [ ] **Step 4: Ajustar el helper del test del menú**

En `tests/brain/tree-row-menu.test.ts`, el helper `node` suma los campos nuevos:

```ts
const node = (over: Partial<TreeNode>): TreeNode => ({
	path: "comercial",
	name: "comercial",
	page: null,
	folder: { description: "" },
	rules: null,
	template: null,
	level: "administrador",
	children: [],
	...over,
});
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/access-tree.test.ts tests/brain/tree-row-menu.test.ts tests/brain/editor-tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, formato y commit**

Run: `npm run typecheck && npx biome check --write lib/brain/core/access/tree.ts tests/brain/access-tree.test.ts tests/brain/tree-row-menu.test.ts`
Expected: sin errores.

```bash
git add lib/brain/core/access/tree.ts tests/brain/access-tree.test.ts tests/brain/tree-row-menu.test.ts
git commit -m "feat: el árbol del brain cuelga las reservadas de su carpeta (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Carga de las reglas para el editor

**Files:**
- Create: `lib/brain/core/editor/rules-panel.ts`
- Modify: `lib/brain/adapters/editor.ts` (`EditorContext`, `loadEditorContext`, funciones nuevas)
- Create: `app/[tenant]/brain/rules-actions.ts`
- Test: `tests/brain/editor-rules-panel.test.ts` (nuevo), `tests/brain/rules-actions.test.ts` (nuevo), `tests/brain/editor-adapter.test.ts`

**Interfaces:**
- Consumes: de `lib/brain/core/rules-source.ts`: `interface RulesSource { cascade(slug: string): Promise<RulesCascade>; session(): Promise<BrainSessionContext> }`, `createWikiRules`, `withRulesAccess(source: RulesSource, levelOf: (path: string) => Level | null): RulesSource` (lanza `BrainNotFound` si `levelOf(slug) === null`), `withoutSkillRules(source: RulesSource): RulesSource` (lanza `BrainNotFound` bajo `skills/`). `RulesCascade.chain: Array<{ path: string; slug: string; revision: number; body: string }>`. `getBrainRules(binding: BrainBinding): RulesSource` de `lib/brain/adapters/rules.ts`. De Task 1: `rulesTitle(folder: string): string`, `RULES_LOAD_ERROR: string`. `BrainNotFound`, `BrainValidation` de `lib/brain/core/errors.ts`.
- Produces:
  - En `rules-panel.ts`: `interface RulesPanelEntry { path: string; slug: string; title: string; body: string; visible: boolean }`, `type RulesPanelView = { kind: "rules"; entries: RulesPanelEntry[] } | { kind: "error"; message: string }`, `PROBE_LEAF = "nueva-pagina"`, `probeSlugFor(folder: string): string`, `editorRules(source: RulesSource, levelOf: (path: string) => Level | null): RulesSource`, `loadRulesPanel(source: RulesSource, slug: string, levelOf: (path: string) => Level | null, onError: (error: unknown) => void): Promise<RulesPanelView | null>`, `loadFolderRulesPanel(source: RulesSource, folder: string, levelOf: (path: string) => Level | null, onError: (error: unknown) => void): Promise<RulesPanelView | null>`. `null` = sin panel.
  - En `adapters/editor.ts`: `OkEditorContext.rules: RulesSource` (ya filtrada), `loadPageRulesPanel(ctx: OkEditorContext, slug: string): Promise<RulesPanelView | null>`, `loadNewPageRulesPanel(ctx: OkEditorContext, folder: string): Promise<RulesPanelView | null>`.
  - Server action `loadNewPageRules(raw: unknown): Promise<RulesPanelView | null>` con input `{ tenantSlug: string; folder: string }`.

- [ ] **Step 1: Escribir el test del núcleo que falla**

```ts
// tests/brain/editor-rules-panel.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import {
	editorRules,
	loadFolderRulesPanel,
	loadRulesPanel,
	probeSlugFor,
} from "@/lib/brain/core/editor/rules-panel";
import type { RulePage } from "@/lib/brain/core/rules";
import { createWikiRules } from "@/lib/brain/core/rules-source";

const rule = (slug: string, body = `cuerpo de ${slug}`): RulePage => ({
	slug,
	status: "activo",
	revision: 1,
	body,
});

const PAGES = [
	rule("00-reglas", "cuerpo de la raíz"),
	rule("talento/personal/00-reglas", "cuerpo de personal"),
	rule("skills/00-reglas", "cuerpo de skills"),
];

const source = (pages: RulePage[] = PAGES) =>
	createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async () => pages,
			listFolders: async () => [],
		},
	});

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "user",
	userId: "ana",
	level,
});
const ana: Principal = { kind: "user", userId: "ana", role: "tenant_member" };
const admin = () => "administrador" as const;
const accessOf = (rules: AccessRule[]) => (path: string) =>
	resolveAccess(rules, ana, path);
const noLog = () => {};

describe("loadRulesPanel", () => {
	it("trae la cascada de la raíz a la carpeta, con título y link", async () => {
		const view = await loadRulesPanel(
			editorRules(source(), admin),
			"talento/personal/leo",
			admin,
			noLog,
		);
		expect(view).toEqual({
			kind: "rules",
			entries: [
				{
					path: "",
					slug: "00-reglas",
					title: "Instrucciones del brain",
					body: "cuerpo de la raíz",
					visible: true,
				},
				{
					path: "talento/personal",
					slug: "talento/personal/00-reglas",
					title: "Reglas de talento/personal",
					body: "cuerpo de personal",
					visible: true,
				},
			],
		});
	});

	it("una ruta sin reglas no tiene panel", async () => {
		expect(
			await loadRulesPanel(editorRules(source([]), admin), "comercial/x", admin, noLog),
		).toBeNull();
	});

	it("quien no ve la carpeta no recibe panel ni cuerpos", async () => {
		const levelOf = accessOf([members("", "lector"), members("talento", "ninguno")]);
		const rules = editorRules(source(), levelOf);
		const page = await loadRulesPanel(rules, "talento/personal/leo", levelOf, noLog);
		const folder = await loadFolderRulesPanel(rules, "talento/personal", levelOf, noLog);
		expect(page).toBeNull();
		expect(folder).toBeNull();
		expect(JSON.stringify([page, folder])).not.toContain("cuerpo de");
	});

	it("una 00-reglas que gobierna lo que ve, pero que no puede abrir, llega sin link", async () => {
		const levelOf = accessOf([
			members("", "lector"),
			members("talento", "ninguno"),
			user("talento/personal/leo", "editor"),
		]);
		const view = await loadRulesPanel(
			editorRules(source(), levelOf),
			"talento/personal/leo",
			levelOf,
			noLog,
		);
		expect(view?.kind === "rules" && view.entries.map((e) => [e.slug, e.visible])).toEqual([
			["00-reglas", true],
			["talento/personal/00-reglas", false],
		]);
	});

	it("bajo skills/ no hay panel, ni para un administrador", async () => {
		expect(
			await loadRulesPanel(editorRules(source(), admin), "skills/facturacion", admin, noLog),
		).toBeNull();
	});

	it("una 00-reglas muestra solo las de arriba", async () => {
		const view = await loadRulesPanel(
			editorRules(source(), admin),
			"talento/personal/00-reglas",
			admin,
			noLog,
		);
		expect(view?.kind === "rules" && view.entries.map((e) => e.slug)).toEqual([
			"00-reglas",
		]);
	});

	it("si la lectura falla, avisa sin romper el editor y lo deja en el log", async () => {
		const onError = vi.fn();
		const broken = editorRules(
			createWikiRules({
				tenantId: "t1",
				store: {
					listRulePages: async () => {
						throw new Error("rpc caído");
					},
					listFolders: async () => [],
				},
			}),
			admin,
		);
		const view = await loadRulesPanel(broken, "comercial/x", admin, onError);
		expect(view).toMatchObject({ kind: "error" });
		expect(onError).toHaveBeenCalledOnce();
	});
});

describe("loadFolderRulesPanel", () => {
	it("pide la cascada de una página nueva en esa carpeta", async () => {
		expect(probeSlugFor("")).toBe("nueva-pagina");
		expect(probeSlugFor("talento/personal")).toBe("talento/personal/nueva-pagina");
		const view = await loadFolderRulesPanel(
			editorRules(source(), admin),
			"talento/personal",
			admin,
			noLog,
		);
		expect(view?.kind === "rules" && view.entries.map((e) => e.path)).toEqual([
			"",
			"talento/personal",
		]);
	});

	it("una carpeta inválida no tiene panel", async () => {
		expect(
			await loadFolderRulesPanel(editorRules(source(), admin), "Talento", admin, noLog),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/editor-rules-panel.test.ts`
Expected: FAIL (`Cannot find module '@/lib/brain/core/editor/rules-panel'`).

- [ ] **Step 3: Implementar el núcleo**

```ts
// lib/brain/core/editor/rules-panel.ts
// Panel "Reglas que aplican" del editor web (spec etapa 26 §4.3). Informativo:
// no exige nada. Lleva al navegador el cuerpo de cada 00-reglas que gobierna la
// ruta, filtrado por la ruta pedida, igual que el MCP (§4.2). Usa rules.ts (y
// node:crypto): el cliente importa de acá solo tipos.
import { type Level, ROOT_PATH } from "../access/types.ts";
import { BrainNotFound, BrainValidation } from "../errors.ts";
import {
	type RulesSource,
	withoutSkillRules,
	withRulesAccess,
} from "../rules-source.ts";
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";
import { RULES_LOAD_ERROR, rulesTitle } from "./reserved.ts";

export interface RulesPanelEntry {
	path: string;
	slug: string;
	title: string;
	body: string;
	/** La persona puede abrir la 00-reglas; si no, se muestra sin link. */
	visible: boolean;
}

export type RulesPanelView =
	| { kind: "rules"; entries: RulesPanelEntry[] }
	| { kind: "error"; message: string };

// Hoja de sondeo para la cascada de una página que todavía no existe: la
// cascada depende solo de la carpeta.
export const PROBE_LEAF = "nueva-pagina";

export function probeSlugFor(folder: string): string {
	return folder === ROOT_PATH ? PROBE_LEAF : `${folder}/${PROBE_LEAF}`;
}

// Misma garantía que el MCP: por la ruta pedida, y skills/ afuera.
export function editorRules(
	source: RulesSource,
	levelOf: (path: string) => Level | null,
): RulesSource {
	return withoutSkillRules(withRulesAccess(source, levelOf));
}

// null: sin panel (la ruta no tiene reglas, no se ve, es de skills o no es
// válida). Un error de lectura no rompe el editor: se avisa y se registra.
export async function loadRulesPanel(
	source: RulesSource,
	slug: string,
	levelOf: (path: string) => Level | null,
	onError: (error: unknown) => void,
): Promise<RulesPanelView | null> {
	try {
		const cascade = await source.cascade(slug);
		if (cascade.chain.length === 0) return null;
		return {
			kind: "rules",
			entries: cascade.chain.map((entry) => ({
				path: entry.path,
				slug: entry.slug,
				title: rulesTitle(entry.path),
				body: entry.body,
				visible: levelOf(entry.slug) !== null,
			})),
		};
	} catch (error) {
		if (error instanceof BrainNotFound || error instanceof BrainValidation)
			return null;
		onError(error);
		return { kind: "error", message: RULES_LOAD_ERROR };
	}
}

// "Nueva página": la carpeta tiene que verse, además de la hoja de sondeo.
export async function loadFolderRulesPanel(
	source: RulesSource,
	folder: string,
	levelOf: (path: string) => Level | null,
	onError: (error: unknown) => void,
): Promise<RulesPanelView | null> {
	if (
		folder !== ROOT_PATH &&
		(folder.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(folder))
	)
		return null;
	if (levelOf(folder) === null) return null;
	return loadRulesPanel(source, probeSlugFor(folder), levelOf, onError);
}
```

- [ ] **Step 4: Correr el test del núcleo y verificar que pasa**

Run: `npx vitest run tests/brain/editor-rules-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir los tests del adaptador y de la acción que fallan**

En `tests/brain/editor-adapter.test.ts`:
1. En el objeto de `vi.hoisted`, sumar `accessRules: [] as unknown[],`.
2. Cambiar el mock de `@/lib/brain/adapters/access-rules` por `accessRulesStore: () => ({ load: async () => state.accessRules }),`.
3. Agregar, junto a los otros `vi.mock`:

```ts
vi.mock("@/lib/brain/adapters/rules", () => ({
	getBrainRules: () => ({
		cascade: async () => ({
			revision: "r1",
			chain: [{ path: "", slug: "00-reglas", revision: 1, body: "raíz" }],
			fields: [],
			template: null,
		}),
		session: async () => ({ root: null, folders: [] }),
	}),
}));
```

4. En `beforeEach`, sumar `state.accessRules = [];`.
5. Sumar `import { BrainNotFound } from "@/lib/brain/core/errors";` a los imports y este test dentro de `describe("loadEditorContext", ...)`:

```ts
	it("las reglas del contexto se filtran por lo que ve la persona y dejan skills afuera", async () => {
		state.access = tenant({ role: "tenant_member" });
		state.bindings = [binding()];
		state.accessRules = [
			{ path: "", principal: "members", userId: null, level: "lector" },
			{ path: "talento", principal: "members", userId: null, level: "ninguno" },
		];
		const ctx = await loadEditorContext("miembro-reglas");
		if (ctx?.kind !== "ok") throw new Error("esperaba ok");
		await expect(ctx.rules.cascade("talento/x")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		await expect(ctx.rules.cascade("skills/x")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		expect((await ctx.rules.cascade("comercial/x")).chain).toHaveLength(1);
	});
```

Y el test de la acción:

```ts
// tests/brain/rules-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadEditorContext = vi.fn();
const loadNewPageRulesPanel = vi.fn();

vi.mock("@/lib/brain/adapters/editor", () => ({
	loadEditorContext,
	loadNewPageRulesPanel,
}));

const { loadNewPageRules } = await import("@/app/[tenant]/brain/rules-actions");

beforeEach(() => {
	loadEditorContext.mockReset();
	loadNewPageRulesPanel.mockReset();
});

describe("loadNewPageRules", () => {
	it("rechaza datos mal formados sin cargar el contexto", async () => {
		expect(await loadNewPageRules({ tenantSlug: "A B", folder: "x" })).toBeNull();
		expect(await loadNewPageRules({ tenantSlug: "acme" })).toBeNull();
		expect(loadEditorContext).not.toHaveBeenCalled();
	});

	it("sin brain propio no hay panel", async () => {
		loadEditorContext.mockResolvedValueOnce(null);
		expect(await loadNewPageRules({ tenantSlug: "acme", folder: "x" })).toBeNull();
		loadEditorContext.mockResolvedValueOnce({ kind: "external" });
		expect(await loadNewPageRules({ tenantSlug: "acme", folder: "x" })).toBeNull();
		expect(loadNewPageRulesPanel).not.toHaveBeenCalled();
	});

	it("pide el panel de la carpeta con el contexto de la persona", async () => {
		const ctx = { kind: "ok" };
		const view = { kind: "rules", entries: [] };
		loadEditorContext.mockResolvedValueOnce(ctx);
		loadNewPageRulesPanel.mockResolvedValueOnce(view);
		expect(
			await loadNewPageRules({ tenantSlug: "acme", folder: "comercial" }),
		).toBe(view);
		expect(loadEditorContext).toHaveBeenCalledWith("acme");
		expect(loadNewPageRulesPanel).toHaveBeenCalledWith(ctx, "comercial");
	});
});
```

- [ ] **Step 6: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/editor-adapter.test.ts tests/brain/rules-actions.test.ts`
Expected: FAIL (`ctx.rules` es `undefined`; no existe `rules-actions`).

- [ ] **Step 7: Cablear el adaptador**

En `lib/brain/adapters/editor.ts`:

Imports nuevos (junto a los existentes):

```ts
import {
	editorRules,
	loadFolderRulesPanel,
	loadRulesPanel,
	type RulesPanelView,
} from "../core/editor/rules-panel";
import type { RulesSource } from "../core/rules-source";
import { getBrainRules } from "./rules";
```

En el tipo `EditorContext`, rama `"ok"`, después de `folders`:

```ts
			// Reglas que gobiernan cada ruta (spec etapa 26 §4.3), ya filtradas por
			// lo que ve la persona y sin skills/: la misma garantía que el MCP.
			rules: RulesSource;
```

En `loadEditorContext`, en el objeto que devuelve, después de `folders,`:

```ts
			rules: editorRules(getBrainRules(binding), access),
```

Al final del archivo:

```ts
function logRulesError(ctx: OkEditorContext) {
	return (error: unknown) =>
		console.error(
			`brain editor: no pude leer las reglas de ${ctx.tenant.slug}`,
			error,
		);
}

// Panel "Reglas que aplican" de una página (spec etapa 26 §4.3).
export function loadPageRulesPanel(
	ctx: OkEditorContext,
	slug: string,
): Promise<RulesPanelView | null> {
	return loadRulesPanel(ctx.rules, slug, ctx.access, logRulesError(ctx));
}

// El de una página nueva en una carpeta: la página todavía no existe.
export function loadNewPageRulesPanel(
	ctx: OkEditorContext,
	folder: string,
): Promise<RulesPanelView | null> {
	return loadFolderRulesPanel(ctx.rules, folder, ctx.access, logRulesError(ctx));
}
```

- [ ] **Step 8: Crear la server action**

```ts
// app/[tenant]/brain/rules-actions.ts
"use server";

import { z } from "zod";
import {
	loadEditorContext,
	loadNewPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";

// Lectura para "Nueva página": no revalida nada. La forma se valida en el
// borde; qué ve la persona lo decide su contexto del editor.
const inputSchema = z.object({
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	folder: z.string().max(200),
});

export async function loadNewPageRules(
	raw: unknown,
): Promise<RulesPanelView | null> {
	const parsed = inputSchema.safeParse(raw);
	if (!parsed.success) return null;
	const ctx = await loadEditorContext(parsed.data.tenantSlug);
	if (!ctx || ctx.kind !== "ok") return null;
	return loadNewPageRulesPanel(ctx, parsed.data.folder);
}
```

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/editor-rules-panel.test.ts tests/brain/editor-adapter.test.ts tests/brain/rules-actions.test.ts tests/brain/editor-tree.test.ts tests/brain/boundary.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck, formato y commit**

Run: `npm run typecheck && npx biome check --write lib/brain/core/editor/rules-panel.ts lib/brain/adapters/editor.ts app/[tenant]/brain/rules-actions.ts tests/brain/editor-rules-panel.test.ts tests/brain/editor-adapter.test.ts tests/brain/rules-actions.test.ts`
Expected: sin errores.

```bash
git add lib/brain/core/editor/rules-panel.ts lib/brain/adapters/editor.ts "app/[tenant]/brain/rules-actions.ts" tests/brain/editor-rules-panel.test.ts tests/brain/editor-adapter.test.ts tests/brain/rules-actions.test.ts
git commit -m "feat: reglas que aplican para el editor web, con los permisos de la persona (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Panel "Reglas que aplican" en el editor y en "Nueva página"

**Files:**
- Create: `components/brain/rules-panel.tsx`
- Modify: `components/brain/editor/page-workspace.tsx` (props, hook, render)
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx` (rama de edición)
- Modify: `app/[tenant]/brain/nueva/page.tsx`
- Test: `tests/brain/rules-panel.test.ts` (nuevo), `tests/brain/rules-panel-hook.test.ts` (nuevo)

**Interfaces:**
- Consumes: de Task 3: `type RulesPanelView`, `loadNewPageRules(raw: unknown): Promise<RulesPanelView | null>` (`@/app/[tenant]/brain/rules-actions`), `loadPageRulesPanel(ctx, slug)`, `loadNewPageRulesPanel(ctx, folder)` (`@/lib/brain/adapters/editor`). De Task 1: `typedFolder(slug: string): string | null`, `RULES_LOAD_ERROR`. `BrainMarkdown({ body, tenantSlug, pages }: { body: string; tenantSlug: string; pages: Map<string, { title: string; status: BrainStatus }> })` de `components/brain/markdown.tsx`. `pageHref` de `lib/brain/core/editor/slug.ts`.
- Produces: `RulesPanel({ tenantSlug, view, pages }: { tenantSlug: string; view: RulesPanelView; pages: Array<{ slug: string; title: string; status: BrainStatus }> })`; `useFolderRules(options: { enabled: boolean; tenantSlug: string; slug: string; initial: RulesPanelView | null }): RulesPanelView | null`; `RULES_DEBOUNCE_MS = 300`. `PageWorkspaceProps.rules?: RulesPanelView | null`.

- [ ] **Step 1: Escribir el test del panel que falla**

```ts
// tests/brain/rules-panel.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/brain/rules-actions", () => ({
	loadNewPageRules: vi.fn(),
}));
vi.mock("next/link", () => ({
	default: (props: Record<string, unknown>) => createElement("a", props),
}));

const { RulesPanel } = await import("@/components/brain/rules-panel");

const entry = (over: Record<string, unknown> = {}) => ({
	path: "talento/personal",
	slug: "talento/personal/00-reglas",
	title: "Reglas de talento/personal",
	body: "Cada ficha lleva **reporta_a**.",
	visible: true,
	...over,
});

const render = (view: unknown) =>
	renderToStaticMarkup(
		createElement(RulesPanel, {
			tenantSlug: "acme",
			view: view as never,
			pages: [],
		}),
	);

describe("RulesPanel", () => {
	it("muestra cuántas aplican, cada título y el link a cada 00-reglas", () => {
		const html = render({
			kind: "rules",
			entries: [
				entry({ path: "", slug: "00-reglas", title: "Instrucciones del brain" }),
				entry(),
			],
		});
		expect(html).toContain("Reglas que aplican");
		expect(html).toContain("(2)");
		expect(html).toContain("Instrucciones del brain");
		expect(html).toContain('href="/acme/brain/p/talento/personal/00-reglas"');
	});

	it("una regla que la persona no puede abrir va sin link", () => {
		const html = render({ kind: "rules", entries: [entry({ visible: false })] });
		expect(html).toContain("Reglas de talento/personal");
		expect(html).not.toContain("href=");
	});

	it("el cuerpo se muestra como markdown y el HTML queda como texto", () => {
		const html = render({
			kind: "rules",
			entries: [
				entry({
					body: '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n**importante**',
				}),
			],
		});
		expect(html).toContain("<strong>importante</strong>");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
	});

	it("si no se pudieron leer, lo dice", () => {
		const html = render({ kind: "error", message: "No se pudieron leer." });
		expect(html).toContain('role="alert"');
		expect(html).toContain("No se pudieron leer.");
	});
});
```

- [ ] **Step 2: Escribir el test del hook que falla**

```ts
// tests/brain/rules-panel-hook.test.ts
// @vitest-environment happy-dom
// Value: protects=en "Nueva página" el panel sigue a la última carpeta escrita; fails_when=una respuesta vieja pisa a la nueva o se pide en cada tecla; seam=none; no_claim=la Server Action real (loadNewPageRules simulada, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
	input: { tenantSlug: string; folder: string };
	resolve: (view: unknown) => void;
	reject: (error: unknown) => void;
};
const state = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("@/app/[tenant]/brain/rules-actions", () => ({
	loadNewPageRules: (input: Call["input"]) =>
		new Promise((resolve, reject) => {
			state.calls.push({ input, resolve, reject });
		}),
}));
vi.mock("next/link", () => ({
	default: (props: Record<string, unknown>) => createElement("a", props),
}));

const { useFolderRules, RULES_DEBOUNCE_MS } = await import(
	"@/components/brain/rules-panel"
);

const INITIAL = { kind: "rules", entries: [{ slug: "inicial" }] };
const view = (slug: string) => ({ kind: "rules", entries: [{ slug }] });

function Probe({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
	const current = useFolderRules({
		enabled,
		tenantSlug: "acme",
		slug,
		initial: INITIAL as never,
	});
	return createElement("pre", null, JSON.stringify(current));
}

let host: HTMLDivElement;
let root: Root;
const shown = () => host.textContent ?? "";
const show = async (slug: string, enabled = true) => {
	await act(async () => {
		root.render(createElement(Probe, { slug, enabled }));
	});
};
const wait = async (ms: number) => {
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
};

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	vi.useFakeTimers();
	state.calls = [];
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.useRealTimers();
});

describe("useFolderRules", () => {
	it("no pide nada mientras la carpeta no cambia", async () => {
		await show("comercial/");
		await show("comercial/nueva-oferta");
		await wait(1000);
		expect(state.calls).toEqual([]);
		expect(shown()).toContain("inicial");
	});

	it("pide una sola vez, por la última carpeta escrita", async () => {
		await show("comercial/");
		await show("legal/");
		await show("marketing/");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls.map((call) => call.input)).toEqual([
			{ tenantSlug: "acme", folder: "marketing" },
		]);
		await act(async () => state.calls[0].resolve(view("marketing")));
		expect(shown()).toContain("marketing");
	});

	it("descarta una respuesta vieja", async () => {
		await show("comercial/");
		await show("legal/");
		await wait(RULES_DEBOUNCE_MS);
		await show("marketing/");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls.map((call) => call.input.folder)).toEqual([
			"legal",
			"marketing",
		]);
		await act(async () => state.calls[0].resolve(view("legal")));
		expect(shown()).toContain("inicial");
		await act(async () => state.calls[1].resolve(view("marketing")));
		expect(shown()).toContain("marketing");
		expect(shown()).not.toContain("legal");
	});

	it("una carpeta a medio escribir que no es válida no pide", async () => {
		await show("comercial/");
		await show("comercial-/x");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls).toEqual([]);
	});

	it("si falla, muestra el error", async () => {
		await show("comercial/");
		await show("legal/");
		await wait(RULES_DEBOUNCE_MS);
		await act(async () => state.calls[0].reject(new Error("red")));
		expect(shown()).toContain('"kind":"error"');
	});

	it("apagado no pide nunca", async () => {
		await show("comercial/", false);
		await show("legal/", false);
		await wait(1000);
		expect(state.calls).toEqual([]);
	});
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/rules-panel.test.ts tests/brain/rules-panel-hook.test.ts`
Expected: FAIL (`Cannot find module '@/components/brain/rules-panel'`).

- [ ] **Step 4: Crear el componente y el hook**

```tsx
// components/brain/rules-panel.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadNewPageRules } from "@/app/[tenant]/brain/rules-actions";
import { BrainMarkdown } from "@/components/brain/markdown";
import { RULES_LOAD_ERROR, typedFolder } from "@/lib/brain/core/editor/reserved";
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { BrainStatus } from "@/lib/brain/core/types";

export const RULES_DEBOUNCE_MS = 300;

// En "Nueva página" la ruta se escribe a mano: el panel sigue a su carpeta.
// Se pide una vez por carpeta, después de una pausa, y una respuesta vieja se
// descarta. `loaded` se marca solo al aplicar una respuesta: si se vuelve a una
// carpeta cuya respuesta se descartó, se pide de nuevo.
export function useFolderRules({
	enabled,
	tenantSlug,
	slug,
	initial,
}: {
	enabled: boolean;
	tenantSlug: string;
	slug: string;
	initial: RulesPanelView | null;
}): RulesPanelView | null {
	const [view, setView] = useState(initial);
	const folder = typedFolder(slug);
	const loaded = useRef(folder);
	useEffect(() => {
		if (!enabled || folder === null || folder === loaded.current) return;
		let stale = false;
		const timer = setTimeout(() => {
			loadNewPageRules({ tenantSlug, folder })
				.then((next) => {
					if (stale) return;
					loaded.current = folder;
					setView(next);
				})
				.catch(() => {
					if (!stale) setView({ kind: "error", message: RULES_LOAD_ERROR });
				});
		}, RULES_DEBOUNCE_MS);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [enabled, tenantSlug, folder]);
	return view;
}

// Informativo (spec etapa 26 §4.3): las reglas que reciben los asistentes antes
// de escribir acá. No exige nada a las personas.
export function RulesPanel({
	tenantSlug,
	view,
	pages,
}: {
	tenantSlug: string;
	view: RulesPanelView;
	pages: Array<{ slug: string; title: string; status: BrainStatus }>;
}) {
	const lookup = useMemo(
		() =>
			new Map(pages.map((p) => [p.slug, { title: p.title, status: p.status }])),
		[pages],
	);
	return (
		<details className="rounded-lg border bg-card text-card-foreground">
			<summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-medium text-sm lg:min-h-9">
				Reglas que aplican
				{view.kind === "rules" && (
					<span className="font-normal text-muted-foreground">
						({view.entries.length})
					</span>
				)}
			</summary>
			<div className="space-y-4 border-t px-4 py-3 text-sm">
				{view.kind === "error" ? (
					<p role="alert" className="text-destructive">
						{view.message}
					</p>
				) : (
					<>
						<p className="text-muted-foreground">
							Las reciben los asistentes antes de escribir en esta carpeta. Para
							vos son una guía: guardar no exige nada.
						</p>
						<ol className="space-y-4">
							{view.entries.map((entry) => (
								<li key={entry.slug} className="space-y-2">
									<div className="flex flex-wrap items-center gap-x-3">
										<span className="font-medium">{entry.title}</span>
										{entry.visible && (
											<Link
												href={pageHref(tenantSlug, entry.slug)}
												className="inline-flex min-h-11 items-center underline lg:min-h-0"
											>
												Abrir
											</Link>
										)}
									</div>
									<div className="max-h-80 overflow-y-auto rounded-md bg-muted/50 p-3">
										<BrainMarkdown
											body={entry.body}
											tenantSlug={tenantSlug}
											pages={lookup}
										/>
									</div>
								</li>
							))}
						</ol>
					</>
				)}
			</div>
		</details>
	);
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/rules-panel.test.ts tests/brain/rules-panel-hook.test.ts`
Expected: PASS. Si el render estático de `BrainMarkdown` no deja pasar la negrita como `<strong>`, revisar que el cuerpo llegue sin escapar a `toMarkdownLinks` (no se escapa en el componente).

- [ ] **Step 6: Montar el panel en el espacio de trabajo**

En `components/brain/editor/page-workspace.tsx`:

Imports, junto a los de `@/components/brain/...`:

```ts
import { RulesPanel, useFolderRules } from "@/components/brain/rules-panel";
```

y junto a los de `@/lib/brain/core/...`:

```ts
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";
```

En `PageWorkspaceProps`, después de `skill?: ReactNode;`:

```ts
	// Reglas que aplican, ya armadas en el servidor (spec etapa 26 §4.3). null:
	// la ruta no tiene, no se ven o es de skills.
	rules?: RulesPanelView | null;
```

Sumar `rules,` a la desestructuración de props (después de `skill,`). Después de `const [isPending, startTransition] = useTransition();`:

```ts
	// En una página nueva el panel sigue a la carpeta que se escribe en el slug.
	const rulesView = useFolderRules({
		enabled: mode === "new",
		tenantSlug,
		slug: form.slug,
		initial: rules ?? null,
	});
```

En el JSX, inmediatamente antes de `<Paper>`:

```tsx
			{rulesView && (
				<RulesPanel tenantSlug={tenantSlug} view={rulesView} pages={pages} />
			)}
```

- [ ] **Step 7: Armar la vista en las páginas del servidor**

En `app/[tenant]/brain/p/[...slug]/page.tsx`, cambiar el import de `@/lib/brain/adapters/editor` por:

```ts
import {
	loadBrainPages,
	loadEditorContext,
	loadPageRulesPanel,
} from "@/lib/brain/adapters/editor";
```

En la rama `if (entryMode(level) === "edit") {`, como primera línea:

```ts
		const rules = await loadPageRulesPanel(ctx, slug);
```

y sumar `rules={rules}` a las props de `<PageWorkspace mode="edit" ...>` (después de `skill={skill}`).

`app/[tenant]/brain/nueva/page.tsx` queda:

```tsx
import { notFound } from "next/navigation";
import { PageWorkspace } from "@/components/brain/editor/page-workspace";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
	loadNewPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";
import { typedFolder } from "@/lib/brain/core/editor/reserved";

export default async function NewBrainPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ en?: string }>;
}) {
	const { tenant: tenantSlug } = await params;
	const { en } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok") notFound();
	// Se puede crear donde se es editor de alguna carpeta, no solo de la raíz. El
	// permiso real lo decide withAccess al guardar.
	const folders = editableFolders(await loadBrainTree(ctx));
	if (folders.length === 0) notFound();
	const pages = await loadBrainPages(ctx);
	const prefix = resolveNewPagePrefix(en, folders);
	const rules = await loadNewPageRulesPanel(ctx, typedFolder(prefix) ?? "");
	return (
		<div>
			<h1 className="mb-2 text-3xl leading-tight">Nueva página</h1>
			{!folders.includes("") && (
				<p className="mb-6 text-muted-foreground text-sm">
					Podés crear páginas en: {folders.join(", ")}.
				</p>
			)}
			<PageWorkspace
				mode="new"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug, title, status }) => ({
					slug,
					title,
					status,
				}))}
				rules={rules}
				initial={{
					slug: prefix,
					title: "",
					category: ctx.categories[0],
					status: "borrador",
					tags: [],
					frontmatter: {},
					body: "",
					revision: null,
				}}
			/>
		</div>
	);
}
```

- [ ] **Step 8: Verificar que el cliente no arrastra `node:*`**

Agregar a `tests/brain/rules-panel.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("frontera de cliente", () => {
	it("el panel y el espacio de trabajo importan rules-panel solo como tipo", () => {
		for (const file of [
			"components/brain/rules-panel.tsx",
			"components/brain/editor/page-workspace.tsx",
		]) {
			const source = readFileSync(file, "utf8");
			const lines = source
				.split("\n")
				.filter((line) => line.includes("core/editor/rules-panel"));
			expect(lines.every((line) => line.startsWith("import type"))).toBe(true);
			expect(source).not.toMatch(/core\/rules(-source)?["']/);
		}
	});
});
```

(Los `import` de este bloque van arriba del archivo, con los otros.)

- [ ] **Step 9: Correr los tests del brain, typecheck y formato**

Run: `npx vitest run tests/brain && npm run typecheck && npx biome check --write components/brain/rules-panel.tsx components/brain/editor/page-workspace.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" "app/[tenant]/brain/nueva/page.tsx" tests/brain/rules-panel.test.ts tests/brain/rules-panel-hook.test.ts`
Expected: PASS y sin errores.

- [ ] **Step 10: Commit**

```bash
git add components/brain/rules-panel.tsx components/brain/editor/page-workspace.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" "app/[tenant]/brain/nueva/page.tsx" tests/brain/rules-panel.test.ts tests/brain/rules-panel-hook.test.ts
git commit -m "feat: panel Reglas que aplican en el editor y en Nueva página (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Editar y crear una página reservada desde la web

**Files:**
- Create: `components/brain/reserved-notice.tsx`
- Modify: `components/brain/editor/page-workspace.tsx` (aviso, `slugLocked`)
- Modify: `app/[tenant]/brain/nueva/page.tsx` (`?reglas=1`)
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx` (nivel de entrada)
- Test: `tests/brain/reserved-notice.test.ts` (nuevo)

**Interfaces:**
- Consumes: de Task 1: `reservedNotice(slug: string): ReservedNotice | null`, `type ReservedNotice`, `resolveNewRulesPage(en, levelOf): { slug: string; title: string } | null`, `entryLevel(slug, levelOf): Level | null`. De Task 3: `loadPageRulesPanel(ctx, slug)`. De Task 4: la versión de `nueva/page.tsx` y de `PageWorkspace` con `rules`. `pageHref` de `lib/brain/core/editor/slug.ts`.
- Produces: `ReservedNoticeBox({ notice, length }: { notice: ReservedNotice; length: number })`; `PageWorkspaceProps.slugLocked?: boolean`; la ruta `/[tenant]/brain/nueva?reglas=1[&en=<carpeta>]`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/reserved-notice.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReservedNoticeBox } from "@/components/brain/reserved-notice";
import { reservedNotice } from "@/lib/brain/core/editor/reserved";

const render = (slug: string, length: number) => {
	const notice = reservedNotice(slug);
	if (!notice) throw new Error("esperaba un aviso");
	return renderToStaticMarkup(createElement(ReservedNoticeBox, { notice, length }));
};

describe("ReservedNoticeBox", () => {
	it("explica las instrucciones del brain y cuenta contra 12 000", () => {
		const html = render("00-reglas", 11_500);
		expect(html).toContain('role="note"');
		expect(html).toContain("Instrucciones del brain");
		expect(html).toContain("11.500 de 12.000 caracteres");
		expect(html).not.toContain("text-destructive");
	});

	it("pasado el tope lo marca", () => {
		const html = render("talento/personal/00-reglas", 20_001);
		expect(html).toContain("20.001 de 20.000 caracteres");
		expect(html).toContain("text-destructive");
		expect(html).toContain("no se puede guardar activa");
	});

	it("la plantilla no tiene contador", () => {
		const html = render("comercial/00-plantilla", 50);
		expect(html).toContain("Plantilla de comercial");
		expect(html).not.toContain("caracteres");
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/reserved-notice.test.ts`
Expected: FAIL (`Cannot find module '@/components/brain/reserved-notice'`).

- [ ] **Step 3: Crear el aviso**

```tsx
// components/brain/reserved-notice.tsx
import type { ReservedNotice } from "@/lib/brain/core/editor/reserved";

const count = (n: number) => n.toLocaleString("es-AR");

// Aviso arriba del editor de una página reservada (spec etapa 26 §4.1): qué
// gobierna, quién la escribe y su tope. El tope lo exige el servidor al guardar
// una 00-reglas activa; acá solo se muestra.
export function ReservedNoticeBox({
	notice,
	length,
}: {
	notice: ReservedNotice;
	length: number;
}) {
	const over = notice.limit !== null && length > notice.limit;
	return (
		<div role="note" className="space-y-1 rounded-lg border bg-muted/50 p-4 text-sm">
			<p className="font-medium">{notice.title}</p>
			<p className="text-muted-foreground">{notice.text}</p>
			{notice.limit !== null && (
				<p
					className={
						over ? "font-medium text-destructive" : "text-muted-foreground"
					}
				>
					{count(length)} de {count(notice.limit)} caracteres
					{over ? ": así no se puede guardar activa." : ""}
				</p>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/brain/reserved-notice.test.ts`
Expected: PASS.

- [ ] **Step 5: Aviso y slug fijo en el espacio de trabajo**

En `components/brain/editor/page-workspace.tsx`:

Imports: `import { ReservedNoticeBox } from "@/components/brain/reserved-notice";` y `import { reservedNotice } from "@/lib/brain/core/editor/reserved";`.

En `PageWorkspaceProps`, después de `rules?: RulesPanelView | null;`:

```ts
	// Página nueva con el slug ya decidido (las reglas de una carpeta).
	slugLocked?: boolean;
```

Sumar `slugLocked = false,` a la desestructuración. El hook de la Task 4 pasa a `enabled: mode === "new" && !slugLocked,`. Debajo del hook:

```ts
	// Una reservada avisa qué gobierna y cuenta caracteres (spec etapa 26 §4.1).
	const notice = reservedNotice(form.slug);
```

En el JSX, inmediatamente antes de `{rulesView && (`:

```tsx
			{notice && <ReservedNoticeBox notice={notice} length={body.length} />}
```

En el `<Input id={slugId} ...>` del modo `new`, sumar `readOnly={slugLocked}`.

- [ ] **Step 6: `?reglas=1` en "Nueva página"**

`app/[tenant]/brain/nueva/page.tsx` queda:

```tsx
import { notFound, redirect } from "next/navigation";
import { PageWorkspace } from "@/components/brain/editor/page-workspace";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
	loadNewPageRulesPanel,
	loadPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";
import {
	resolveNewRulesPage,
	typedFolder,
} from "@/lib/brain/core/editor/reserved";
import { pageHref } from "@/lib/brain/core/editor/slug";

export default async function NewBrainPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ en?: string; reglas?: string }>;
}) {
	const { tenant: tenantSlug } = await params;
	const { en, reglas } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok") notFound();
	// Se puede crear donde se es editor de alguna carpeta, no solo de la raíz. El
	// permiso real lo decide withAccess al guardar.
	const folders = editableFolders(await loadBrainTree(ctx));
	if (folders.length === 0) notFound();
	const pages = await loadBrainPages(ctx);
	const shared = {
		tenantSlug,
		categories: ctx.categories,
		knownTags: [...new Set(pages.flatMap((p) => p.tags))],
		pages: pages.map(({ slug, title, status }) => ({ slug, title, status })),
	};

	// Instrucciones del brain o reglas de una carpeta (spec etapa 26 §4.1): las
	// crea quien administra la carpeta. Si ya existe en cualquier estado, se
	// abre. Nace en borrador: no aplica hasta que se active.
	if (reglas === "1") {
		const target = resolveNewRulesPage(en, ctx.access);
		if (!target) notFound();
		if (pages.some((p) => p.slug === target.slug))
			redirect(pageHref(tenantSlug, target.slug));
		const rules = await loadPageRulesPanel(ctx, target.slug);
		return (
			<div>
				<h1 className="mb-6 text-3xl leading-tight">{target.title}</h1>
				<PageWorkspace
					mode="new"
					{...shared}
					rules={rules}
					slugLocked
					initial={{
						slug: target.slug,
						title: target.title,
						category: ctx.categories[0],
						status: "borrador",
						tags: [],
						frontmatter: {},
						body: "",
						revision: null,
					}}
				/>
			</div>
		);
	}

	const prefix = resolveNewPagePrefix(en, folders);
	const rules = await loadNewPageRulesPanel(ctx, typedFolder(prefix) ?? "");
	return (
		<div>
			<h1 className="mb-2 text-3xl leading-tight">Nueva página</h1>
			{!folders.includes("") && (
				<p className="mb-6 text-muted-foreground text-sm">
					Podés crear páginas en: {folders.join(", ")}.
				</p>
			)}
			<PageWorkspace
				mode="new"
				{...shared}
				rules={rules}
				initial={{
					slug: prefix,
					title: "",
					category: ctx.categories[0],
					status: "borrador",
					tags: [],
					frontmatter: {},
					body: "",
					revision: null,
				}}
			/>
		</div>
	);
}
```

(El proveedor `wiki` ignora la categoría que llega para `00-reglas` en la raíz y la guarda como `brain`, y para una carpeta usa la del primer segmento: `ctx.categories[0]` acá es solo el valor inicial del formulario, y la Task 8 lo reemplaza.)

- [ ] **Step 7: Una reservada se lee si no se administra su carpeta**

En `app/[tenant]/brain/p/[...slug]/page.tsx`, sumar `import { entryLevel } from "@/lib/brain/core/editor/reserved";` y reemplazar:

```ts
	const level = ctx.access(slug);
```

por:

```ts
	// Una reservada se edita solo administrando su carpeta (spec etapa 26
	// §4.1); para los demás es lectura. El servidor lo exige igual al guardar.
	const level = entryLevel(slug, ctx.access);
```

(`canDelete={level === "administrador"}` queda igual: para una reservada, `level` es `administrador` solo si se administra su carpeta.)

- [ ] **Step 8: Correr los tests del brain, typecheck y formato**

Run: `npx vitest run tests/brain && npm run typecheck && npx biome check --write components/brain/reserved-notice.tsx components/brain/editor/page-workspace.tsx "app/[tenant]/brain/nueva/page.tsx" "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/reserved-notice.test.ts`
Expected: PASS y sin errores.

- [ ] **Step 9: Commit**

```bash
git add components/brain/reserved-notice.tsx components/brain/editor/page-workspace.tsx "app/[tenant]/brain/nueva/page.tsx" "app/[tenant]/brain/p/[...slug]/page.tsx" tests/brain/reserved-notice.test.ts
git commit -m "feat: editar y crear instrucciones y reglas desde el editor web (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Menú del árbol: reglas, indicador y borrado con motivo

**Files:**
- Modify: `lib/brain/core/access/tree.ts` (nueva `folderDeleteBlocks` y sus mensajes)
- Modify: `components/brain/tree-row-menu.tsx`
- Modify: `components/brain/brain-tree.tsx`
- Test: `tests/brain/tree-row-menu.test.ts` (reemplazo completo), `tests/brain/access-tree.test.ts`

**Interfaces:**
- Consumes: de Task 2: `TreeNode.rules`, `TreeNode.template`, `visibleTree`, `withoutArchived`. De Task 1: `isSkillsFolder(folder: string): boolean`, `rulesEntryHref(tenantSlug, node): string`.
- Produces: en `tree.ts`: `FOLDER_HAS_CONTENT: string`, `FOLDER_HAS_RULES: string`, `folderDeleteBlocks(root: TreeNode): Map<string, string>` (ruta de carpeta → motivo por el que no se puede borrar; se calcula sobre el árbol **sin podar**). En `tree-row-menu.tsx`: `type FolderMenuItem = "new-subfolder" | "describe" | "rules" | "delete-folder" | "delete-folder-blocked"`, `folderMenuItems(node: TreeNode, rootLevel: Level | null, deleteBlockedReason: string | null): FolderMenuItem[]`, `rulesMenuLabel(node: TreeNode): string`, y la prop nueva `deleteBlockedReason: string | null` de `TreeRowMenu`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/brain/tree-row-menu.test.ts` queda:

```ts
import { describe, expect, it } from "vitest";
import { folderMenuItems, rulesMenuLabel } from "@/components/brain/tree-row-menu";
import {
	type TreeNode,
	visibleTree,
	withoutArchived,
} from "@/lib/brain/core/access/tree";
import { rulesEntryHref } from "@/lib/brain/core/editor/reserved";

const node = (over: Partial<TreeNode>): TreeNode => ({
	path: "comercial",
	name: "comercial",
	page: null,
	folder: { description: "" },
	rules: null,
	template: null,
	level: "administrador",
	children: [],
	...over,
});

describe("folderMenuItems", () => {
	it("un administrador de la raíz ve las acciones de carpeta", () => {
		expect(folderMenuItems(node({}), "administrador", null)).toEqual([
			"new-subfolder",
			"describe",
			"rules",
			"delete-folder",
		]);
	});
	it("un editor no ve ninguna", () => {
		expect(
			folderMenuItems(node({ level: "editor" }), "administrador", null),
		).toEqual([]);
	});
	// Antes ofrecía "Nueva subcarpeta" acá: brain_create_folder pide la fila del
	// padre y respondía siempre no encontrado.
	it("una carpeta implícita (sin fila) no ofrece nada", () => {
		expect(
			folderMenuItems(
				node({ folder: null, children: [node({ path: "comercial/x" })] }),
				"administrador",
				null,
			),
		).toEqual([]);
	});
	it("la raíz ofrece nueva carpeta e instrucciones del brain", () => {
		const root = node({ path: "", name: "", folder: null });
		expect(folderMenuItems(root, "administrador", null)).toEqual([
			"new-subfolder",
			"rules",
		]);
		expect(rulesMenuLabel(root)).toBe("Instrucciones del brain");
		expect(rulesMenuLabel(node({}))).toBe("Reglas de la carpeta");
	});
	it("una de primer nivel no se borra si no administra la raíz", () => {
		expect(folderMenuItems(node({}), "editor", null)).toEqual([
			"new-subfolder",
			"describe",
			"rules",
		]);
	});
	it("una subcarpeta se borra administrando solo esa carpeta", () => {
		expect(
			folderMenuItems(
				node({ path: "comercial/sucursales", name: "sucursales" }),
				"lector",
				null,
			),
		).toEqual(["new-subfolder", "describe", "rules", "delete-folder"]);
	});
	it("skills/ no ofrece reglas propias", () => {
		expect(
			folderMenuItems(node({ path: "skills", name: "skills" }), "administrador", null),
		).toEqual(["new-subfolder", "describe", "delete-folder"]);
	});
	it("con contenido, borrar aparece deshabilitado", () => {
		expect(
			folderMenuItems(node({}), "administrador", "Tiene páginas o subcarpetas."),
		).toEqual(["new-subfolder", "describe", "rules", "delete-folder-blocked"]);
	});
});

describe("reglas desde el árbol", () => {
	it("una 00-reglas archivada no muestra la marca pero el menú la abre", () => {
		const root = visibleTree(
			[
				{
					slug: "comercial/00-reglas",
					title: "Reglas",
					status: "archivado",
				},
			],
			() => "administrador",
			[{ path: "comercial", description: "" }],
		);
		const comercial = withoutArchived(root).children[0];
		expect(comercial.rules?.status === "activo").toBe(false);
		expect(rulesEntryHref("acme", comercial)).toBe(
			"/acme/brain/p/comercial/00-reglas",
		);
	});

	it("sin 00-reglas, el menú de la raíz crea las instrucciones", () => {
		const root = visibleTree([], () => "administrador", []);
		expect(rulesEntryHref("acme", root)).toBe("/acme/brain/nueva?reglas=1");
	});
});
```

Al final de `tests/brain/access-tree.test.ts`, sumar `folderDeleteBlocks`, `FOLDER_HAS_CONTENT` y `FOLDER_HAS_RULES` al import de `@/lib/brain/core/access/tree` y:

```ts
describe("folderDeleteBlocks", () => {
	const all = () => "administrador" as const;

	it("una carpeta con solo reglas no se ofrece para borrar y dice por qué", () => {
		const root = visibleTree([page("talento/personal/00-reglas")], all, [
			{ path: "talento", description: "" },
			{ path: "talento/personal", description: "" },
			{ path: "marketing", description: "" },
		]);
		const blocks = folderDeleteBlocks(root);
		expect(blocks.get("talento/personal")).toBe(FOLDER_HAS_RULES);
		expect(blocks.get("talento")).toBe(FOLDER_HAS_CONTENT);
		expect(blocks.has("marketing")).toBe(false);
		expect(blocks.has("")).toBe(false);
	});

	it("una página archivada también cuenta como contenido", () => {
		const root = visibleTree([page("comercial/vieja", "archivado")], all, [
			{ path: "comercial", description: "" },
		]);
		expect(folderDeleteBlocks(root).get("comercial")).toBe(FOLDER_HAS_CONTENT);
	});
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/tree-row-menu.test.ts tests/brain/access-tree.test.ts`
Expected: FAIL (`rulesMenuLabel`, `folderDeleteBlocks` no existen; los ítems no traen `"rules"`).

- [ ] **Step 3: `folderDeleteBlocks` en `tree.ts`**

Al final de `lib/brain/core/access/tree.ts`:

```ts
export const FOLDER_HAS_CONTENT =
	"Tiene páginas o subcarpetas (también archivadas): vaciala antes de borrarla.";
export const FOLDER_HAS_RULES =
	"Tiene reglas propias: borralas desde «Reglas de la carpeta» antes de borrarla.";

// Por qué no se puede borrar cada carpeta (spec etapa 26 §3.2), sobre el árbol
// SIN podar: brain_delete_folder cuenta toda página bajo el prefijo, archivadas
// y reservadas incluidas. Solo es experiencia: lo oculto lo frena la base.
export function folderDeleteBlocks(root: TreeNode): Map<string, string> {
	const blocks = new Map<string, string>();
	const walk = (node: TreeNode) => {
		if (node.path !== ROOT_PATH) {
			if (node.page !== null || node.children.length > 0)
				blocks.set(node.path, FOLDER_HAS_CONTENT);
			else if (node.rules !== null || node.template !== null)
				blocks.set(node.path, FOLDER_HAS_RULES);
		}
		for (const child of node.children) walk(child);
	};
	walk(root);
	return blocks;
}
```

- [ ] **Step 4: El menú**

En `components/brain/tree-row-menu.tsx`:

Import nuevo: `import { isSkillsFolder, rulesEntryHref } from "@/lib/brain/core/editor/reserved";`.

Reemplazar `FolderMenuItem` y `folderMenuItems` por:

```ts
export type FolderMenuItem =
	| "new-subfolder"
	| "describe"
	| "rules"
	| "delete-folder"
	| "delete-folder-blocked";

// Acciones de carpeta: solo para quien administra. Una carpeta implícita (sin
// fila en brain_folders) no ofrece ninguna: la base pide la fila del padre para
// crear adentro. Borrar una de primer nivel pide administrar la raíz; con
// contenido, el ítem queda deshabilitado con el motivo (spec etapa 26 §3.2).
// Las reglas (26.2): la raíz abre las instrucciones del brain; skills/ no tiene.
export function folderMenuItems(
	node: TreeNode,
	rootLevel: Level | null,
	deleteBlockedReason: string | null,
): FolderMenuItem[] {
	if (node.level !== "administrador" || !isFolderNode(node)) return [];
	if (node.path === "") return ["new-subfolder", "rules"];
	if (node.folder === null) return [];
	const items: FolderMenuItem[] = ["new-subfolder", "describe"];
	if (!isSkillsFolder(node.path)) items.push("rules");
	if (node.path.includes("/") || rootLevel === "administrador")
		items.push(
			deleteBlockedReason === null ? "delete-folder" : "delete-folder-blocked",
		);
	return items;
}

export function rulesMenuLabel(node: TreeNode): string {
	return node.path === "" ? "Instrucciones del brain" : "Reglas de la carpeta";
}
```

En las props de `TreeRowMenu`, sumar `deleteBlockedReason` a la desestructuración y al tipo (`deleteBlockedReason: string | null;`). La llamada pasa a `const folderItems = folderMenuItems(node, rootLevel, deleteBlockedReason);`. Entre el bloque de `"describe"` y el de `"delete-folder"`:

```tsx
	if (folderItems.includes("rules")) {
		items.push(
			<DropdownMenuItem asChild key="rules" className="min-h-11 lg:min-h-0">
				<Link href={rulesEntryHref(tenantSlug, node)}>{rulesMenuLabel(node)}</Link>
			</DropdownMenuItem>,
		);
	}
```

Después del bloque de `"delete-folder"`:

```tsx
	if (folderItems.includes("delete-folder-blocked")) {
		items.push(
			<DropdownMenuItem
				key="delete-folder"
				disabled
				className="min-h-11 flex-col items-start gap-0.5 lg:min-h-0"
			>
				<span>Borrar carpeta…</span>
				<span className="text-muted-foreground text-xs">
					{deleteBlockedReason}
				</span>
			</DropdownMenuItem>,
		);
	}
```

- [ ] **Step 5: El árbol**

En `components/brain/brain-tree.tsx`:

Imports: `ScrollTextIcon` junto a `ChevronRightIcon` (`import { ChevronRightIcon, ScrollTextIcon } from "lucide-react";`) y `folderDeleteBlocks` en el import de `@/lib/brain/core/access/tree`.

Antes de `export function BrainTree(`:

```tsx
// Marca de "tiene reglas" (spec etapa 26 §4.1): solo si la 00-reglas está activa.
function RulesMark({ label }: { label: string }) {
	return (
		<span
			title={label}
			className="inline-flex shrink-0 items-center px-1 text-muted-foreground"
		>
			<ScrollTextIcon aria-hidden className="size-3.5" />
			<span className="sr-only">{label}</span>
		</span>
	);
}
```

Dentro de `BrainTree`, después de `const tree = useMemo(...)`:

```ts
	// Sobre el árbol sin podar: una archivada también impide borrar la carpeta.
	const blocks = useMemo(() => folderDeleteBlocks(root), [root]);
```

En `renderNode`, entre el cierre del `Link`/`button` del label y `<TreeRowMenu`:

```tsx
					{node.rules?.status === "activo" && (
						<RulesMark label="Esta carpeta tiene reglas" />
					)}
```

y en ese `<TreeRowMenu ...>` sumar `deleteBlockedReason={blocks.get(node.path) ?? null}`. En la fila de "Brain", después del `</Link>`:

```tsx
				{root.rules?.status === "activo" && (
					<RulesMark label="El brain tiene instrucciones" />
				)}
```

y en su `<TreeRowMenu ...>` sumar `deleteBlockedReason={null}`.

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/tree-row-menu.test.ts tests/brain/access-tree.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, formato y commit**

Run: `npm run typecheck && npx biome check --write lib/brain/core/access/tree.ts components/brain/tree-row-menu.tsx components/brain/brain-tree.tsx tests/brain/tree-row-menu.test.ts tests/brain/access-tree.test.ts`
Expected: sin errores.

```bash
git add lib/brain/core/access/tree.ts components/brain/tree-row-menu.tsx components/brain/brain-tree.tsx tests/brain/tree-row-menu.test.ts tests/brain/access-tree.test.ts
git commit -m "feat: instrucciones y reglas desde el menú del árbol, con indicador y borrado con motivo (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Índice y búsqueda

**Files:**
- Modify: `app/[tenant]/brain/page.tsx`
- Modify: `components/brain/page-list.tsx`
- Test: `tests/brain/page-list.test.ts` (nuevo)

**Interfaces:**
- Consumes: de Task 1: `listedInIndex<T extends { slug: string }>(pages: readonly T[], searching: boolean): T[]`, `reservedBadge(slug: string): "Reglas" | "Plantilla" | null`. De Task 2: `countPages(node: TreeNode): number`, `TreeNode.rules`.
- Produces: `PageList` muestra la insignia de una reservada; el índice no lista reservadas sin consulta y marca "Reglas" en las carpetas con una `00-reglas` activa.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/brain/page-list.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageList } from "@/components/brain/page-list";
import type { BrainPage } from "@/lib/brain/core/types";

const page = (slug: string): BrainPage => ({
	slug,
	title: slug,
	category: "talento",
	status: "activo",
	tags: [],
	frontmatter: {},
	body: "",
	revision: 1,
	updatedAt: "2026-10-15T00:00:00Z",
});

const render = (pages: BrainPage[]) =>
	renderToStaticMarkup(
		createElement(PageList, { pages, tenantSlug: "acme", counts: new Map() }),
	);

describe("PageList", () => {
	it("una 00-reglas lleva la insignia Reglas", () => {
		expect(render([page("talento/personal/00-reglas")])).toContain(">Reglas<");
	});

	it("una página común no la lleva", () => {
		const html = render([page("talento/personal/leo")]);
		expect(html).not.toContain(">Reglas<");
		expect(html).not.toContain(">Plantilla<");
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/page-list.test.ts`
Expected: FAIL en "una 00-reglas lleva la insignia Reglas".

- [ ] **Step 3: La insignia en la lista**

En `components/brain/page-list.tsx`, sumar `import { reservedBadge } from "@/lib/brain/core/editor/reserved";`. Dentro del `map`, después de `const canon = ...;`:

```ts
				const badge = reservedBadge(page.slug);
```

y entre el `<span>` de la categoría y el `canon.map(...)`:

```tsx
							{badge && (
								<span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground text-xs">
									{badge}
								</span>
							)}
```

- [ ] **Step 4: El índice**

En `app/[tenant]/brain/page.tsx`:

- Sumar `countPages` al import de `@/lib/brain/core/access/tree` y `import { listedInIndex } from "@/lib/brain/core/editor/reserved";`.
- Borrar la función local `const countPages = (node: TreeNode): number => ...;` (tres líneas).
- Reemplazar:

```ts
	const listed = browsing
		? visible.filter((p) => !p.slug.includes("/"))
		: visible;
```

por:

```ts
	// Las reservadas no se mezclan con las páginas comunes; la búsqueda sí las
	// encuentra, con su insignia (spec etapa 26 §4.1).
	const listed = listedInIndex(
		browsing ? visible.filter((p) => !p.slug.includes("/")) : visible,
		q.trim() !== "",
	);
```

- En la fila de cada carpeta, dentro de `<span className="min-w-0 flex-1">`, reemplazar el `<span className="block truncate font-medium">` que envuelve `{node.name}` (en el código ocupa tres líneas) por:

```tsx
									<span className="flex min-w-0 items-center gap-2">
										<span className="truncate font-medium">{node.name}</span>
										{node.rules?.status === "activo" && (
											<span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground text-xs">
												Reglas
											</span>
										)}
									</span>
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/page-list.test.ts tests/brain/editor-reserved.test.ts tests/brain/access-tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, formato y commit**

Run: `npm run typecheck && npx biome check --write "app/[tenant]/brain/page.tsx" components/brain/page-list.tsx tests/brain/page-list.test.ts`
Expected: sin errores (si `TreeNode` queda sin uso en el import de `page.tsx`, sigue usándose en `findNode`: no sacarlo).

```bash
git add "app/[tenant]/brain/page.tsx" components/brain/page-list.tsx tests/brain/page-list.test.ts
git commit -m "feat: el índice del brain separa las reglas y la búsqueda las marca (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: La categoría sale de la ruta y "Nueva página" arranca en una carpeta

**Files:**
- Create: `lib/brain/core/editor/page-category.ts`
- Modify: `lib/brain/core/editor/new-page.ts`
- Modify: `components/brain/editor/page-workspace.tsx` (sin selector de categoría)
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx`, `app/[tenant]/brain/nueva/page.tsx` (sin `categories`)
- Test: `tests/brain/editor-page-category.test.ts` (nuevo), `tests/brain/editor-new-page.test.ts` (reemplazo completo)

**Interfaces:**
- Consumes: `categoryForPath(slug: string): string` de `lib/brain/core/folders.ts` (primer segmento; `skills` → `skill`); `BRAIN_CATEGORY`, `RULES_LEAF`, `MAX_SLUG_LENGTH`, `SLUG_PATTERN` de `lib/brain/core/types.ts`; de Task 1: `isSkillsFolder`. De Task 5: la versión de `nueva/page.tsx` con `shared`.
- Produces: `pageCategory(slug: string, current: string): string`; `resolveNewPagePrefix(en: string | undefined, editableFolders: string[]): string` arranca en la primera carpeta editable que no es la raíz ni `skills`; `PageWorkspaceProps` **sin** `categories`.

Contexto: desde la 26.1a el servidor calcula la categoría por la ruta (`createWikiProvider.upsert`) y pisa la que manda el editor; el selector seguía ofreciendo `config.categories`, que ahora sale en orden alfabético, y "Nueva página" arrancaba en `categories[0]`. `savePage` corre `skillPlacementOk(input.slug, input.category)` solo para elegir el mensaje de un error de validación: con la categoría derivada de la ruta, siempre coinciden y `save.ts` no cambia.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/brain/editor-page-category.test.ts
import { describe, expect, it } from "vitest";
import { pageCategory } from "@/lib/brain/core/editor/page-category";
import { runtimePackages } from "./client-safe";

describe("pageCategory", () => {
	it("una página en una carpeta toma el primer segmento", () => {
		expect(pageCategory("comercial/icp", "x")).toBe("comercial");
		expect(pageCategory("comercial/", "")).toBe("comercial");
		expect(pageCategory("skills/facturacion", "")).toBe("skill");
	});

	it("las instrucciones del brain son de la categoría brain", () => {
		expect(pageCategory("00-reglas", "comercial")).toBe("brain");
	});

	it("una página suelta de la raíz conserva la suya", () => {
		expect(pageCategory("suelta", "operacion")).toBe("operacion");
		expect(pageCategory("", "")).toBe("");
	});

	it("no arrastra node:* al cliente", () => {
		for (const entry of [
			"lib/brain/core/editor/page-category.ts",
			"lib/brain/core/editor/new-page.ts",
		])
			expect(runtimePackages(entry).filter((p) => p.startsWith("node:"))).toEqual(
				[],
			);
	});
});
```

`tests/brain/editor-new-page.test.ts` queda:

```ts
import { describe, expect, it } from "vitest";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";

describe("resolveNewPagePrefix", () => {
	it("precarga la carpeta si es editable", () => {
		expect(resolveNewPagePrefix("comercial", ["comercial", "legal"])).toBe(
			"comercial/",
		);
	});
	it("una carpeta que no es editable arranca en la primera editable", () => {
		expect(resolveNewPagePrefix("direccion", ["comercial"])).toBe("comercial/");
	});
	it("ignora lo que no es un slug válido, sin importar si figura en la lista", () => {
		expect(resolveNewPagePrefix("../x", ["../x"])).toBe("");
		expect(resolveNewPagePrefix("A B", ["A B"])).toBe("");
	});
	it("sin parámetro arranca en la primera carpeta editable que no es la raíz ni skills", () => {
		expect(resolveNewPagePrefix(undefined, ["", "comercial", "legal"])).toBe(
			"comercial/",
		);
		expect(resolveNewPagePrefix(undefined, ["", "skills", "talento"])).toBe(
			"talento/",
		);
		expect(resolveNewPagePrefix("", ["", "comercial"])).toBe("comercial/");
	});
	it("si solo puede escribir en la raíz, no precarga nada", () => {
		expect(resolveNewPagePrefix(undefined, [""])).toBe("");
		expect(resolveNewPagePrefix("", [""])).toBe("");
	});
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/brain/editor-page-category.test.ts tests/brain/editor-new-page.test.ts`
Expected: FAIL (no existe `page-category`; `resolveNewPagePrefix(undefined, ...)` devuelve `""`).

- [ ] **Step 3: Implementar**

```ts
// lib/brain/core/editor/page-category.ts
// La categoría la decide el servidor por la ruta (spec etapa 26 D1): el editor
// muestra la misma y la manda igual, para que coincidan. Apto para el cliente.
import { categoryForPath } from "../folders.ts";
import { BRAIN_CATEGORY, RULES_LEAF } from "../types.ts";

export function pageCategory(slug: string, current: string): string {
	if (slug.includes("/")) return categoryForPath(slug);
	if (slug === RULES_LEAF) return BRAIN_CATEGORY;
	// Una página suelta de la raíz que ya existía conserva la suya.
	return current;
}
```

`lib/brain/core/editor/new-page.ts` queda:

```ts
// Prefijo con el que se precarga el slug de una página nueva (spec etapa 17
// §7.2, "Nueva página acá"). El valor viene de la URL: solo se acepta una
// carpeta con slug válido donde la persona puede escribir. Sin él, arranca en
// la primera carpeta editable (una página nueva no va en la raíz, spec etapa 26
// §3.1), salvo skills/, donde lo que se crea es una skill.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";
import { isSkillsFolder } from "./reserved.ts";

const isValid = (folder: string) =>
	folder.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(folder);

export function resolveNewPagePrefix(
	en: string | undefined,
	editableFolders: string[],
): string {
	if (en && isValid(en) && editableFolders.includes(en)) return `${en}/`;
	const first = editableFolders.find(
		(folder) => isValid(folder) && !isSkillsFolder(folder),
	);
	return first ? `${first}/` : "";
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/editor-page-category.test.ts tests/brain/editor-new-page.test.ts`
Expected: PASS.

- [ ] **Step 5: El espacio de trabajo sin selector**

En `components/brain/editor/page-workspace.tsx`:

- Import nuevo: `import { pageCategory } from "@/lib/brain/core/editor/page-category";`.
- Sacar `categories: string[];` de `PageWorkspaceProps` y `categories,` de la desestructuración.
- Antes de `export interface WorkspaceInitial`, sumar:

```ts
// Una página nueva que deja de ser skill no se lleva sus campos de skill.
function withoutSkillFields(
	frontmatter: Record<string, unknown>,
): Record<string, unknown> {
	const { description: _d, compatibility: _c, ...rest } = frontmatter;
	return rest;
}
```

- Reemplazar `const isSkill = form.category === SKILL_CATEGORY;` por:

```ts
	// La categoría sale de la ruta, como la calcula el servidor (spec etapa 26 D1).
	const category = pageCategory(form.slug, saved.category);
	const isSkill = category === SKILL_CATEGORY;
```

- En `dirty`, borrar la línea `form.category !== saved.category ||`.
- En `submit`, dentro de `saveBrainPage({...})`, reemplazar `category: form.category,` por `category,` y `frontmatter: form.frontmatter,` por:

```ts
					frontmatter:
						mode === "new" && !isSkill
							? withoutSkillFields(form.frontmatter)
							: form.frontmatter,
```

- En el `setSaved({ ...form, tags, body, revision: outcome.revision })` del guardado, cambiar a `setSaved({ ...form, category, tags, body, revision: outcome.revision });`.
- En `detailsFields`, reemplazar todo el `<label className="block space-y-1"> <span>Categoría</span> <select ...> ... </select> </label>` (el primer label) por:

```tsx
			<div className="space-y-1">
				<span className="block">Categoría</span>
				<span className="block text-muted-foreground">
					<span className="capitalize">{category || "—"}</span>: sale de la
					carpeta de la página.
				</span>
			</div>
```

- En el header, `<span className="capitalize">{form.category}</span>` pasa a `<span className="capitalize">{category}</span>`.

- [ ] **Step 6: Las páginas del servidor**

En `app/[tenant]/brain/p/[...slug]/page.tsx`, borrar la prop `categories={ctx.categories}` de `<PageWorkspace mode="edit" ...>`.

En `app/[tenant]/brain/nueva/page.tsx` (versión de la Task 5): sumar `import { pageCategory } from "@/lib/brain/core/editor/page-category";`, borrar `categories: ctx.categories,` del objeto `shared`, y en los dos `initial` reemplazar `category: ctx.categories[0],` por `category: pageCategory(target.slug, ""),` (rama de reglas) y `category: pageCategory(prefix, ""),` (rama común).

- [ ] **Step 7: Correr los tests del brain, typecheck y formato**

Run: `npx vitest run tests/brain && npm run typecheck && npx biome check --write lib/brain/core/editor/page-category.ts lib/brain/core/editor/new-page.ts components/brain/editor/page-workspace.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" "app/[tenant]/brain/nueva/page.tsx" tests/brain/editor-page-category.test.ts tests/brain/editor-new-page.test.ts`
Expected: PASS y sin errores. `typecheck` falla si quedó algún `categories=` pasado a `PageWorkspace`: sacarlo.

- [ ] **Step 8: Commit**

```bash
git add lib/brain/core/editor/page-category.ts lib/brain/core/editor/new-page.ts components/brain/editor/page-workspace.tsx "app/[tenant]/brain/p/[...slug]/page.tsx" "app/[tenant]/brain/nueva/page.tsx" tests/brain/editor-page-category.test.ts tests/brain/editor-new-page.test.ts
git commit -m "fix: el editor muestra la categoría de la ruta y Nueva página arranca en una carpeta (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Borrar una reservada exige administrar su carpeta

**Files:**
- Modify: `lib/brain/core/editor/delete.ts` (`authorize`)
- Test: `tests/brain/editor-delete.test.ts`

**Interfaces:**
- Consumes: de Task 1: `folderOfPage(slug: string): string`, `isReservedSlug(slug: string): boolean` (`lib/brain/core/reserved-slugs.ts`). `resolveAccess` (ya importado en `delete.ts`).
- Produces: `previewDelete` y `deletePage` responden `{ ok: false, code: "forbidden", message: "Las reglas y la plantilla de una carpeta las borra quien administra esa carpeta." }` para una reservada si quien borra no administra su carpeta, aunque administre la página por una regla propia.

- [ ] **Step 1: Escribir el test que falla**

Al final de `tests/brain/editor-delete.test.ts`:

```ts
describe("páginas reservadas", () => {
	const PAGES_WITH_RULES = [
		...PAGES,
		page("comercial/00-reglas", "Reglas de comercial"),
	];

	it("administrar solo la 00-reglas no alcanza para borrarla", async () => {
		const { deps, del } = setup({
			role: "tenant_member",
			userId: "ana",
			pages: PAGES_WITH_RULES,
			rules: [members("", "lector"), user("comercial/00-reglas", "ana", "administrador")],
		});
		expect(await previewDelete("i", "comercial/00-reglas", deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(await deletePage("i", "comercial/00-reglas", 3, deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("quien administra la carpeta la borra", async () => {
		const { deps } = setup({ ...MEMBER_OF_COMERCIAL, pages: PAGES_WITH_RULES });
		expect(await previewDelete("i", "comercial/00-reglas", deps)).toMatchObject({
			ok: true,
		});
	});
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/brain/editor-delete.test.ts`
Expected: FAIL en "administrar solo la 00-reglas no alcanza para borrarla" (devuelve `ok: true`).

- [ ] **Step 3: Implementar**

En `lib/brain/core/editor/delete.ts`, sumar `import { folderOfPage, isReservedSlug } from "../reserved-slugs.ts";` y, en `authorize`, después de:

```ts
	if (level !== "administrador") {
		return fail("forbidden", "Solo un administrador puede borrar esta página.");
	}
```

agregar:

```ts
	// Una reservada es gobierno de su carpeta (spec etapa 26 §4.1): la borra
	// quien administra la carpeta, igual que quien la escribe (withAccess).
	if (
		isReservedSlug(slug) &&
		resolveAccess(rules, principal, folderOfPage(slug)) !== "administrador"
	) {
		return fail(
			"forbidden",
			"Las reglas y la plantilla de una carpeta las borra quien administra esa carpeta.",
		);
	}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/brain/editor-delete.test.ts tests/brain/delete-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, formato y commit**

Run: `npm run typecheck && npx biome check --write lib/brain/core/editor/delete.ts tests/brain/editor-delete.test.ts`
Expected: sin errores.

```bash
git add lib/brain/core/editor/delete.ts tests/brain/editor-delete.test.ts
git commit -m "fix: borrar una página reservada exige administrar su carpeta (26.2b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Documentación y cierre de la rama

**Files:**
- Modify: `docs/dominios/brain.md`, `lib/brain/README.md`, `docs/producto/roadmap.md`, `docs/_meta/cobertura.ts` (solo si el check lo pide)
- Regenerate: `docs/referencia/` con `npm run docs:sync`

- [ ] **Step 1: Toda la suite**

Run: `npm test && npm run typecheck`
Expected: PASS. Si falla algo fuera de `tests/brain`, ver si lo rompió esta rama antes de seguir.

- [ ] **Step 2: Documentar**

En `docs/dominios/brain.md`, después de "### Instrucciones y reglas (etapa 26.2a)" y sus pendientes, una sección "### Reglas en el editor web (etapa 26.2b)" con:
- el panel "Reglas que aplican" (arriba del papel, plegado; no aparece si la ruta no tiene reglas, no se ve o es de `skills/`); en "Nueva página" sigue a la carpeta del slug (`loadNewPageRules`, sondeo `<carpeta>/nueva-pagina`, 300 ms); filtrado como el MCP (`ctx.rules`), las que la persona no puede abrir van sin link; no exige nada al guardar;
- el árbol: las reservadas son marcas `rules`/`template` de su carpeta, el indicador solo si la `00-reglas` está activa, `countPages` no las cuenta; el menú "Instrucciones del brain" (raíz) y "Reglas de la carpeta" abre la existente en cualquier estado o crea en `/brain/nueva?reglas=1[&en=]`, en borrador y con el slug fijo; "Borrar carpeta" deshabilitado con el motivo (`folderDeleteBlocks`);
- quien no administra la carpeta abre una reservada en lectura (`entryLevel`) y no la puede borrar (`delete.ts`);
- el índice no lista reservadas sin consulta; la búsqueda las marca "Reglas" o "Plantilla";
- la categoría del editor sale de la ruta (`pageCategory`) y "Nueva página" arranca en la primera carpeta editable que no es `skills`;
- los módulos aptos para el cliente (`reserved-slugs.ts`, `editor/reserved.ts`) y el test que verifica que no llegan a `node:*` (`tests/brain/client-safe.ts`).

En la lista "Pendientes conocidos de la 26.2a", marcar como resueltos por la 26.2b el borrado de una reservada y la línea de pantallas. En la tabla "Cómo se prueba", sumar `editor-reserved`, `editor-rules-panel`, `rules-panel`, `rules-panel-hook`, `reserved-notice`, `page-list`, `editor-page-category`. En "Decisiones", sumar el link al plan de la 26.2b. En `lib/brain/README.md`, sumar `reserved-slugs.ts`, `editor/reserved.ts` y `editor/rules-panel.ts` donde se listan los módulos de `core`. Actualizar `updated:` de cada página tocada.

En `docs/producto/roadmap.md`, sección Etapa 26, el estado de la 26.2b: "código terminado en la rama, sin mergear; falta el cierre (QA en navegador)". No tiene migraciones.

- [ ] **Step 3: Regenerar la referencia y verificar la wiki**

Run: `npm run docs:sync && npm run docs:check`
Expected: PASS. Esta entrega no suma rutas (`page.tsx`/`route.ts`), tools, tablas ni variables: si el check pide algo, escribir la página, no una exclusión.

- [ ] **Step 4: Commit**

```bash
git add docs lib/brain/README.md
git commit -m "docs: reglas en el editor web en la wiki y estado de la 26.2b

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Cierre (lo hace una persona)

No hay migraciones: se despliega solo el código. Antes del merge, una persona prueba en el navegador.

**Levantar la rama contra la base local** (no usar `preview_start`, que sirve el checkout principal contra producción): con Docker abierto, `npm run db:start` y `npm run db:reset` (carga `seed.sql` y `seed-evals.sql`); en el worktree, `npm ci`, un `.env.local` con la URL y las llaves **locales** (`npx supabase status -o env`), y `npm run dev -- --port 3100` desde la terminal del worktree. El tenant `eval-outreach` tiene brain `wiki`, carpetas `comercial` y `marketing` y una `00-reglas` en la raíz. Los usuarios del seed no reciben código: para entrar, `update tenants set self_signup_by_domain = true where slug = 'eval-outreach';`, ingresar con un mail nuevo `@outreach.test` (código en Mailpit, `127.0.0.1:54324`) y, para probar como administrador, `update memberships set role = 'tenant_admin' where user_id = (select id from auth.users where email = '<ese mail>');`. Para probar como miembro, un segundo mail nuevo y una regla de acceso que le saque `marketing`.

**Checklist** (escritorio y a 375 px):

- [ ] Como administrador, el árbol no lista `00-reglas` como página; al lado de "Brain" aparece el indicador de instrucciones.
- [ ] Menú de "Brain" → "Instrucciones del brain" abre la `00-reglas` existente en el editor, con el aviso, el contador "N de 12.000 caracteres" y el panel sin entradas de arriba (la raíz no tiene niveles arriba: el panel no aparece).
- [ ] Menú de `comercial` → "Reglas de la carpeta" abre `/brain/nueva?reglas=1&en=comercial`: título "Reglas de comercial", slug fijo, estado Borrador, aviso con el tope de 20.000 y el panel con las instrucciones del brain. Guardar crea la página; activarla hace aparecer el indicador en `comercial` y la insignia "Reglas" en la fila de `comercial` del índice.
- [ ] Abrir una página de `comercial` en el editor: el panel "Reglas que aplican (2)" plegado; al abrirlo, las dos reglas con "Abrir", renderizadas como markdown.
- [ ] "Nueva página" arranca en una carpeta (no en la raíz ni en `skills`); escribir en el slug `marketing/x` cambia el panel a las reglas de `marketing` (o lo saca si no tiene), sin parpadeos ni respuestas viejas.
- [ ] La categoría del editor se ve como texto ("sale de la carpeta de la página") y coincide con la carpeta del slug.
- [ ] Buscar "reglas" en el índice encuentra las `00-reglas` con la insignia "Reglas"; sin búsqueda, el índice y `?carpeta=comercial` no las listan, y una carpeta con solo su `00-reglas` dice "Vacía".
- [ ] En una carpeta con solo su `00-reglas`, "Borrar carpeta…" aparece deshabilitado con el motivo; en una con páginas, también; en una vacía de verdad, se puede borrar.
- [ ] Archivar la `00-reglas` de `comercial`: desaparece el indicador, y "Reglas de la carpeta" sigue abriendo la archivada (no ofrece crear otra).
- [ ] Como miembro sin acceso a `marketing`: "Nueva página" con `?en=marketing` no muestra panel; escribir `marketing/x` tampoco; una página de `comercial` muestra el panel; el menú no ofrece "Reglas de la carpeta"; abrir `/brain/p/comercial/00-reglas` la muestra en lectura.
- [ ] A 375 px: el panel plegado no rompe el ancho, el contador y el aviso se leen, el menú del árbol (en el panel "Archivos") se toca bien, y después de cerrar un diálogo el body no queda con `pointer-events: none`.
- [ ] Una página de `skills/` no muestra el panel de reglas.

Después del merge: `/docs-wiki` en verde y el roadmap con la 26.2b mergeada.

## Planes siguientes

- **Etiquetas de las tools del brain en `TOOL_LABELS`** (pendiente de la 26.2a): `brain_search`, `brain_read` y `brain_upsert` muestran "Trabajando…" porque eve nombra las tools por su clave y `TOOL_LABELS` tiene `brain`; el test de `tests/agents/running-tool.test.ts` compara contra los nombres de archivo. Queda afuera porque es otra superficie (el indicador del chat), no toca los archivos de esta entrega y el test necesita decidir cómo leer las claves reales de cada archivo de tools (verificar en `node_modules/eve/docs` cómo llega `toolName`).
- **26.1b · Mover y renombrar** (spec §3.3): `00-reglas` y `00-plantilla` viajan con su carpeta y no se mueven solas.
- **26.3 · Estructura obligatoria** (spec §5): la marca `template` del árbol y el panel son el lugar natural del formulario de campos y la plantilla.
- Pendientes de la 26.2a que siguen abiertos: `requireRules` chequea visibilidad y no `editor`; en el `brain_upsert` del MCP las reglas se leen antes del limitador; la aprobación del agente ocurre antes de un `rules_required`.
- Una carpeta implícita (sin fila en `brain_folders`) no ofrece "Reglas de la carpeta" aunque tenga una: si aparece alguna en producción, la acción de plataforma "recrear carpetas" de la 26.1a la resuelve.
