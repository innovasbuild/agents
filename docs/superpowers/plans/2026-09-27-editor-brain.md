# Editor del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un miembro del tenant lea el brain, vea cómo se conectan sus páginas y (si es admin) lo edite desde `/[tenant]/brain`.

**Architecture:** Módulos puros en `lib/brain/` (wikilinks, índice de links, diff, links de markdown, guardado) testeados con vitest; pantallas server-first en `app/[tenant]/brain/` que leen `brain_pages` y `brain_revisions` con el cliente de sesión (RLS existente) y escriben solo por `provider.upsert` con autor `user`. Sin migraciones ni SQL nuevo.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (`@supabase/ssr`), shadcn (estilo `radix-nova`), vitest, `react-markdown` + `remark-gfm` (nuevas).

**Spec:** `docs/superpowers/specs/2026-09-27-editor-brain-design.md` (y la base `docs/superpowers/specs/2026-09-13-brain-design.md` §3, §5 y §8).

## Global Constraints

- Trabajar en `/Users/mok/Sites/innovas/agents/.claude/worktrees/editor-brain`, rama `feat/editor-brain`. Nunca `cd` al checkout principal ni a otros worktrees.
- Sin migraciones, sin SQL nuevo, sin tocar `lib/brain/mcp-server/`, `brain_upsert_page` ni `lib/brain/wiki-store.ts` (Etapa 6 corre en paralelo).
- Único camino de escritura: `getBrainProvider(binding).upsert(write, { kind: "user", userId })`.
- Leen todos los miembros; escriben `tenant_admin` y `platform_admin`. El chequeo de rol se repite en la server action.
- Solo proveedor `wiki`. Binding `mcp`: aviso en `/brain` y 404 en el resto.
- Rutas: vista en `/[tenant]/brain/p/[...slug]`, edición en `/[tenant]/brain/editar/[...slug]`, historial en `/[tenant]/brain/historial/[...slug]`, cuerpo crudo en `/[tenant]/brain/raw/[...slug]`. Un catch-all de Next tiene que ser el último segmento: `p/[...slug]/editar` no compila.
- Markdown sin HTML crudo (sin `rehype-raw`).
- Español rioplatense en UI y comentarios; código e identificadores en inglés.
- Imports dentro de `lib/brain/` relativos con extensión `.ts` en los módulos que importa el script de import (`lib/brain/wikilinks.ts`); el resto usa `@/`.
- Estilo del repo: tabs, biome. `npm run lint:fix` reformatea cuatro archivos ajenos: revertirlos antes de commitear (`git checkout -- <archivo>` de los que no son de esta tarea).
- Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos: `npm test -- <ruta>`, `npm run typecheck`, `npm run lint:fix`, `npm run dev`.

## Review Focus

1. **Wikilink dentro de un bloque de código o de código inline** → se muestra literal, no como link (test en Task 4).
2. **Título con `]`, `[` o `|` elegido en el autocompletado** → el alias insertado no rompe la sintaxis `[[slug|alias]]` (test en Task 9, `sanitizeAlias`).
3. **Slug de la URL inválido o con mayúsculas / `..` / segmentos vacíos** → 404, nunca una excepción ni una query con basura (test en Task 6, `slugFromParams`).
4. **Cuerpos con fin de línea `\r\n` contra `\n`** → el diff no marca todas las líneas como cambiadas (test en Task 3).
5. **Página nueva con un slug que ya existe** → aviso "ya existe una página con ese slug", sin pisarla (test en Task 5).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `lib/brain/wikilinks.ts` (nuevo) | Regex compartida y `parseWikilinks` |
| `lib/brain/import/document.ts` (modificar) | Importa la regex de `wikilinks.ts` |
| `lib/brain/links.ts` (nuevo) | `buildLinkIndex`, conexiones entre páginas |
| `lib/brain/diff.ts` (nuevo) | `diffLines`, `diffMeta` |
| `lib/brain/editor/markdown-links.ts` (nuevo) | Convierte wikilinks en links markdown `wiki:` salteando código |
| `lib/brain/editor/save.ts` (nuevo) | Lógica de guardado testeable, sin Next |
| `lib/brain/editor/slug.ts` (nuevo) | `slugFromParams`, `pageHref` |
| `lib/brain/editor/load.ts` (nuevo) | Contexto del editor y carga de páginas y revisiones |
| `lib/brain/editor/autocomplete.ts` (nuevo) | `wikilinkQueryAt`, `sanitizeAlias`, `insertWikilink` |
| `components/brain/markdown.tsx` (nuevo) | Render de markdown con wikilinks |
| `components/brain/page-list.tsx` (nuevo) | Lista de páginas por categoría (índice) |
| `components/brain/diff-view.tsx` (nuevo) | Render de bloques de diff |
| `app/[tenant]/layout.tsx` (modificar) | Ítem "Brain" en la nav |
| `app/[tenant]/brain/page.tsx` | Índice |
| `app/[tenant]/brain/mapa/page.tsx` | Mapa de conexiones |
| `app/[tenant]/brain/p/[...slug]/page.tsx` | Página con panel de conexiones |
| `app/[tenant]/brain/editar/[...slug]/page.tsx` | Edición |
| `app/[tenant]/brain/raw/[...slug]/route.ts` | Cuerpo vigente en texto, para el diff del conflicto |
| `app/[tenant]/brain/nueva/page.tsx` | Alta |
| `app/[tenant]/brain/page-form.tsx` | Formulario cliente compartido |
| `app/[tenant]/brain/historial/[...slug]/page.tsx` | Historial |
| `app/[tenant]/brain/historial/[...slug]/restore-button.tsx` | Botón restaurar (cliente) |
| `app/[tenant]/brain/actions.ts` | Server action `saveBrainPage` |

---

### Task 1: Wikilinks compartidos

**Files:**
- Create: `lib/brain/wikilinks.ts`
- Modify: `lib/brain/import/document.ts:26` (quitar la constante local e importarla)
- Test: `tests/brain/wikilinks.test.ts`

**Interfaces:**
- Produces: `WIKILINK_PATTERN: RegExp` (global) · `interface Wikilink { target: string; anchor: string | null; alias: string | null; start: number; end: number }` · `parseWikilinks(body: string): Wikilink[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/wikilinks.test.ts
import { describe, expect, it } from "vitest";
import { parseWikilinks } from "@/lib/brain/wikilinks";

describe("parseWikilinks", () => {
	it("lee slug solo, con alias y con ancla", () => {
		const body = "Ver [[comercial/icp]], [[marketing/voz|la voz]] y [[producto/radar#precio|precio del Radar]].";
		expect(parseWikilinks(body).map(({ target, anchor, alias }) => ({ target, anchor, alias }))).toEqual([
			{ target: "comercial/icp", anchor: null, alias: null },
			{ target: "marketing/voz", anchor: null, alias: "la voz" },
			{ target: "producto/radar", anchor: "precio", alias: "precio del Radar" },
		]);
	});

	it("devuelve posiciones que recortan el wikilink exacto", () => {
		const body = "a [[x|y]] b";
		const [link] = parseWikilinks(body);
		expect(body.slice(link.start, link.end)).toBe("[[x|y]]");
	});

	it("recorta espacios del target y del alias", () => {
		expect(parseWikilinks("[[ x | y ]]")[0]).toMatchObject({ target: "x", alias: "y" });
	});

	it("sin wikilinks devuelve lista vacía y se puede llamar dos veces seguidas", () => {
		expect(parseWikilinks("texto [simple](http://a.b)")).toEqual([]);
		expect(parseWikilinks("[[a]]")).toHaveLength(1);
		expect(parseWikilinks("[[a]]")).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/wikilinks.test.ts`
Expected: FAIL, no se resuelve `@/lib/brain/wikilinks`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/brain/wikilinks.ts
// Wikilinks del brain: [[slug]], [[slug|alias]], [[slug#ancla|alias]]. Los
// comparten el import (que los reescribe a slugs canónicos) y el editor (que
// arma conexiones y los renderiza). Sin imports: lo usa un script con Node.

export const WIKILINK_PATTERN = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export interface Wikilink {
	target: string;
	anchor: string | null;
	alias: string | null;
	start: number;
	end: number;
}

export function parseWikilinks(body: string): Wikilink[] {
	const links: Wikilink[] = [];
	for (const match of body.matchAll(WIKILINK_PATTERN)) {
		const start = match.index ?? 0;
		links.push({
			target: match[1].trim(),
			anchor: match[2] ? match[2].slice(1).trim() || null : null,
			alias: match[3]?.trim() || null,
			start,
			end: start + match[0].length,
		});
	}
	return links;
}
```

En `lib/brain/import/document.ts`, borrar la línea `const WIKILINK = /\[\[...]/g;` y agregar arriba:

```ts
import { WIKILINK_PATTERN as WIKILINK } from "../wikilinks.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/brain/wikilinks.test.ts tests/brain/import`
Expected: PASS (los del import siguen en verde).

- [ ] **Step 5: Commit**

```bash
git add lib/brain/wikilinks.ts lib/brain/import/document.ts tests/brain/wikilinks.test.ts
git commit -m "refactor: regex de wikilinks compartida entre import y editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Índice de conexiones

**Files:**
- Create: `lib/brain/links.ts`
- Test: `tests/brain/links.test.ts`

**Interfaces:**
- Consumes: `parseWikilinks` (Task 1), `BrainStatus` de `lib/brain/types.ts`
- Produces:
```ts
interface LinkPage { slug: string; title: string; category: string; status: BrainStatus; body: string }
interface OutgoingLink { target: string; alias: string | null; anchor: string | null; broken: boolean; archived: boolean }
interface LinkIndex {
  outgoing: Map<string, OutgoingLink[]>;
  incoming: Map<string, string[]>;
  broken: { source: string; target: string }[];
  orphans: string[];
}
function buildLinkIndex(pages: LinkPage[]): LinkIndex
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/links.test.ts
import { describe, expect, it } from "vitest";
import { buildLinkIndex, type LinkPage } from "@/lib/brain/links";

const page = (slug: string, body: string, status: LinkPage["status"] = "activo"): LinkPage => ({
	slug, title: slug, category: slug.split("/")[0], status, body,
});

describe("buildLinkIndex", () => {
	it("arma salientes en orden y entrantes ordenados", () => {
		const index = buildLinkIndex([
			page("a/uno", "[[b/dos]] y [[c/tres|tres]]"),
			page("b/dos", "[[c/tres]]"),
			page("c/tres", ""),
		]);
		expect(index.outgoing.get("a/uno")?.map((l) => l.target)).toEqual(["b/dos", "c/tres"]);
		expect(index.incoming.get("c/tres")).toEqual(["a/uno", "b/dos"]);
		expect(index.incoming.get("a/uno")).toEqual([]);
	});

	it("marca rotos y los junta con su origen", () => {
		const index = buildLinkIndex([page("a/uno", "[[no/existe]]")]);
		expect(index.outgoing.get("a/uno")?.[0]).toMatchObject({ target: "no/existe", broken: true });
		expect(index.broken).toEqual([{ source: "a/uno", target: "no/existe" }]);
	});

	it("un autolink no cuenta como entrante ni saca de huérfana", () => {
		const index = buildLinkIndex([page("a/uno", "[[a/uno]]")]);
		expect(index.incoming.get("a/uno")).toEqual([]);
		expect(index.orphans).toEqual(["a/uno"]);
	});

	it("un target repetido cuenta una vez", () => {
		const index = buildLinkIndex([page("a/uno", "[[b/dos]] [[b/dos|otra vez]]"), page("b/dos", "")]);
		expect(index.outgoing.get("a/uno")).toHaveLength(1);
		expect(index.incoming.get("b/dos")).toEqual(["a/uno"]);
	});

	it("link a archivada no es roto; link desde archivada no cuenta; archivadas no son huérfanas", () => {
		const index = buildLinkIndex([
			page("a/uno", "[[b/vieja]]"),
			page("b/vieja", "[[c/sola]]", "archivado"),
			page("c/sola", ""),
		]);
		expect(index.outgoing.get("a/uno")?.[0]).toMatchObject({ broken: false, archived: true });
		expect(index.incoming.get("c/sola")).toEqual([]);
		expect(index.orphans).toEqual(["a/uno", "c/sola"]);
		expect(index.broken).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/links.test.ts`
Expected: FAIL, no se resuelve `@/lib/brain/links`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/brain/links.ts
// Conexiones entre páginas del brain, calculadas al leer (spec editor §4.2).
// Pura: recibe las páginas del tenant ya cargadas.
import type { BrainStatus } from "./types";
import { parseWikilinks } from "./wikilinks";

export interface LinkPage {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	body: string;
}

export interface OutgoingLink {
	target: string;
	alias: string | null;
	anchor: string | null;
	broken: boolean;
	archived: boolean;
}

export interface LinkIndex {
	outgoing: Map<string, OutgoingLink[]>;
	incoming: Map<string, string[]>;
	broken: { source: string; target: string }[];
	orphans: string[];
}

export function buildLinkIndex(pages: LinkPage[]): LinkIndex {
	const bySlug = new Map(pages.map((p) => [p.slug, p]));
	const outgoing = new Map<string, OutgoingLink[]>();
	const incomingSets = new Map<string, Set<string>>(pages.map((p) => [p.slug, new Set()]));
	const broken: { source: string; target: string }[] = [];

	for (const source of pages) {
		const seen = new Set<string>();
		const links: OutgoingLink[] = [];
		for (const link of parseWikilinks(source.body)) {
			if (seen.has(link.target)) continue;
			seen.add(link.target);
			const target = bySlug.get(link.target);
			links.push({
				target: link.target,
				alias: link.alias,
				anchor: link.anchor,
				broken: !target,
				archived: target?.status === "archivado",
			});
			if (!target) broken.push({ source: source.slug, target: link.target });
			else if (target.slug !== source.slug && source.status !== "archivado")
				incomingSets.get(target.slug)?.add(source.slug);
		}
		outgoing.set(source.slug, links);
	}

	const incoming = new Map<string, string[]>();
	for (const [slug, set] of incomingSets) incoming.set(slug, [...set].sort());

	const orphans = pages
		.filter((p) => p.status !== "archivado" && (incoming.get(p.slug)?.length ?? 0) === 0)
		.map((p) => p.slug)
		.sort();

	return { outgoing, incoming, broken, orphans };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/brain/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/links.ts tests/brain/links.test.ts
git commit -m "feat: índice de conexiones entre páginas del brain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Diff de revisiones

**Files:**
- Create: `lib/brain/diff.ts`
- Test: `tests/brain/diff.test.ts`

**Interfaces:**
- Produces:
```ts
type DiffBlock = { kind: "equal" | "added" | "removed"; lines: string[] };
function diffLines(a: string, b: string): DiffBlock[]
interface MetaSnapshot { title: string; category: string; status: string; tags: string[] }
interface MetaChange { field: "title" | "category" | "status"; from: string; to: string }
function diffMeta(a: MetaSnapshot, b: MetaSnapshot): { changes: MetaChange[]; tagsAdded: string[]; tagsRemoved: string[] }
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/diff.test.ts
import { describe, expect, it } from "vitest";
import { diffLines, diffMeta } from "@/lib/brain/diff";

describe("diffLines", () => {
	it("textos iguales dan un solo bloque equal", () => {
		expect(diffLines("a\nb", "a\nb")).toEqual([{ kind: "equal", lines: ["a", "b"] }]);
	});

	it("detecta agregado y quitado en su lugar", () => {
		expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
			{ kind: "equal", lines: ["a"] },
			{ kind: "removed", lines: ["b"] },
			{ kind: "added", lines: ["x"] },
			{ kind: "equal", lines: ["c"] },
		]);
	});

	it("de vacío a texto es todo agregado", () => {
		expect(diffLines("", "a\nb")).toEqual([{ kind: "added", lines: ["a", "b"] }]);
	});

	it("\\r\\n y \\n se tratan igual", () => {
		expect(diffLines("a\r\nb\r\n", "a\nb\n")).toEqual([{ kind: "equal", lines: ["a", "b", ""] }]);
	});
});

describe("diffMeta", () => {
	it("lista cambios de campos y de tags", () => {
		const a = { title: "ICP", category: "comercial", status: "activo", tags: ["canon:icp", "viejo"] };
		const b = { title: "ICP 2", category: "comercial", status: "borrador", tags: ["canon:icp", "nuevo"] };
		expect(diffMeta(a, b)).toEqual({
			changes: [
				{ field: "title", from: "ICP", to: "ICP 2" },
				{ field: "status", from: "activo", to: "borrador" },
			],
			tagsAdded: ["nuevo"],
			tagsRemoved: ["viejo"],
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/diff.test.ts`
Expected: FAIL, no se resuelve `@/lib/brain/diff`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/brain/diff.ts
// Diff de revisiones del brain (spec editor §6.1). LCS de líneas: las páginas
// pesan hasta 200 KB, del orden de miles de líneas, y se compara de a dos.

export type DiffBlock = { kind: "equal" | "added" | "removed"; lines: string[] };

function splitLines(text: string): string[] {
	return text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(a: string, b: string): DiffBlock[] {
	const x = splitLines(a);
	const y = splitLines(b);
	const n = x.length;
	const m = y.length;
	// lcs[i][j]: largo de la subsecuencia común más larga de x[i..] y y[j..].
	const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

	const blocks: DiffBlock[] = [];
	const push = (kind: DiffBlock["kind"], line: string) => {
		const last = blocks.at(-1);
		if (last?.kind === kind) last.lines.push(line);
		else blocks.push({ kind, lines: [line] });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) {
			push("equal", x[i]);
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("removed", x[i++]);
		else push("added", y[j++]);
	}
	while (i < n) push("removed", x[i++]);
	while (j < m) push("added", y[j++]);
	return blocks;
}

export interface MetaSnapshot {
	title: string;
	category: string;
	status: string;
	tags: string[];
}

export interface MetaChange {
	field: "title" | "category" | "status";
	from: string;
	to: string;
}

export function diffMeta(a: MetaSnapshot, b: MetaSnapshot) {
	const changes: MetaChange[] = [];
	for (const field of ["title", "category", "status"] as const)
		if (a[field] !== b[field]) changes.push({ field, from: a[field], to: b[field] });
	return {
		changes,
		tagsAdded: b.tags.filter((t) => !a.tags.includes(t)),
		tagsRemoved: a.tags.filter((t) => !b.tags.includes(t)),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/brain/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/diff.ts tests/brain/diff.test.ts
git commit -m "feat: diff de líneas y de metadatos para revisiones del brain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Markdown con wikilinks

**Files:**
- Create: `lib/brain/editor/markdown-links.ts`, `components/brain/markdown.tsx`
- Modify: `package.json` (deps)
- Test: `tests/brain/markdown-links.test.ts`

**Interfaces:**
- Consumes: `WIKILINK_PATTERN` (Task 1)
- Produces: `toMarkdownLinks(body: string, titleFor: (slug: string) => string | undefined): string` — reemplaza cada wikilink fuera de código por `[texto](wiki:slug#ancla)`. `WIKI_SCHEME = "wiki:"`. Componente `<BrainMarkdown body tenantSlug pages />` con `pages: Map<string, { title: string; status: BrainStatus }>`.

La spec §7 habla de un plugin remark; este plan lo resuelve con un paso previo sobre el texto, más simple de testear y sin depender de los internos de unified. El efecto en pantalla es el mismo.

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/markdown-links.test.ts
import { describe, expect, it } from "vitest";
import { toMarkdownLinks } from "@/lib/brain/editor/markdown-links";

const titles: Record<string, string> = { "comercial/icp": "ICP" };
const titleFor = (slug: string) => titles[slug];

describe("toMarkdownLinks", () => {
	it("usa el alias, o el título, o el slug como texto", () => {
		expect(toMarkdownLinks("[[comercial/icp|el ICP]]", titleFor)).toBe("[el ICP](wiki:comercial/icp)");
		expect(toMarkdownLinks("[[comercial/icp]]", titleFor)).toBe("[ICP](wiki:comercial/icp)");
		expect(toMarkdownLinks("[[no/existe]]", titleFor)).toBe("[no/existe](wiki:no/existe)");
	});

	it("conserva el ancla", () => {
		expect(toMarkdownLinks("[[comercial/icp#tamaño|x]]", titleFor)).toBe("[x](wiki:comercial/icp#tama%C3%B1o)");
	});

	it("no toca wikilinks dentro de bloques de código ni de código inline", () => {
		const body = "```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [[comercial/icp]]";
		expect(toMarkdownLinks(body, titleFor)).toBe(
			"```\n[[comercial/icp]]\n```\ny `[[comercial/icp]]` y [ICP](wiki:comercial/icp)",
		);
	});

	it("escapa corchetes del texto visible", () => {
		expect(toMarkdownLinks("[[x]]", () => "Título [beta]")).toBe("[Título \\[beta\\]](wiki:x)");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/markdown-links.test.ts`
Expected: FAIL, no se resuelve el módulo.

- [ ] **Step 3: Write the implementation**

```ts
// lib/brain/editor/markdown-links.ts
// Paso previo al render (spec editor §7): cada wikilink fuera de código pasa a
// ser un link markdown con esquema wiki:, que <BrainMarkdown> resuelve a una
// ruta del tenant y marca como roto o archivado.
import { parseWikilinks } from "../wikilinks";

export const WIKI_SCHEME = "wiki:";

// Bloques ``` y código inline `...`: lo que matchea se deja tal cual.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

function escapeText(text: string): string {
	return text.replace(/([\[\]\\])/g, "\\$1");
}

function replaceLinks(chunk: string, titleFor: (slug: string) => string | undefined): string {
	let out = "";
	let cursor = 0;
	for (const link of parseWikilinks(chunk)) {
		const text = link.alias ?? titleFor(link.target) ?? link.target;
		const anchor = link.anchor ? `#${encodeURIComponent(link.anchor)}` : "";
		out += `${chunk.slice(cursor, link.start)}[${escapeText(text)}](${WIKI_SCHEME}${link.target}${anchor})`;
		cursor = link.end;
	}
	return out + chunk.slice(cursor);
}

export function toMarkdownLinks(body: string, titleFor: (slug: string) => string | undefined): string {
	let out = "";
	let cursor = 0;
	for (const match of body.matchAll(CODE)) {
		const start = match.index ?? 0;
		out += replaceLinks(body.slice(cursor, start), titleFor) + match[0];
		cursor = start + match[0].length;
	}
	return out + replaceLinks(body.slice(cursor), titleFor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/brain/markdown-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Instalar dependencias y escribir el componente**

Run: `npm install react-markdown remark-gfm`

```tsx
// components/brain/markdown.tsx
import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toMarkdownLinks, WIKI_SCHEME } from "@/lib/brain/editor/markdown-links";
import { pageHref } from "@/lib/brain/editor/slug";
import type { BrainStatus } from "@/lib/brain/types";

export type PageLookup = Map<string, { title: string; status: BrainStatus }>;

// Sin rehype-raw: el agente también escribe páginas y el HTML del cuerpo se
// muestra como texto. El esquema wiki: se deja pasar solo para resolverlo acá.
export function BrainMarkdown({ body, tenantSlug, pages }: { body: string; tenantSlug: string; pages: PageLookup }) {
	const source = toMarkdownLinks(body, (slug) => pages.get(slug)?.title);
	return (
		<div className="brain-prose">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				urlTransform={(url) => (url.startsWith(WIKI_SCHEME) ? url : defaultUrlTransform(url))}
				components={{
					a({ href = "", children }) {
						if (!href.startsWith(WIKI_SCHEME)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
						const [slug, anchor] = href.slice(WIKI_SCHEME.length).split("#");
						const target = pages.get(slug);
						if (!target)
							return (
								<span className="cursor-help text-destructive underline decoration-dotted" title={`No existe la página ${slug}`}>
									{children}
								</span>
							);
						return (
							<Link
								href={`${pageHref(tenantSlug, slug)}${anchor ? `#${anchor}` : ""}`}
								className={target.status === "archivado" ? "opacity-60" : undefined}
								title={target.status === "archivado" ? "Archivada" : target.title}
							>
								{children}
							</Link>
						);
					},
				}}
			>
				{source}
			</ReactMarkdown>
		</div>
	);
}
```

Agregar al final de `app/globals.css` (no hay plugin de typography en el repo):

```css
/* Cuerpo de páginas del brain (components/brain/markdown.tsx). */
.brain-prose { line-height: 1.7; }
.brain-prose :where(h1, h2, h3) { margin: 1.6em 0 0.6em; font-weight: 600; line-height: 1.25; }
.brain-prose h1 { font-size: 1.6rem; }
.brain-prose h2 { font-size: 1.3rem; }
.brain-prose h3 { font-size: 1.1rem; }
.brain-prose :where(p, ul, ol, pre, blockquote, table) { margin: 0.8em 0; }
.brain-prose :where(ul) { list-style: disc; padding-left: 1.4em; }
.brain-prose :where(ol) { list-style: decimal; padding-left: 1.4em; }
.brain-prose a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.brain-prose :where(code) { background: var(--muted); border-radius: 4px; padding: 0.1em 0.3em; font-size: 0.9em; }
.brain-prose pre { background: var(--muted); border-radius: 6px; padding: 0.8em 1em; overflow-x: auto; }
.brain-prose pre code { background: none; padding: 0; }
.brain-prose blockquote { border-left: 3px solid var(--border); padding-left: 1em; color: var(--muted-foreground); }
.brain-prose table { display: block; overflow-x: auto; border-collapse: collapse; }
.brain-prose :where(th, td) { border: 1px solid var(--border); padding: 0.4em 0.6em; }
```

`pageHref` se crea en la Task 6; si esta tarea corre antes, crear ya `lib/brain/editor/slug.ts` con solo `pageHref` (la Task 6 le suma `slugFromParams` y su test).

```ts
// lib/brain/editor/slug.ts
export function pageHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/p/${pageSlug}`;
}
```

- [ ] **Step 6: Typecheck y commit**

Run: `npm run typecheck`
Expected: sin errores.

```bash
git add lib/brain/editor/markdown-links.ts lib/brain/editor/slug.ts components/brain/markdown.tsx app/globals.css package.json package-lock.json tests/brain/markdown-links.test.ts
git commit -m "feat: render de páginas del brain con wikilinks navegables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Guardado con permisos

**Files:**
- Create: `lib/brain/editor/save.ts`, `app/[tenant]/brain/actions.ts`
- Test: `tests/brain/editor-save.test.ts`

**Interfaces:**
- Consumes: `BrainProvider`, `BrainBinding`, `BrainConflict`, `BrainValidation`, `TenantRole`
- Produces:
```ts
interface SavePageInput {
  tenantSlug: string; slug: string; title: string; category: string;
  status: BrainStatus; tags: string[]; frontmatter: Record<string, unknown>;
  body: string; reason: string; baseRevision: number | null;
}
type SavePageResult =
  | { ok: true; slug: string; revision: number }
  | { ok: false; code: "forbidden" | "unsupported" | "internal"; message: string }
  | { ok: false; code: "conflict"; currentRevision: number | null; message: string }
  | { ok: false; code: "validation"; fields: string[]; message: string };
interface SaveDeps {
  access(tenantSlug: string): Promise<{ tenantId: string; role: TenantRole; userId: string } | null>;
  binding(tenantId: string): Promise<BrainBinding | null>;
  provider(binding: BrainBinding): BrainProvider;
}
function savePage(input: SavePageInput, deps: SaveDeps): Promise<SavePageResult>
// app/[tenant]/brain/actions.ts
async function saveBrainPage(input: SavePageInput): Promise<SavePageResult>  // "use server"
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/editor-save.test.ts
import { describe, expect, it, vi } from "vitest";
import { type SaveDeps, type SavePageInput, savePage } from "@/lib/brain/editor/save";
import { BrainConflict, BrainValidation } from "@/lib/brain/errors";
import type { BrainBinding } from "@/lib/brain/resolve";
import type { BrainProvider } from "@/lib/brain/types";

const wiki = { id: "b1", tenantId: "t1", provider: "wiki", config: {} } as unknown as BrainBinding;
const mcp = { id: "b2", tenantId: "t1", provider: "mcp" } as unknown as BrainBinding;

const input: SavePageInput = {
	tenantSlug: "innovas", slug: "comercial/icp", title: "ICP", category: "comercial",
	status: "activo", tags: ["canon:icp"], frontmatter: { owner: "mati" },
	body: "texto", reason: "ajuste", baseRevision: 3,
};

function deps(over: Partial<SaveDeps> = {}, upsert?: BrainProvider["upsert"]) {
	const provider: BrainProvider = {
		search: vi.fn(), read: vi.fn(),
		upsert: upsert ?? vi.fn(async () => ({ slug: "comercial/icp", revision: 4 })),
	};
	return {
		provider,
		deps: {
			access: async () => ({ tenantId: "t1", role: "tenant_admin" as const, userId: "u1" }),
			binding: async () => wiki,
			provider: () => provider,
			...over,
		} satisfies SaveDeps,
	};
}

describe("savePage", () => {
	it("escribe con autor user de la sesión y baseRevision", async () => {
		const { deps: d, provider } = deps();
		expect(await savePage(input, d)).toEqual({ ok: true, slug: "comercial/icp", revision: 4 });
		expect(provider.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/icp", baseRevision: 3, reason: "ajuste", frontmatter: { owner: "mati" } }),
			{ kind: "user", userId: "u1" },
		);
	});

	it("página nueva va sin baseRevision", async () => {
		const { deps: d, provider } = deps();
		await savePage({ ...input, baseRevision: null }, d);
		expect((provider.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty("baseRevision");
	});

	it("rechaza a tenant_member y a quien no tiene acceso sin llamar al provider", async () => {
		const member = deps({ access: async () => ({ tenantId: "t1", role: "tenant_member", userId: "u2" }) });
		expect(await savePage(input, member.deps)).toMatchObject({ ok: false, code: "forbidden" });
		expect(member.provider.upsert).not.toHaveBeenCalled();
		const nobody = deps({ access: async () => null });
		expect(await savePage(input, nobody.deps)).toMatchObject({ ok: false, code: "forbidden" });
	});

	it("rechaza binding mcp o ausente", async () => {
		expect(await savePage(input, deps({ binding: async () => mcp }).deps)).toMatchObject({ code: "unsupported" });
		expect(await savePage(input, deps({ binding: async () => null }).deps)).toMatchObject({ code: "unsupported" });
	});

	it("exige motivo", async () => {
		const { deps: d, provider } = deps();
		expect(await savePage({ ...input, reason: "  " }, d)).toMatchObject({ code: "validation", fields: ["reason"] });
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("traduce conflicto y validación", async () => {
		const conflict = deps({}, async () => { throw new BrainConflict("comercial/icp", 5); });
		expect(await savePage(input, conflict.deps)).toMatchObject({ ok: false, code: "conflict", currentRevision: 5 });
		const invalid = deps({}, async () => { throw new BrainValidation(["category"]); });
		expect(await savePage(input, invalid.deps)).toMatchObject({ ok: false, code: "validation", fields: ["category"] });
	});

	it("slug nuevo que ya existe: conflicto sin revisión con mensaje propio", async () => {
		const exists = deps({}, async () => { throw new BrainConflict("comercial/icp", null); });
		expect(await savePage({ ...input, baseRevision: null }, exists.deps)).toMatchObject({
			code: "conflict", currentRevision: null, message: "Ya existe una página con ese slug.",
		});
	});

	it("un error inesperado sale como internal con id", async () => {
		const boom = deps({}, async () => { throw new Error("db caída"); });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await savePage(input, boom.deps);
		expect(result).toMatchObject({ ok: false, code: "internal" });
		expect(result.ok === false && result.message).toMatch(/No se pudo guardar \(.+\)/);
		spy.mockRestore();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/editor-save.test.ts`
Expected: FAIL, no se resuelve el módulo.

- [ ] **Step 3: Write the implementation**

```ts
// lib/brain/editor/save.ts
// Guardado del editor (spec editor §5.3). La escritura corre con service role
// por provider.upsert, así que el rol se chequea acá: la RLS no protege este
// camino. Sin Next: la server action solo arma las dependencias reales.
import type { TenantRole } from "@/lib/tenants/resolve";
import { BrainConflict, BrainValidation } from "../errors";
import type { BrainBinding } from "../resolve";
import type { BrainProvider, BrainStatus, BrainWrite } from "../types";

export interface SavePageInput {
	tenantSlug: string;
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	reason: string;
	baseRevision: number | null;
}

export type SavePageResult =
	| { ok: true; slug: string; revision: number }
	| { ok: false; code: "forbidden" | "unsupported" | "internal"; message: string }
	| { ok: false; code: "conflict"; currentRevision: number | null; message: string }
	| { ok: false; code: "validation"; fields: string[]; message: string };

export interface SaveDeps {
	access(tenantSlug: string): Promise<{ tenantId: string; role: TenantRole; userId: string } | null>;
	binding(tenantId: string): Promise<BrainBinding | null>;
	provider(binding: BrainBinding): BrainProvider;
}

export async function savePage(input: SavePageInput, deps: SaveDeps): Promise<SavePageResult> {
	const access = await deps.access(input.tenantSlug);
	if (!access || access.role === "tenant_member")
		return { ok: false, code: "forbidden", message: "No tenés permiso para editar el brain." };

	const binding = await deps.binding(access.tenantId);
	if (!binding || binding.provider !== "wiki")
		return { ok: false, code: "unsupported", message: "Este brain no se edita desde la plataforma." };

	if (input.reason.trim().length === 0)
		return { ok: false, code: "validation", fields: ["reason"], message: "Falta el motivo del cambio." };

	const write: BrainWrite = {
		slug: input.slug,
		title: input.title,
		category: input.category,
		status: input.status,
		tags: input.tags,
		frontmatter: input.frontmatter,
		body: input.body,
		reason: input.reason.trim(),
		...(input.baseRevision === null ? {} : { baseRevision: input.baseRevision }),
	};

	try {
		const saved = await deps.provider(binding).upsert(write, { kind: "user", userId: access.userId });
		return { ok: true, slug: saved.slug, revision: saved.revision };
	} catch (error) {
		if (error instanceof BrainConflict)
			return {
				ok: false,
				code: "conflict",
				currentRevision: error.currentRevision,
				message:
					input.baseRevision === null
						? "Ya existe una página con ese slug."
						: `Alguien guardó la revisión ${error.currentRevision ?? "nueva"} mientras editabas.`,
			};
		if (error instanceof BrainValidation)
			return { ok: false, code: "validation", fields: error.fields, message: error.message };
		const id = crypto.randomUUID();
		console.error(`brain editor: error al guardar (${id})`, error);
		return { ok: false, code: "internal", message: `No se pudo guardar (${id}).` };
	}
}
```

```ts
// app/[tenant]/brain/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type SavePageInput, type SavePageResult, savePage } from "@/lib/brain/editor/save";
import { getBrainProvider } from "@/lib/brain/provider";
import { resolveBrainBinding } from "@/lib/brain/resolve";
import { BRAIN_STATUSES } from "@/lib/brain/types";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el contenido lo valida validateWrite.
const inputSchema = z.object({
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
	title: z.string().max(300),
	category: z.string().max(41),
	status: z.enum(BRAIN_STATUSES as [string, ...string[]]),
	tags: z.array(z.string().max(60)).max(50),
	frontmatter: z.record(z.string(), z.unknown()),
	body: z.string(),
	reason: z.string().max(500),
	baseRevision: z.number().int().positive().nullable(),
});

export async function saveBrainPage(raw: SavePageInput): Promise<SavePageResult> {
	const parsed = inputSchema.safeParse(raw);
	if (!parsed.success)
		return { ok: false, code: "validation", fields: parsed.error.issues.map((i) => i.path.join(".")), message: "Datos inválidos." };
	const input = parsed.data as SavePageInput;

	const result = await savePage(input, {
		async access(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			if (!tenant) return null;
			const { data } = await (await createServerSupabase()).auth.getUser();
			return data.user ? { tenantId: tenant.id, role: tenant.role, userId: data.user.id } : null;
		},
		binding: (tenantId) => resolveBrainBinding(tenantId, loadTenantBindings),
		provider: getBrainProvider,
	});

	if (result.ok) {
		revalidatePath(`/${input.tenantSlug}/brain`, "layout");
	}
	return result;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/brain/editor-save.test.ts && npm run typecheck`
Expected: PASS y sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/editor/save.ts app/[tenant]/brain/actions.ts tests/brain/editor-save.test.ts
git commit -m "feat: guardado del editor del brain con chequeo de rol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Carga de datos y slugs de URL

**Files:**
- Create: `lib/brain/editor/load.ts`
- Modify: `lib/brain/editor/slug.ts` (sumar `slugFromParams`)
- Test: `tests/brain/editor-slug.test.ts`

**Interfaces:**
- Consumes: `resolveTenantAccess`, `resolveBrainBinding`, `loadTenantBindings`, `createServerSupabase`, `createAdminClient`, `SLUG_PATTERN`, `MAX_SLUG_LENGTH`
- Produces:
```ts
function slugFromParams(segments: string[] | undefined): string | null
function pageHref(tenantSlug: string, pageSlug: string): string
function editHref(tenantSlug: string, pageSlug: string): string      // /t/brain/editar/<slug>
function historyHref(tenantSlug: string, pageSlug: string): string   // /t/brain/historial/<slug>
type EditorContext =
  | { kind: "ok"; tenant: TenantAccess; canEdit: boolean; categories: string[] }
  | { kind: "no-brain"; tenant: TenantAccess }
  | { kind: "external"; tenant: TenantAccess };
const loadEditorContext: (tenantSlug: string) => Promise<EditorContext | null>   // null → notFound()
interface BrainPageRow { slug: string; title: string; category: string; status: BrainStatus; tags: string[]; frontmatter: Record<string, unknown>; body: string; revision: number; updatedAt: string }
const loadBrainPages: (tenantId: string) => Promise<BrainPageRow[]>
interface RevisionRow { revision: number; title: string; category: string; status: BrainStatus; tags: string[]; frontmatter: Record<string, unknown>; body: string; authorKind: "user" | "agent" | "import"; authorEmail: string | null; reason: string; createdAt: string }
function loadRevisions(tenantId: string, slug: string): Promise<RevisionRow[] | null>   // null si la página no existe
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/editor-slug.test.ts
import { describe, expect, it } from "vitest";
import { editHref, historyHref, pageHref, slugFromParams } from "@/lib/brain/editor/slug";

describe("slugFromParams", () => {
	it("une segmentos válidos", () => {
		expect(slugFromParams(["comercial", "icp"])).toBe("comercial/icp");
	});

	it("decodifica segmentos codificados", () => {
		expect(slugFromParams(["comercial%2Ficp"])).toBe("comercial/icp");
	});

	it("rechaza vacío, mayúsculas, puntos, segmentos vacíos y codificación rota", () => {
		for (const bad of [undefined, [], ["Comercial"], [".."], ["a", ""], ["a b"], ["%E0%A4%A"]])
			expect(slugFromParams(bad)).toBeNull();
	});

	it("rechaza slugs de más de 200 caracteres", () => {
		expect(slugFromParams(["a".repeat(201)])).toBeNull();
	});
});

describe("pageHref", () => {
	it("arma las rutas de vista, edición e historial", () => {
		expect(pageHref("innovas", "comercial/icp")).toBe("/innovas/brain/p/comercial/icp");
		expect(editHref("innovas", "comercial/icp")).toBe("/innovas/brain/editar/comercial/icp");
		expect(historyHref("innovas", "comercial/icp")).toBe("/innovas/brain/historial/comercial/icp");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/editor-slug.test.ts`
Expected: FAIL, `slugFromParams`, `editHref` e `historyHref` no existen.

- [ ] **Step 3: Write the implementation**

```ts
// lib/brain/editor/slug.ts
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types";

/** Slug de página a partir del catch-all de la URL; null si no es válido (→ 404). */
export function slugFromParams(segments: string[] | undefined): string | null {
	if (!segments || segments.length === 0) return null;
	let slug: string;
	try {
		slug = segments.map((s) => decodeURIComponent(s)).join("/");
	} catch {
		return null;
	}
	return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug) ? slug : null;
}

export function pageHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/p/${pageSlug}`;
}

export function editHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/editar/${pageSlug}`;
}

export function historyHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/historial/${pageSlug}`;
}
```

```ts
// lib/brain/editor/load.ts
// Lecturas del editor (spec editor §4.3 y §6). Páginas y revisiones con el
// cliente de sesión: la RLS de lectura por membresía ya existe. El binding y
// los emails de autores con el cliente admin, siempre filtrados por el tenant
// que resolvió la sesión.
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { type TenantAccess, resolveTenantAccess } from "@/lib/tenants/resolve";
import { resolveBrainBinding } from "../resolve";
import type { BrainStatus } from "../types";

export type EditorContext =
	| { kind: "ok"; tenant: TenantAccess; canEdit: boolean; categories: string[] }
	| { kind: "no-brain"; tenant: TenantAccess }
	| { kind: "external"; tenant: TenantAccess };

export const loadEditorContext = cache(async (tenantSlug: string): Promise<EditorContext | null> => {
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
	};
});

export interface BrainPageRow {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number;
	updatedAt: string;
}

export const loadBrainPages = cache(async (tenantId: string): Promise<BrainPageRow[]> => {
	const supabase = await createServerSupabase();
	const { data, error } = await supabase
		.from("brain_pages")
		.select("slug, title, category, status, tags, frontmatter, body, revision, updated_at")
		.eq("tenant_id", tenantId)
		.order("slug");
	if (error) throw new Error(`No pude leer el brain: ${error.message}`);
	return (data ?? []).map((row) => ({
		slug: row.slug,
		title: row.title,
		category: row.category,
		status: row.status as BrainStatus,
		tags: row.tags ?? [],
		frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
		body: row.body,
		revision: row.revision,
		updatedAt: row.updated_at,
	}));
});

export interface RevisionRow {
	revision: number;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	authorKind: "user" | "agent" | "import";
	authorEmail: string | null;
	reason: string;
	createdAt: string;
}

export async function loadRevisions(tenantId: string, slug: string): Promise<RevisionRow[] | null> {
	const supabase = await createServerSupabase();
	const { data: page } = await supabase
		.from("brain_pages")
		.select("id")
		.eq("tenant_id", tenantId)
		.eq("slug", slug)
		.maybeSingle();
	if (!page) return null;

	const { data, error } = await supabase
		.from("brain_revisions")
		.select("revision, title, category, status, tags, frontmatter, body, author_kind, author_user_id, reason, created_at")
		.eq("tenant_id", tenantId)
		.eq("page_id", page.id)
		.order("revision", { ascending: false });
	if (error) throw new Error(`No pude leer el historial: ${error.message}`);

	const emails = await memberEmails(
		tenantId,
		[...new Set((data ?? []).map((r) => r.author_user_id).filter((id): id is string => !!id))],
	);

	return (data ?? []).map((row) => ({
		revision: row.revision,
		title: row.title,
		category: row.category,
		status: row.status as BrainStatus,
		tags: row.tags ?? [],
		frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
		body: row.body,
		authorKind: row.author_kind as RevisionRow["authorKind"],
		authorEmail: row.author_user_id ? (emails.get(row.author_user_id) ?? null) : null,
		reason: row.reason,
		createdAt: row.created_at,
	}));
}

// Solo usuarios con membership en este tenant: un email de otra empresa no se
// muestra aunque haya quedado como autor.
async function memberEmails(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (userIds.length === 0) return result;
	const admin = createAdminClient();
	const { data: members } = await admin
		.from("memberships")
		.select("user_id")
		.eq("tenant_id", tenantId)
		.in("user_id", userIds);
	await Promise.all(
		(members ?? []).map(async ({ user_id }) => {
			const { data } = await admin.auth.admin.getUserById(user_id);
			if (data.user?.email) result.set(user_id, data.user.email);
		}),
	);
	return result;
}
```

Si `npm run typecheck` marca que `lib/supabase/database.types.ts` no tipa `brain_pages` o `brain_revisions`, comprobar con `grep -n "brain_revisions" lib/supabase/database.types.ts`; si faltan, castear `row` a `Record<string, unknown>` como hace `wiki-store.ts` en vez de regenerar tipos.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/brain/editor-slug.test.ts && npm run typecheck`
Expected: PASS y sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/brain/editor/slug.ts lib/brain/editor/load.ts tests/brain/editor-slug.test.ts
git commit -m "feat: carga de páginas, revisiones y contexto del editor del brain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Índice, mapa y nav

**Files:**
- Create: `app/[tenant]/brain/page.tsx`, `app/[tenant]/brain/mapa/page.tsx`, `components/brain/page-list.tsx`, `components/brain/brain-notice.tsx`
- Modify: `app/[tenant]/layout.tsx` (NAV)

**Interfaces:**
- Consumes: `loadEditorContext`, `loadBrainPages`, `buildLinkIndex`, `pageHref`, `getBrainProvider`, `resolveBrainBinding`, `CANON_TAGS`
- Produces: `<BrainNotice kind="no-brain" | "external" />`; `<PageList groups tenantSlug counts />`

- [ ] **Step 1: Nav**

En `app/[tenant]/layout.tsx`, dentro de `NAV`, después de `{ href: "/focos", label: "Focos" },` agregar:

```ts
	{ href: "/brain", label: "Brain" },
```

- [ ] **Step 2: Aviso compartido**

```tsx
// components/brain/brain-notice.tsx
export function BrainNotice({ kind }: { kind: "no-brain" | "external" }) {
	return (
		<div className="max-w-xl rounded-lg border p-6">
			<h1 className="mb-2 text-2xl">Brain</h1>
			<p className="text-muted-foreground">
				{kind === "no-brain"
					? "Este cliente no tiene brain configurado."
					: "Este brain vive en un servidor externo; se edita en su origen."}
			</p>
		</div>
	);
}
```

- [ ] **Step 3: Lista por categoría**

```tsx
// components/brain/page-list.tsx
import Link from "next/link";
import { pageHref } from "@/lib/brain/editor/slug";
import type { BrainPageRow } from "@/lib/brain/editor/load";
import { CANON_TAGS } from "@/lib/brain/types";

const STATUS_LABEL = { activo: "Activo", borrador: "Borrador", archivado: "Archivado" } as const;

export function PageList({
	groups,
	tenantSlug,
	counts,
}: {
	groups: { category: string; pages: BrainPageRow[] }[];
	tenantSlug: string;
	counts: Map<string, { in: number; out: number }>;
}) {
	if (groups.every((g) => g.pages.length === 0))
		return <p className="text-muted-foreground">No hay páginas que coincidan.</p>;
	return (
		<div className="space-y-8">
			{groups.filter((g) => g.pages.length > 0).map((group) => (
				<section key={group.category}>
					<h2 className="mb-2 text-lg capitalize">
						{group.category} <span className="text-muted-foreground text-sm">({group.pages.length})</span>
					</h2>
					<ul className="divide-y rounded-lg border">
						{group.pages.map((page) => {
							const count = counts.get(page.slug) ?? { in: 0, out: 0 };
							const canon = page.tags.filter((t) => (CANON_TAGS as readonly string[]).includes(t));
							return (
								<li key={page.slug}>
									<Link href={pageHref(tenantSlug, page.slug)} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/50">
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{page.title}</span>
											<span className="block truncate text-muted-foreground text-xs">{page.slug}</span>
										</span>
										{canon.map((tag) => (
											<span key={tag} className="rounded-full border px-2 py-0.5 text-xs">{tag}</span>
										))}
										{page.status !== "activo" && (
											<span className="rounded-full bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[page.status]}</span>
										)}
										<span className="text-muted-foreground text-xs tabular-nums" title="Links entrantes · salientes">
											← {count.in} · {count.out} →
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}
```

- [ ] **Step 4: Índice**

```tsx
// app/[tenant]/brain/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainNotice } from "@/components/brain/brain-notice";
import { PageList } from "@/components/brain/page-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { buildLinkIndex } from "@/lib/brain/links";
import { getBrainProvider } from "@/lib/brain/provider";
import { resolveBrainBinding } from "@/lib/brain/resolve";
import { BRAIN_STATUSES, type BrainStatus, CANON_TAGS } from "@/lib/brain/types";
import { loadTenantBindings } from "@/lib/connectors/bindings";

export default async function BrainIndexPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ q?: string; estado?: string; tag?: string }>;
}) {
	const { tenant: slug } = await params;
	const { q = "", estado, tag } = await searchParams;
	const ctx = await loadEditorContext(slug);
	if (!ctx) notFound();
	if (ctx.kind !== "ok") return <BrainNotice kind={ctx.kind} />;

	const pages = await loadBrainPages(ctx.tenant.id);
	const index = buildLinkIndex(pages);
	const status = BRAIN_STATUSES.includes(estado as BrainStatus) ? (estado as BrainStatus) : null;

	// Con consulta se ordena por relevancia con brain_search_pages; sin
	// consulta se lista todo sin buscar.
	let visible = pages;
	if (q.trim()) {
		const binding = await resolveBrainBinding(ctx.tenant.id, loadTenantBindings);
		const results = binding
			? await getBrainProvider(binding).search({ query: q.trim(), includeArchived: status === "archivado", limit: 20 })
			: [];
		const order = new Map(results.map((r, i) => [r.slug, i]));
		visible = pages.filter((p) => order.has(p.slug)).sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
	}
	visible = visible.filter((p) => (status ? p.status === status : p.status !== "archivado"));
	if (tag) visible = visible.filter((p) => p.tags.includes(tag));

	const counts = new Map(
		pages.map((p) => [p.slug, { in: index.incoming.get(p.slug)?.length ?? 0, out: index.outgoing.get(p.slug)?.length ?? 0 }]),
	);
	const groups = ctx.categories.map((category) => ({ category, pages: visible.filter((p) => p.category === category) }));
	const href = (next: Record<string, string | undefined>) => {
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries({ q: q || undefined, estado, tag, ...next })) if (v) sp.set(k, v);
		const qs = sp.toString();
		return `/${slug}/brain${qs ? `?${qs}` : ""}`;
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="mr-auto text-3xl leading-tight">Brain</h1>
				<Button asChild variant="outline"><Link href={`/${slug}/brain/mapa`}>Mapa de conexiones</Link></Button>
				{ctx.canEdit && <Button asChild><Link href={`/${slug}/brain/nueva`}>Nueva página</Link></Button>}
			</div>
			<form className="flex flex-wrap gap-2" action={`/${slug}/brain`}>
				<Input name="q" defaultValue={q} placeholder="Buscar en el brain" className="max-w-sm" />
				<select name="estado" defaultValue={status ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
					<option value="">Activas y borradores</option>
					<option value="activo">Activas</option>
					<option value="borrador">Borradores</option>
					<option value="archivado">Archivadas</option>
				</select>
				{tag && <input type="hidden" name="tag" value={tag} />}
				<Button type="submit" variant="secondary">Buscar</Button>
			</form>
			<div className="flex flex-wrap gap-2 text-sm">
				{CANON_TAGS.map((t) => (
					<Link key={t} href={href({ tag: tag === t ? undefined : t })}
						className={`rounded-full border px-3 py-1 ${tag === t ? "bg-primary text-primary-foreground" : ""}`}>
						{t}
					</Link>
				))}
			</div>
			<PageList groups={groups} tenantSlug={slug} counts={counts} />
		</div>
	);
}
```

- [ ] **Step 5: Mapa**

```tsx
// app/[tenant]/brain/mapa/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainNotice } from "@/components/brain/brain-notice";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { pageHref } from "@/lib/brain/editor/slug";
import { buildLinkIndex } from "@/lib/brain/links";

const HUBS_PER_CATEGORY = 5;

export default async function BrainMapPage({ params }: { params: Promise<{ tenant: string }> }) {
	const { tenant: slug } = await params;
	const ctx = await loadEditorContext(slug);
	if (!ctx) notFound();
	if (ctx.kind !== "ok") return <BrainNotice kind={ctx.kind} />;

	const pages = await loadBrainPages(ctx.tenant.id);
	const index = buildLinkIndex(pages);
	const title = new Map(pages.map((p) => [p.slug, p.title]));
	const live = pages.filter((p) => p.status !== "archivado");
	const orphans = new Set(index.orphans);

	return (
		<div className="space-y-10">
			<div>
				<Link href={`/${slug}/brain`} className="text-muted-foreground text-sm">← Brain</Link>
				<h1 className="text-3xl leading-tight">Mapa de conexiones</h1>
				<p className="text-muted-foreground text-sm">
					{live.length} páginas · {index.orphans.length} huérfanas · {index.broken.length} links rotos
				</p>
			</div>

			<section>
				<h2 className="mb-3 text-lg">Por categoría</h2>
				<div className="grid gap-4 md:grid-cols-2">
					{ctx.categories.map((category) => {
						const inCat = live.filter((p) => p.category === category);
						if (inCat.length === 0) return null;
						const hubs = [...inCat]
							.sort((a, b) => (index.incoming.get(b.slug)?.length ?? 0) - (index.incoming.get(a.slug)?.length ?? 0))
							.slice(0, HUBS_PER_CATEGORY)
							.filter((p) => (index.incoming.get(p.slug)?.length ?? 0) > 0);
						const lonely = inCat.filter((p) => orphans.has(p.slug));
						return (
							<div key={category} className="rounded-lg border p-4">
								<h3 className="mb-2 font-medium capitalize">{category} <span className="text-muted-foreground text-sm">({inCat.length})</span></h3>
								<p className="mb-1 text-muted-foreground text-xs uppercase">Más enlazadas</p>
								<ul className="mb-3 space-y-1 text-sm">
									{hubs.length === 0 && <li className="text-muted-foreground">Ninguna página de esta categoría está enlazada.</li>}
									{hubs.map((p) => (
										<li key={p.slug}><Link className="underline" href={pageHref(slug, p.slug)}>{p.title}</Link> <span className="text-muted-foreground">← {index.incoming.get(p.slug)?.length}</span></li>
									))}
								</ul>
								{lonely.length > 0 && (
									<>
										<p className="mb-1 text-muted-foreground text-xs uppercase">Huérfanas</p>
										<ul className="space-y-1 text-sm">
											{lonely.map((p) => <li key={p.slug}><Link className="underline" href={pageHref(slug, p.slug)}>{p.title}</Link></li>)}
										</ul>
									</>
								)}
							</div>
						);
					})}
				</div>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Links rotos</h2>
				{index.broken.length === 0 ? (
					<p className="text-muted-foreground">No hay links rotos.</p>
				) : (
					<ul className="divide-y rounded-lg border text-sm">
						{index.broken.map((b) => (
							<li key={`${b.source}->${b.target}`} className="flex flex-wrap gap-2 px-4 py-2">
								<Link className="underline" href={pageHref(slug, b.source)}>{title.get(b.source) ?? b.source}</Link>
								<span className="text-muted-foreground">apunta a</span>
								<code className="text-destructive">{b.target}</code>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
```

- [ ] **Step 6: Typecheck, lint y probar en el navegador**

Run: `npm run typecheck && npm run lint:fix` (revertir los archivos ajenos que toque lint).
Run: `npm run db:start` si no está arriba; importar el brain de `innovas` a la base local si está vacío (`grep -n "brain:import" package.json` para el comando exacto) y `npm run dev`.
Verificar en `http://localhost:3000/innovas/brain` y `/innovas/brain/mapa`: aparecen categorías, contadores, filtros por tag y estado, búsqueda, huérfanas y rotos.

- [ ] **Step 7: Commit**

```bash
git add app/[tenant]/layout.tsx app/[tenant]/brain/page.tsx app/[tenant]/brain/mapa/page.tsx components/brain/page-list.tsx components/brain/brain-notice.tsx
git commit -m "feat: índice del brain y mapa de conexiones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Página con panel de conexiones

**Files:**
- Create: `app/[tenant]/brain/p/[...slug]/page.tsx`, `components/brain/connections-panel.tsx`

**Interfaces:**
- Consumes: `loadEditorContext`, `loadBrainPages`, `buildLinkIndex`, `slugFromParams`, `pageHref`, `BrainMarkdown`, `PageLookup`, `getBrainProvider`, `resolveBrainBinding`

- [ ] **Step 1: Panel**

```tsx
// components/brain/connections-panel.tsx
import Link from "next/link";
import { pageHref } from "@/lib/brain/editor/slug";
import type { OutgoingLink } from "@/lib/brain/links";

export function ConnectionsPanel({
	tenantSlug,
	outgoing,
	incoming,
	titleFor,
}: {
	tenantSlug: string;
	outgoing: OutgoingLink[];
	incoming: string[];
	titleFor: (slug: string) => string;
}) {
	return (
		<div className="space-y-5 text-sm">
			<div>
				<h2 className="mb-1 font-medium">Enlaza a ({outgoing.length})</h2>
				{outgoing.length === 0 ? <p className="text-muted-foreground">No enlaza a ninguna página.</p> : (
					<ul className="space-y-1">
						{outgoing.map((link) => (
							<li key={link.target}>
								{link.broken ? (
									<span className="text-destructive" title="No existe">{link.target} (no existe)</span>
								) : (
									<Link className={`underline ${link.archived ? "opacity-60" : ""}`} href={pageHref(tenantSlug, link.target)}>
										{titleFor(link.target)}{link.archived ? " (archivada)" : ""}
									</Link>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<h2 className="mb-1 font-medium">La enlazan ({incoming.length})</h2>
				{incoming.length === 0 ? <p className="text-muted-foreground">Ninguna página la enlaza.</p> : (
					<ul className="space-y-1">
						{incoming.map((source) => (
							<li key={source}><Link className="underline" href={pageHref(tenantSlug, source)}>{titleFor(source)}</Link></li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Página**

```tsx
// app/[tenant]/brain/p/[...slug]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionsPanel } from "@/components/brain/connections-panel";
import { BrainMarkdown } from "@/components/brain/markdown";
import { Button } from "@/components/ui/button";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { editHref, historyHref, pageHref, slugFromParams } from "@/lib/brain/editor/slug";
import { buildLinkIndex } from "@/lib/brain/links";
import { getBrainProvider } from "@/lib/brain/provider";
import { resolveBrainBinding } from "@/lib/brain/resolve";
import { loadTenantBindings } from "@/lib/connectors/bindings";

const STATUS_LABEL = { activo: "Activo", borrador: "Borrador", archivado: "Archivado" } as const;

export default async function BrainPageView({ params }: { params: Promise<{ tenant: string; slug: string[] }> }) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();

	const pages = await loadBrainPages(ctx.tenant.id);
	const page = pages.find((p) => p.slug === slug);
	if (!page) {
		const binding = await resolveBrainBinding(ctx.tenant.id, loadTenantBindings);
		const suggestions = binding
			? await getBrainProvider(binding).search({ query: slug.split("/").pop()?.replaceAll("-", " ") ?? slug, includeArchived: true, limit: 3 })
			: [];
		return (
			<div className="max-w-xl space-y-3">
				<h1 className="text-2xl">No existe la página</h1>
				<p className="text-muted-foreground"><code>{slug}</code> no está en el brain.</p>
				{suggestions.length > 0 && (
					<ul className="list-disc pl-5">
						{suggestions.map((s) => <li key={s.slug}><Link className="underline" href={pageHref(tenantSlug, s.slug)}>{s.title}</Link></li>)}
					</ul>
				)}
			</div>
		);
	}

	const index = buildLinkIndex(pages);
	const lookup = new Map(pages.map((p) => [p.slug, { title: p.title, status: p.status }]));
	const titleFor = (s: string) => lookup.get(s)?.title ?? s;

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
			<article className="min-w-0">
				<Link href={`/${tenantSlug}/brain`} className="text-muted-foreground text-sm">← Brain · <span className="capitalize">{page.category}</span></Link>
				<div className="mb-6 flex flex-wrap items-start gap-3">
					<h1 className="mr-auto text-3xl leading-tight">{page.title}</h1>
					<Button asChild variant="outline"><Link href={historyHref(tenantSlug, slug)}>Historial</Link></Button>
					{ctx.canEdit && <Button asChild><Link href={editHref(tenantSlug, slug)}>Editar</Link></Button>}
				</div>
				<BrainMarkdown body={page.body} tenantSlug={tenantSlug} pages={lookup} />
			</article>
			<aside className="space-y-6 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					<dt className="text-muted-foreground">Estado</dt><dd>{STATUS_LABEL[page.status]}</dd>
					<dt className="text-muted-foreground">Categoría</dt><dd className="capitalize">{page.category}</dd>
					<dt className="text-muted-foreground">Revisión</dt><dd>{page.revision}</dd>
					<dt className="text-muted-foreground">Editada</dt><dd>{new Date(page.updatedAt).toLocaleDateString("es-AR")}</dd>
					<dt className="text-muted-foreground">Slug</dt><dd className="break-all"><code>{page.slug}</code></dd>
				</dl>
				{page.tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{page.tags.map((t) => <Link key={t} href={`/${tenantSlug}/brain?tag=${encodeURIComponent(t)}`} className="rounded-full border px-2 py-0.5 text-xs">{t}</Link>)}
					</div>
				)}
				<ConnectionsPanel tenantSlug={tenantSlug} outgoing={index.outgoing.get(slug) ?? []} incoming={index.incoming.get(slug) ?? []} titleFor={titleFor} />
			</aside>
		</div>
	);
}
```

- [ ] **Step 3: Typecheck y navegador**

Run: `npm run typecheck`
Verificar en `http://localhost:3000/innovas/brain/p/<un slug con links>`: el markdown se renderiza, un wikilink navega, "La enlazan" lista backlinks, un link roto se ve en rojo punteado, un slug inexistente muestra sugerencias, `/innovas/brain/p/Mayus` da 404. Probar a 375px de ancho: el panel queda debajo del texto.

- [ ] **Step 4: Commit**

```bash
git add app/[tenant]/brain/p components/brain/connections-panel.tsx
git commit -m "feat: vista de página del brain con panel de conexiones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Formulario de edición y alta

**Files:**
- Create: `lib/brain/editor/autocomplete.ts`, `app/[tenant]/brain/page-form.tsx`, `app/[tenant]/brain/editar/[...slug]/page.tsx`, `app/[tenant]/brain/nueva/page.tsx`, `app/[tenant]/brain/raw/[...slug]/route.ts`, `components/ui/tabs.tsx` (shadcn)
- Test: `tests/brain/autocomplete.test.ts`

**Interfaces:**
- Consumes: `saveBrainPage`, `SavePageResult`, `BrainMarkdown`, `diffLines`, `DiffView` (Task 10 lo crea; si esta tarea va antes, el diff del conflicto se muestra con `<pre>` y la Task 10 lo reemplaza), `loadEditorContext`, `loadBrainPages`, `slugFromParams`, `pageHref`, `CANON_TAGS`
- Produces:
```ts
function wikilinkQueryAt(text: string, cursor: number): { start: number; query: string } | null
function sanitizeAlias(title: string): string
function insertWikilink(text: string, start: number, cursor: number, slug: string, title: string): { text: string; cursor: number }
// <PageForm mode="edit" | "new" tenantSlug categories knownTags pages initial />
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/brain/autocomplete.test.ts
import { describe, expect, it } from "vitest";
import { insertWikilink, sanitizeAlias, wikilinkQueryAt } from "@/lib/brain/editor/autocomplete";

describe("wikilinkQueryAt", () => {
	it("detecta un [[ abierto antes del cursor", () => {
		const text = "ver [[comer";
		expect(wikilinkQueryAt(text, text.length)).toEqual({ start: 4, query: "comer" });
	});

	it("no detecta si el [[ ya se cerró o hay salto de línea", () => {
		expect(wikilinkQueryAt("[[a]] b", 7)).toBeNull();
		expect(wikilinkQueryAt("[[a\nb", 5)).toBeNull();
		expect(wikilinkQueryAt("sin nada", 8)).toBeNull();
	});
});

describe("sanitizeAlias", () => {
	it("saca corchetes y barras que romperían el wikilink", () => {
		expect(sanitizeAlias("Radar [beta] | v2")).toBe("Radar beta v2");
	});
});

describe("insertWikilink", () => {
	it("reemplaza el [[consulta por el wikilink completo y deja el cursor después", () => {
		const text = "ver [[comer y más";
		const result = insertWikilink(text, 4, 11, "comercial/icp", "ICP [v2]");
		expect(result.text).toBe("ver [[comercial/icp|ICP v2]] y más");
		expect(result.cursor).toBe("ver [[comercial/icp|ICP v2]]".length);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/brain/autocomplete.test.ts`
Expected: FAIL, no se resuelve el módulo.

- [ ] **Step 3: Write the implementation**

```ts
// lib/brain/editor/autocomplete.ts
// Autocompletado de [[ en el cuerpo (spec editor §5.2). Puro para testearlo
// sin DOM; el formulario solo lo conecta al textarea.

export function wikilinkQueryAt(text: string, cursor: number): { start: number; query: string } | null {
	const before = text.slice(0, cursor);
	const start = before.lastIndexOf("[[");
	if (start === -1) return null;
	const query = before.slice(start + 2);
	if (/[\]\n|]/.test(query)) return null;
	return { start, query };
}

export function sanitizeAlias(title: string): string {
	return title.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();
}

export function insertWikilink(text: string, start: number, cursor: number, slug: string, title: string) {
	const link = `[[${slug}|${sanitizeAlias(title)}]]`;
	return { text: text.slice(0, start) + link + text.slice(cursor), cursor: start + link.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/brain/autocomplete.test.ts`
Expected: PASS.

- [ ] **Step 5: Componente tabs de shadcn**

Run: `npx shadcn@latest add tabs`
Expected: crea `components/ui/tabs.tsx`. Si pregunta por sobrescribir algo existente, responder que no.

- [ ] **Step 6: Formulario**

```tsx
// app/[tenant]/brain/page-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BrainMarkdown, type PageLookup } from "@/components/brain/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { insertWikilink, wikilinkQueryAt } from "@/lib/brain/editor/autocomplete";
import type { SavePageResult } from "@/lib/brain/editor/save";
import { pageHref } from "@/lib/brain/editor/slug";
import { diffLines } from "@/lib/brain/diff";
import { BRAIN_STATUSES, type BrainStatus, CANON_TAGS } from "@/lib/brain/types";
import { saveBrainPage } from "./actions";

export interface PageFormInitial {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number | null; // null en una página nueva
}

const STATUS_LABEL = { activo: "Activo", borrador: "Borrador", archivado: "Archivado" } as const;
const MAX_SUGGESTIONS = 8;

export function PageForm({
	mode,
	tenantSlug,
	categories,
	knownTags,
	pages,
	initial,
}: {
	mode: "edit" | "new";
	tenantSlug: string;
	categories: string[];
	knownTags: string[];
	pages: { slug: string; title: string; status: BrainStatus }[];
	initial: PageFormInitial;
}) {
	const router = useRouter();
	const [form, setForm] = useState(initial);
	const [tagsText, setTagsText] = useState(initial.tags.join(", "));
	const [reason, setReason] = useState("");
	const [baseRevision, setBaseRevision] = useState(initial.revision);
	const [result, setResult] = useState<SavePageResult | null>(null);
	const [serverBody, setServerBody] = useState<string | null>(null);
	const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
	const [isPending, startTransition] = useTransition();
	const bodyRef = useRef<HTMLTextAreaElement>(null);

	const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
	const dirty =
		form.title !== initial.title || form.category !== initial.category || form.status !== initial.status ||
		form.body !== initial.body || form.slug !== initial.slug || tags.join(",") !== initial.tags.join(",");

	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const lookup: PageLookup = useMemo(() => new Map(pages.map((p) => [p.slug, { title: p.title, status: p.status }])), [pages]);
	const suggestions = query
		? pages.filter((p) => `${p.slug} ${p.title}`.toLowerCase().includes(query.query.toLowerCase())).slice(0, MAX_SUGGESTIONS)
		: [];
	const fieldError = (field: string) => result && !result.ok && result.code === "validation" && result.fields.some((f) => f === field || f.startsWith(`${field}.`));

	function onBodyChange(value: string, cursor: number) {
		setForm((f) => ({ ...f, body: value }));
		setQuery(wikilinkQueryAt(value, cursor));
	}

	function pick(slug: string, title: string) {
		if (!query || !bodyRef.current) return;
		const next = insertWikilink(form.body, query.start, bodyRef.current.selectionStart, slug, title);
		setForm((f) => ({ ...f, body: next.text }));
		setQuery(null);
		requestAnimationFrame(() => {
			bodyRef.current?.focus();
			bodyRef.current?.setSelectionRange(next.cursor, next.cursor);
		});
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		startTransition(async () => {
			const saved = await saveBrainPage({
				tenantSlug,
				slug: form.slug,
				title: form.title,
				category: form.category,
				status: form.status,
				tags,
				frontmatter: form.frontmatter,
				body: form.body,
				reason,
				baseRevision,
			});
			setResult(saved);
			if (saved.ok) {
				router.push(pageHref(tenantSlug, saved.slug));
				return;
			}
			if (saved.code === "conflict" && saved.currentRevision !== null) {
				// Se trae la vigente para mostrar el diff; el texto del usuario queda.
				const response = await fetch(`/${tenantSlug}/brain/raw/${form.slug}`, { cache: "no-store" });
				setServerBody(response.ok ? await response.text() : null);
			}
		});
	}

	return (
		<form onSubmit={submit} className="max-w-4xl space-y-5">
			{result && !result.ok && (
				<div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
					<p className="font-medium">{result.message}</p>
					{result.code === "conflict" && result.currentRevision !== null && (
						<div className="mt-3 space-y-3">
							<p>Tu texto sigue acá. Mirá qué cambió y, si querés guardar igual, reintentá sobre la revisión {result.currentRevision}.</p>
							{serverBody !== null && (
								<details open>
									<summary className="cursor-pointer">Diferencias entre la vigente y tu versión</summary>
									<pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
										{diffLines(serverBody, form.body).map((block, i) =>
											block.lines.map((line, j) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
												<div key={`${i}-${j}`} className={block.kind === "added" ? "bg-green-500/15" : block.kind === "removed" ? "bg-red-500/15" : ""}>
													{block.kind === "added" ? "+ " : block.kind === "removed" ? "- " : "  "}{line}
												</div>
											)),
										)}
									</pre>
								</details>
							)}
							<Button type="button" variant="outline" onClick={() => { setBaseRevision(result.currentRevision); setResult(null); }}>
								Reintentar sobre la revisión {result.currentRevision}
							</Button>
						</div>
					)}
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Slug</span>
					<Input value={form.slug} readOnly={mode === "edit"} aria-invalid={!!fieldError("slug")}
						onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.trim().toLowerCase() }))}
						placeholder="comercial/nueva-pagina" />
				</label>
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Título</span>
					<Input value={form.title} aria-invalid={!!fieldError("title")} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
				</label>
				<label className="space-y-1 text-sm">
					<span>Categoría</span>
					<select className="h-9 w-full rounded-md border bg-background px-3" value={form.category} aria-invalid={!!fieldError("category")}
						onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
						{categories.map((c) => <option key={c} value={c}>{c}</option>)}
					</select>
				</label>
				<label className="space-y-1 text-sm">
					<span>Estado</span>
					<select className="h-9 w-full rounded-md border bg-background px-3" value={form.status}
						onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as BrainStatus }))}>
						{BRAIN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
					</select>
				</label>
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Tags, separados por coma</span>
					<Input value={tagsText} list="brain-tags" aria-invalid={!!fieldError("tags")} onChange={(e) => setTagsText(e.target.value)} />
					<datalist id="brain-tags">
						{[...new Set([...CANON_TAGS, ...knownTags])].map((t) => <option key={t} value={t} />)}
					</datalist>
				</label>
			</div>

			<Tabs defaultValue="editar">
				<TabsList>
					<TabsTrigger value="editar">Editar</TabsTrigger>
					<TabsTrigger value="vista">Vista previa</TabsTrigger>
				</TabsList>
				<TabsContent value="editar" className="relative">
					<Textarea ref={bodyRef} value={form.body} rows={24} className="font-mono text-sm" aria-invalid={!!fieldError("body")}
						onChange={(e) => onBodyChange(e.target.value, e.target.selectionStart)}
						onKeyDown={(e) => { if (e.key === "Escape") setQuery(null); }} />
					{suggestions.length > 0 && (
						<ul className="absolute right-2 bottom-2 left-2 z-10 max-h-60 overflow-auto rounded-md border bg-popover text-sm shadow-md">
							{suggestions.map((p) => (
								<li key={p.slug}>
									<button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted" onClick={() => pick(p.slug, p.title)}>
										<span>{p.title}</span><span className="text-muted-foreground text-xs">{p.slug}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</TabsContent>
				<TabsContent value="vista">
					<div className="min-h-40 rounded-md border p-4">
						<BrainMarkdown body={form.body} tenantSlug={tenantSlug} pages={lookup} />
					</div>
				</TabsContent>
			</Tabs>

			<label className="block space-y-1 text-sm">
				<span>Motivo del cambio (queda en el historial)</span>
				<Input value={reason} required aria-invalid={!!fieldError("reason")} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: actualizo precios del Radar" />
			</label>

			<div className="flex gap-3">
				<Button type="submit" size="lg" disabled={isPending || !reason.trim()}>{isPending ? "Guardando…" : "Guardar"}</Button>
				<Button type="button" size="lg" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
			</div>
		</form>
	);
}
```

`BrainMarkdown` se usa también en el cliente (vista previa): no tiene hooks ni imports de servidor, así que funciona en los dos lados. Si Next se queja por el import de `next/link` en un componente compartido, no hace falta nada: `Link` es válido en cliente.

- [ ] **Step 7: Ruta `raw` para el diff del conflicto**

```ts
// app/[tenant]/brain/raw/[...slug]/route.ts
import { loadEditorContext } from "@/lib/brain/editor/load";
import { slugFromParams } from "@/lib/brain/editor/slug";
import { createServerSupabase } from "@/lib/supabase/server";

// Cuerpo vigente de una página, para el diff del aviso de conflicto. Misma
// regla que la vista: miembro del tenant, proveedor wiki, RLS de lectura.
export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string; slug: string[] }> }) {
	const { tenant, slug: segments } = await params;
	const ctx = await loadEditorContext(tenant);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) return new Response("No encontrado", { status: 404 });
	const { data } = await (await createServerSupabase())
		.from("brain_pages").select("body").eq("tenant_id", ctx.tenant.id).eq("slug", slug).maybeSingle();
	if (!data) return new Response("No encontrado", { status: 404 });
	return new Response(data.body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
```

- [ ] **Step 8: Páginas editar y nueva**

```tsx
// app/[tenant]/brain/editar/[...slug]/page.tsx
import { notFound } from "next/navigation";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { slugFromParams } from "@/lib/brain/editor/slug";
import { PageForm } from "../../page-form";

export default async function EditBrainPage({ params }: { params: Promise<{ tenant: string; slug: string[] }> }) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !ctx.canEdit || !slug) notFound();
	const pages = await loadBrainPages(ctx.tenant.id);
	const page = pages.find((p) => p.slug === slug);
	if (!page) notFound();
	return (
		<div>
			<h1 className="mb-6 text-3xl leading-tight">Editar «{page.title}»</h1>
			<PageForm mode="edit" tenantSlug={tenantSlug} categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug: s, title, status }) => ({ slug: s, title, status }))}
				initial={{ ...page, revision: page.revision }} />
		</div>
	);
}
```

```tsx
// app/[tenant]/brain/nueva/page.tsx
import { notFound } from "next/navigation";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { PageForm } from "../page-form";

export default async function NewBrainPage({ params }: { params: Promise<{ tenant: string }> }) {
	const { tenant: tenantSlug } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok" || !ctx.canEdit) notFound();
	const pages = await loadBrainPages(ctx.tenant.id);
	return (
		<div>
			<h1 className="mb-6 text-3xl leading-tight">Nueva página</h1>
			<PageForm mode="new" tenantSlug={tenantSlug} categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug, title, status }) => ({ slug, title, status }))}
				initial={{ slug: "", title: "", category: ctx.categories[0], status: "borrador", tags: [], frontmatter: {}, body: "", revision: null }} />
		</div>
	);
}
```

`frontmatter` de la página nueva va vacío: `validateWrite` completa `updated`, y `title`, `category` y `status` son columnas.

- [ ] **Step 9: Typecheck y navegador**

Run: `npm run typecheck && npm run lint:fix` (revertir archivos ajenos).
Verificar como `tenant_admin` en local:
1. Editar una página, cambiar texto, escribir `[[` y elegir una sugerencia: se inserta `[[slug|Título]]`.
2. Vista previa muestra el link.
3. Guardar sin motivo: el botón queda deshabilitado. Con motivo: vuelve a la página con el cambio.
4. Abrir la misma página en dos pestañas, guardar en una, guardar en la otra: aparece el aviso de conflicto, el texto sigue, el diff se ve y "Reintentar" guarda.
5. `/innovas/brain/nueva` con un slug que ya existe: "Ya existe una página con ese slug.".
6. Como `tenant_member` (usuario de prueba de la base local): `/editar` y `/nueva` dan 404 y no hay botón Editar.

- [ ] **Step 10: Commit**

```bash
git add lib/brain/editor/autocomplete.ts tests/brain/autocomplete.test.ts components/ui/tabs.tsx app/[tenant]/brain
git commit -m "feat: edición y alta de páginas del brain con autocompletado de wikilinks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Historial, diff y restaurar

**Files:**
- Create: `components/brain/diff-view.tsx`, `app/[tenant]/brain/historial/[...slug]/page.tsx`, `app/[tenant]/brain/historial/[...slug]/restore-button.tsx`
- Modify: `app/[tenant]/brain/page-form.tsx` (usar `DiffView` en el aviso de conflicto en vez del `<pre>`)

**Interfaces:**
- Consumes: `loadRevisions`, `RevisionRow`, `diffLines`, `diffMeta`, `saveBrainPage`, `loadEditorContext`, `loadBrainPages`, `slugFromParams`, `pageHref`
- Produces: `<DiffView blocks context={3} />`

- [ ] **Step 1: DiffView**

```tsx
// components/brain/diff-view.tsx
import type { DiffBlock } from "@/lib/brain/diff";

// Bloques iguales largos se colapsan dejando `context` líneas a cada lado.
export function DiffView({ blocks, context = 3 }: { blocks: DiffBlock[]; context?: number }) {
	if (blocks.every((b) => b.kind === "equal")) return <p className="text-muted-foreground text-sm">Sin cambios en el cuerpo.</p>;
	return (
		<pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
			{blocks.map((block, i) => {
				if (block.kind === "equal" && block.lines.length > context * 2 + 1) {
					const head = i === 0 ? [] : block.lines.slice(0, context);
					const tail = i === blocks.length - 1 ? [] : block.lines.slice(-context);
					const hidden = block.lines.length - head.length - tail.length;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
						<div key={i}>
							{head.map((l, j) => <div key={`h${j}`}>{`  ${l}`}</div>)}
							<div className="text-muted-foreground">{`  … ${hidden} líneas sin cambios`}</div>
							{tail.map((l, j) => <div key={`t${j}`}>{`  ${l}`}</div>)}
						</div>
					);
				}
				const cls = block.kind === "added" ? "bg-green-500/15" : block.kind === "removed" ? "bg-red-500/15" : "";
				const mark = block.kind === "added" ? "+ " : block.kind === "removed" ? "- " : "  ";
				// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
				return <div key={i} className={cls}>{block.lines.map((l, j) => <div key={j}>{mark + l}</div>)}</div>;
			})}
		</pre>
	);
}
```

En `page-form.tsx`, reemplazar el `<pre>…</pre>` del aviso de conflicto por `<DiffView blocks={diffLines(serverBody, form.body)} />` e importar `DiffView`.

- [ ] **Step 2: Botón restaurar**

```tsx
// app/[tenant]/brain/historial/[...slug]/restore-button.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { SavePageInput } from "@/lib/brain/editor/save";
import { saveBrainPage } from "../../actions";

export function RestoreButton({ input }: { input: SavePageInput }) {
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	return (
		<div className="flex flex-wrap items-center gap-3">
			<Button variant="outline" disabled={isPending}
				onClick={() => startTransition(async () => {
					const result = await saveBrainPage(input);
					if (result.ok) router.refresh();
					else setMessage(result.message);
				})}>
				{isPending ? "Restaurando…" : "Restaurar esta revisión"}
			</Button>
			{message && <span role="alert" className="text-destructive text-sm">{message}</span>}
		</div>
	);
}
```

- [ ] **Step 3: Página de historial**

```tsx
// app/[tenant]/brain/historial/[...slug]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiffView } from "@/components/brain/diff-view";
import { diffLines, diffMeta } from "@/lib/brain/diff";
import { loadEditorContext, loadRevisions } from "@/lib/brain/editor/load";
import { historyHref as historyPath, pageHref, slugFromParams } from "@/lib/brain/editor/slug";
import { RestoreButton } from "./restore-button";

const AUTHOR_LABEL = { user: "Persona", agent: "Agente", import: "Import" } as const;
const FIELD_LABEL = { title: "Título", category: "Categoría", status: "Estado" } as const;

export default async function HistoryPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
	searchParams: Promise<{ rev?: string; contra?: string }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const { rev, contra } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();
	const revisions = await loadRevisions(ctx.tenant.id, slug);
	if (!revisions || revisions.length === 0) notFound();

	const current = revisions[0];
	const selected = revisions.find((r) => String(r.revision) === rev) ?? current;
	// Por defecto se compara contra la anterior; con ?contra=vigente, contra la vigente.
	const base = contra === "vigente" ? current : revisions.find((r) => r.revision === selected.revision - 1) ?? null;
	const meta = base ? diffMeta(base, selected) : null;
	const historyHref = (query: Record<string, string>) => `${historyPath(tenantSlug, slug)}?${new URLSearchParams(query)}`;

	return (
		<div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
			<aside>
				<Link href={pageHref(tenantSlug, slug)} className="text-muted-foreground text-sm">← {current.title}</Link>
				<h1 className="mb-4 text-2xl">Historial</h1>
				<ol className="divide-y rounded-lg border text-sm">
					{revisions.map((r) => (
						<li key={r.revision}>
							<Link href={historyHref({ rev: String(r.revision) })}
								className={`block px-3 py-2 hover:bg-muted/50 ${r.revision === selected.revision ? "bg-muted" : ""}`}>
								<span className="font-medium">Rev. {r.revision}</span>{" "}
								<span className="rounded-full border px-1.5 text-xs">{AUTHOR_LABEL[r.authorKind]}</span>
								<span className="block text-muted-foreground text-xs">
									{new Date(r.createdAt).toLocaleString("es-AR")}{r.authorEmail ? ` · ${r.authorEmail}` : ""}
								</span>
								<span className="block truncate">{r.reason}</span>
							</Link>
						</li>
					))}
				</ol>
			</aside>
			<section className="min-w-0 space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="mr-auto text-lg">
						Revisión {selected.revision} {base ? `contra ${base === current ? "la vigente" : `la ${base.revision}`}` : "(la primera)"}
					</h2>
					{selected !== current && (
						<Link className="text-sm underline" href={historyHref({ rev: String(selected.revision), ...(contra === "vigente" ? {} : { contra: "vigente" }) })}>
							{contra === "vigente" ? "Comparar con la anterior" : "Comparar con la vigente"}
						</Link>
					)}
					{ctx.canEdit && selected !== current && (
						<RestoreButton input={{
							tenantSlug, slug, title: selected.title, category: selected.category, status: selected.status,
							tags: selected.tags, frontmatter: selected.frontmatter, body: selected.body,
							reason: `Restaurada desde la revisión ${selected.revision}`, baseRevision: current.revision,
						}} />
					)}
				</div>
				<p className="text-sm"><span className="text-muted-foreground">Motivo:</span> {selected.reason}</p>
				{meta && (meta.changes.length > 0 || meta.tagsAdded.length > 0 || meta.tagsRemoved.length > 0) && (
					<ul className="space-y-1 rounded-md border p-3 text-sm">
						{meta.changes.map((c) => <li key={c.field}>{FIELD_LABEL[c.field]}: <s>{c.from}</s> → {c.to}</li>)}
						{meta.tagsAdded.length > 0 && <li>Tags agregados: {meta.tagsAdded.join(", ")}</li>}
						{meta.tagsRemoved.length > 0 && <li>Tags quitados: {meta.tagsRemoved.join(", ")}</li>}
					</ul>
				)}
				<DiffView blocks={diffLines(base?.body ?? "", selected.body)} />
			</section>
		</div>
	);
}
```

Nota sobre la dirección: con `?contra=vigente`, `diffMeta(current, selected)` y `diffLines(current.body, selected.body)` muestran qué cambiaría si se restaura `selected` (lo verde es lo que volvería).

- [ ] **Step 4: Typecheck y navegador**

Run: `npm run typecheck && npm run lint:fix` (revertir archivos ajenos).
Verificar: el historial lista revisiones con badge de autor y email de miembros; seleccionar una muestra metadatos y diff; "Comparar con la vigente" cambia la base; restaurar como admin crea una revisión nueva con el motivo "Restaurada desde la revisión N"; como `tenant_member` el botón no aparece. Revisiones del import muestran "Import" sin email.

- [ ] **Step 5: Commit**

```bash
git add components/brain/diff-view.tsx app/[tenant]/brain
git commit -m "feat: historial del brain con diff y restauración

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: QA, docs y PR

**Files:**
- Modify: `docs/01-roadmap-etapas.md:208` (tildar el editor del brain), `docs/superpowers/specs/2026-09-27-editor-brain-design.md` (anotar el paso previo en vez de plugin remark de la Task 4 y cualquier otro desvío real)

- [ ] **Step 1: Suite completa**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 2: `/qa` en desktop y mobile**

Correr la skill `/qa` contra `http://localhost:3000/innovas/brain` con los cinco recorridos de la spec §8 ("Navegador"). Corregir lo que encuentre en commits `fix:`.

- [ ] **Step 3: Docs**

- En `docs/01-roadmap-etapas.md`, cambiar `- [ ] Editor del brain (spec 2026-09-13-brain-design §8).` por `- [x] Editor del brain: spec 2026-09-27-editor-brain-design, PR <n>.` (el número se completa al abrir el PR).
- En la spec del editor, sección 9, sumar los desvíos reales de implementación (paso previo sobre el texto en vez de plugin remark, y lo que haya surgido en QA).

```bash
git add docs
git commit -m "docs: editor del brain en el roadmap y desvíos de implementación

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: PR con `/ship`**

Correr `/ship` desde el worktree. Push a `origin feat/editor-brain` (la rama no tiene upstream: `git push -u origin feat/editor-brain`). Después de abrir el PR, bindearlo con las tools `ccd_pr`.

- [ ] **Step 5: Verificación en producción (criterio de cierre)**

Con el PR mergeado y deployado: entrar a `https://agentes.innov.as/innovas/brain`, editar una página del canon con motivo, confirmar en el historial la revisión `Persona` con el email, y desde el chat del agente pedir un `brain_search` que la devuelva con el cambio. Recién ahí `/context-save`.
