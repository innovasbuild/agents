# Etapa 18.2 · Editor visual y vista de papel del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que quien puede editar una página del brain la abra ya en modo edición, con un editor visual de markdown liviano (Tiptap) y guardado explícito con motivo opcional, y que quien solo lee la vea como una hoja de papel.

**Architecture:** La primera tarea es una prueba que decide: Tiptap (`@tiptap/markdown`) lee y escribe markdown sobre un corpus y sobre páginas reales sin perder contenido; si no pasa, se frena y se replantea. Lo puro (qué cuerpo se guarda, quién entra en edición, motivo por defecto) vive en `lib/brain/core/editor/`. La interfaz vive en `components/brain/editor/` (editor, barra de herramientas, nodo de link del brain, espacio de trabajo) y en `components/brain/` (hoja, panel de detalles, vista de lectura). `/brain/p/<slug>` decide en el servidor entre lectura y edición; `/brain/editar` redirige; `PageForm` se retira.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown` 3.31+, extensiones de tabla y de tareas), `react-markdown` + `remark-gfm` (vista de lectura, sin cambios), Vitest (entorno `node`; `happy-dom` solo para los tests de Tiptap), shadcn/ui, Tailwind, Biome.

**Spec:** `docs/superpowers/specs/2026-10-08-etapa-18-2-editor-visual-brain-design.md` (§1 a §9). Base: Etapas 17 (permisos y árbol) y 18.1 (borrado). **Esta rama parte de `feat/etapa-18-1-borrado-brain` (PR 76)**, porque el botón "Borrar página" pasa al panel "Detalles". Cuando el PR 76 se mergee, `git rebase origin/main` antes de abrir el PR de esta entrega.

## Global Constraints

- **Entrada por permiso (V1):** `lector` ve la hoja de lectura; `editor` o `administrador` abren `/brain/p/<slug>` ya en edición; lo invisible sigue siendo 404. `/brain/editar/<slug>` redirige a `/brain/p/<slug>` (permanente). `/brain/nueva` usa el mismo espacio de trabajo.
- **Guardado explícito (V2):** "Guardar" y "Descartar" en una barra que aparece solo con cambios. Sin autoguardado.
- **Motivo opcional desde la web (V3):** vacío o solo espacios se registra como `Edición desde la web`. Agente y MCP siguen obligados a dar motivo (`contract.ts` y `brain_upsert_page` no cambian).
- **El markdown es la fuente de verdad (V5, V6):** si lo que el editor serializa es lo mismo que serializaba el cuerpo original al cargarlo, se guarda el cuerpo **original** tal cual. Abrir una página y cambiarle un metadato no reescribe el texto.
- **Los links del brain son un nodo propio (V9):** se leen de `[[slug]]`, `[[slug|alias]]` y `[[slug#ancla|alias]]` y se escriben **byte a byte** como estaban si no se tocaron.
- **Sin HTML crudo (V10):** el editor no lo interpreta; `<script>` o `<img onerror>` en el markdown se muestran como texto y nunca llegan al DOM como elementos. Es una condición de seguridad: el agente también escribe páginas.
- **Hoja blanca en los dos temas (V11)** con variables `--paper`, `--paper-foreground` y `--paper-muted`; nada de colores fijos en los componentes (solo tokens de shadcn y esas variables).
- **El código de Tiptap vive fuera de `lib/brain/core` (V13).** `lib/brain/core` no importa nada fuera de `lib/brain/core` (salvo `zod`, `yaml`, `@modelcontextprotocol/sdk/*`, `node:*` e `import type` de `@supabase/supabase-js`); lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core/access/` llevan extensión `.ts`.
- Los permisos de escritura siguen decidiéndolos `withAccess` en `savePage`/`saveBrainPage`; la pantalla es solo una conveniencia. El control de revisión (`baseRevision`), el conflicto, el diff y "Reintentar sobre la revisión N" se mantienen.
- UI en español rioplatense; código e identificadores en inglés. A 375 px: sin scroll horizontal de la página, la barra de herramientas se desplaza dentro de sí misma y los objetivos táctiles miden al menos 44 px (`min-h-11`).
- Commits con prefijo `feat:` / `fix:` / `refactor:` / `test:` / `docs:` y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No correr `npm run lint:fix` sobre todo el repo (reformatea archivos ajenos). Formatear solo lo que se edita: `npx biome check --write <archivos>`; si Biome reformatea código ajeno al cambio, revertir ese hunk.
- **Entorno:** el `node` por defecto es v14: toda orden se corre con `PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH`. Este worktree no tiene `node_modules` (no usar un enlace al checkout principal: instalar acá). Toda tarea se ejecuta con `cd` al worktree `/Users/mok/Sites/innovas/agents/.claude/worktrees/etapa-18-2-editor-visual`; antes de commitear verificar `git rev-parse --show-toplevel` y la rama `feat/etapa-18-2-editor-visual`. Nunca correr nada contra la base remota.

## Precisiones respecto de la spec

1. **La decisión "cuerpo original o serializado" se toma comparando con la ida y vuelta del original**, no con una bandera de "hubo cambios": `chooseBodyToSave({ original, originalRoundtrip, serialized })` devuelve el original si `serialized === originalRoundtrip`. Así, escribir y deshacer hasta el mismo texto tampoco reescribe el cuerpo.
2. **El nodo de link guarda el texto original (`raw`)** y lo vuelve a escribir tal cual mientras no se edite el nodo; solo al editar alias o destino se genera la forma canónica. Es lo que cumple "byte a byte iguales".
3. **En la vista de código el cuerpo es el texto vigente que decide el espacio de trabajo** (el original si no hubo cambios), no la serialización del editor; así abrir y cerrar la vista de código no normaliza nada.
4. **Para la prueba de ida y vuelta con páginas reales**, las páginas se leen de `tests/fixtures/brain-real/` (carpeta ignorada por git): el repositorio es público y esas páginas son del negocio. Si la carpeta no existe, la prueba corre solo con el corpus sintético.
5. **El botón "Editar" desaparece** del menú del árbol y de la cabecera de la página (la página ya abre en edición). Se retira `editHref` y su assertion.

## Review Focus

Entradas que la spec implica y ninguna tarea prueba por sí sola; cada una tiene su test o su verificación en la tarea que se indica.

1. HTML crudo (`<script>`, `<img onerror>`) en el markdown no se convierte en elementos del editor ni del HTML que genera. → Tarea 1.
2. Tablas con alineación, listas anidadas, bloques de código con `[[...]]` y markdown adentro, links del brain dentro de listas y tablas, líneas en blanco consecutivas y caracteres escapados no pierden contenido y quedan estables en una segunda pasada. → Tarea 1.
3. Un `[[...]]` dentro de código no se convierte en nodo. → Tarea 1.
4. Motivo vacío o de solo espacios → `Edición desde la web`; con motivo, se respeta recortado. → Tarea 2.
5. Abrir una página y cambiar solo un metadato (tag, estado, categoría) guarda el cuerpo idéntico; escribir y deshacer hasta el mismo texto, también. → Tarea 2 (función pura) y Tarea 5 (cableado).
6. Un conflicto de revisión conserva el texto de quien editaba, muestra el diff y permite reintentar sobre la revisión nueva. → Tarea 5.
7. Título vacío o demasiado largo y slug inválido en una página nueva muestran el error en el campo, sin perder lo escrito. → Tarea 5.
8. La barra de herramientas a 375 px se desplaza sola y no mueve la página. → Tarea 4 (verificación en navegador).

---

### Task 1: Prueba de ida y vuelta de markdown con Tiptap (decide si se sigue)

**Files:**
- Modify: `package.json`, `package-lock.json` (dependencias)
- Modify: `.gitignore` (`tests/fixtures/brain-real/`)
- Create: `components/brain/editor/wikilink-node.ts`
- Create: `components/brain/editor/extensions.ts`
- Create: `tests/fixtures/markdown-corpus.ts`
- Test: `tests/brain/editor-roundtrip.test.ts`

**Interfaces:**
- Consumes: `parseWikilinks`, `WIKILINK_PATTERN` de `lib/brain/core/wikilinks.ts`; `toMarkdownLinks` de `lib/brain/core/editor/markdown-links.ts`.
- Produces (Tareas 4 y 5):
  - `interface EditorLookups { titleFor: (slug: string) => string | undefined; exists: (slug: string) => boolean }`
  - `buildExtensions(lookups: EditorLookups): Extensions` en `components/brain/editor/extensions.ts`.
  - La extensión `WikiLink` (nombre de nodo `wikiLink`, atributos `target`, `anchor`, `alias`, `raw`).
  - `CORPUS: Array<{ name: string; md: string; exact: boolean; note?: string }>` en `tests/fixtures/markdown-corpus.ts`.

**Esta tarea es una compuerta.** Si al terminar queda un caso que **pierde contenido, rompe una tabla, toca un bloque de código, altera un link del brain o convierte HTML crudo en elementos**, y no se arregla con configuración o con una extensión propia, **no se sigue**: informar `BLOCKED` con el caso y la salida exacta. El controlador replantea con Milkdown (comparte motor `remark` con la vista de lectura). Una normalización de estilo estable (por ejemplo `*` → `-` en viñetas) **sí se acepta**, marcando `exact: false` y explicándola en `note`.

- [ ] **Step 1: Instalar en el worktree y comprobar el entorno**

```bash
export PATH=/Users/mok/.nvm/versions/node/v24.14.1/bin:$PATH
cd /Users/mok/Sites/innovas/agents/.claude/worktrees/etapa-18-2-editor-visual
npm ci
```

Después, con **la misma versión exacta** para todos los paquetes de Tiptap (la última 3.x, hoy 3.31.4; `@tiptap/markdown` exige ≥ 3.7):

```bash
npm install --save-exact @tiptap/core@3.31.4 @tiptap/pm@3.31.4 @tiptap/react@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/markdown@3.31.4 @tiptap/extension-table@3.31.4 @tiptap/extension-table-row@3.31.4 @tiptap/extension-table-cell@3.31.4 @tiptap/extension-table-header@3.31.4 @tiptap/extension-task-list@3.31.4 @tiptap/extension-task-item@3.31.4
npm install --save-dev happy-dom
```

Si `npm view @tiptap/markdown version` muestra una 3.x más nueva, usar esa para todos. Anotar en el informe: versión instalada, si `npm install` avisó conflicto con React 19.2.8 / Next 16 (peer dependencies), y el peso que suma al `package-lock.json`.

Confirmar que `@tiptap/starter-kit` incluye `Link` y `Underline` (`node_modules/@tiptap/starter-kit/package.json` los lista como dependencias en 3.31.4) y leer `node_modules/@tiptap/markdown/README.md` o `dist/index.d.ts` para fijar la forma exacta de `markdownTokenizer`, `parseMarkdown`, `renderMarkdown`, `getMarkdown()` y `setContent(..., { contentType: 'markdown' })`: el código de abajo sigue la documentación pública y se ajusta a lo que digan los tipos instalados.

- [ ] **Step 2: Ignorar las páginas reales**

Agregar a `.gitignore`:

```
# páginas reales del brain para la prueba de ida y vuelta (no se versionan)
tests/fixtures/brain-real/
```

- [ ] **Step 3: Escribir el corpus**

`tests/fixtures/markdown-corpus.ts` (líneas unidas con `\n` para no pelear con los backticks):

```ts
// Corpus de la prueba de ida y vuelta del editor (spec 18.2 §5.3). `exact: true`
// exige que el markdown salga idéntico; `exact: false` acepta una normalización
// de estilo estable y la explica en `note`.
export interface CorpusCase {
	name: string;
	md: string;
	exact: boolean;
	note?: string;
}

const j = (...lines: string[]) => lines.join("\n");

export const CORPUS: CorpusCase[] = [
	{ name: "titulos", exact: true, md: j("# Uno", "", "## Dos", "", "### Tres", "", "Texto.") },
	{ name: "enfasis", exact: true, md: "Texto con **negrita**, *cursiva*, ~~tachado~~ y `código`." },
	{ name: "viñetas anidadas", exact: true, md: j("- uno", "  - dos", "    - tres", "- cuatro") },
	{ name: "numerada", exact: true, md: j("1. uno", "2. dos", "3. tres") },
	{ name: "tareas", exact: true, md: j("- [ ] pendiente", "- [x] hecha") },
	{ name: "cita", exact: true, md: j("> una cita", "> en dos líneas") },
	{ name: "linea divisoria", exact: true, md: j("Antes", "", "---", "", "Después") },
	{ name: "link e imagen", exact: true, md: "Mirá [la web](https://innov.as) y ![logo](https://innov.as/logo.png)." },
	{
		name: "codigo con lenguaje",
		exact: true,
		md: j("```ts", "const a = 1;", "```"),
	},
	{
		name: "codigo con markdown y wikilink adentro",
		exact: true,
		md: j("```md", "# no es un título", "[[comercial/icp]] no es un link", "```"),
	},
	{
		name: "tabla con alineacion",
		exact: true,
		md: j("| Nombre | Precio | Nota |", "| :--- | ---: | :---: |", "| Radar | 100 | ok |", "| Mapa | 250 | ok |"),
	},
	{ name: "wikilink simple", exact: true, md: "Ver [[comercial/icp]] hoy." },
	{ name: "wikilink con alias", exact: true, md: "Ver [[comercial/icp|el perfil]] hoy." },
	{ name: "wikilink con ancla y alias", exact: true, md: "Ver [[comercial/icp#objeciones|las objeciones]]." },
	{ name: "wikilink con espacios raros", exact: true, md: "Ver [[ comercial/icp | el perfil ]] hoy." },
	{
		name: "wikilink en lista y en tabla",
		exact: true,
		md: j("- [[comercial/icp|ICP]]", "- [[legal/contrato]]", "", "| Página | Nota |", "| --- | --- |", "| [[comercial/icp|ICP]] | base |"),
	},
	{ name: "wikilink en codigo en linea", exact: true, md: "Escribí `[[slug]]` para enlazar." },
	{ name: "linea en blanco consecutivas", exact: false, note: "las líneas en blanco extra pueden colapsar o pasar a &nbsp;; el contenido visible es el mismo", md: j("Uno", "", "", "", "Dos") },
	{ name: "salto duro", exact: true, md: j("línea uno  ", "línea dos") },
	{ name: "escapes", exact: true, md: "Un asterisco \\* y un guion bajo \\_ y un corchete \\[ sueltos." },
	{ name: "acentos y ñ", exact: true, md: "Camión, niño, corazón, ¿qué tal? ¡Hola!" },
	{
		name: "documento largo mezclado",
		exact: false,
		note: "documento real de ejemplo; solo se exige que no pierda contenido y que sea estable",
		md: j(
			"# Perfil de cliente ideal",
			"",
			"Hablamos con **dueños** de pymes agro. Ver [[comercial/mensajes|los mensajes]].",
			"",
			"## Señales",
			"",
			"- Maneja más de 500 ha",
			"  - propias o arrendadas",
			"- Usa [[tecnica/radar]]",
			"",
			"> Regla: nunca prometer plazos.",
			"",
			"| Segmento | Tamaño |",
			"| --- | --- |",
			"| Chico | < 500 ha |",
			"| Grande | > 2000 ha |",
		),
	},
];

// Casos de seguridad (spec 18.2 V10): el HTML crudo nunca se vuelve elemento.
export const HOSTILE: Array<{ name: string; md: string }> = [
	{ name: "script", md: "Hola <script>alert(1)</script> mundo" },
	{ name: "img con onerror", md: "Mirá <img src=x onerror=alert(1)> esto" },
	{ name: "bloque html", md: j("<div onclick=\"alert(1)\">", "hola", "</div>") },
	{ name: "link javascript", md: "[clic](javascript:alert(1))" },
];
```

- [ ] **Step 4: Escribir el nodo de link del brain**

`components/brain/editor/wikilink-node.ts`:

```ts
// Nodo de link del brain para Tiptap (spec 18.2 V9). Lee y escribe los
// wikilinks [[slug]], [[slug|alias]] y [[slug#ancla|alias]]. Guarda el texto
// original (`raw`) y lo devuelve tal cual mientras no se edite el nodo, para que
// abrir y guardar una página no cambie ni un carácter de sus links.
import { mergeAttributes, Node } from "@tiptap/core";

export interface WikiLinkOptions {
	titleFor: (slug: string) => string | undefined;
	exists: (slug: string) => boolean;
}

const WIKILINK_AT_START = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/;

export function canonicalWikiLink(attrs: {
	target: string;
	anchor: string | null;
	alias: string | null;
}): string {
	const anchor = attrs.anchor ? `#${attrs.anchor}` : "";
	const alias = attrs.alias ? `|${attrs.alias}` : "";
	return `[[${attrs.target}${anchor}${alias}]]`;
}

export const WikiLink = Node.create<WikiLinkOptions>({
	name: "wikiLink",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,

	addOptions() {
		return { titleFor: () => undefined, exists: () => true };
	},

	addAttributes() {
		return {
			target: { default: "" },
			anchor: { default: null },
			alias: { default: null },
			raw: { default: null },
		};
	},

	parseHTML() {
		return [{ tag: "span[data-wikilink]" }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const { target, alias } = node.attrs as {
			target: string;
			alias: string | null;
		};
		const label = alias ?? this.options.titleFor(target) ?? target;
		const broken = !this.options.exists(target);
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-wikilink": target,
				"data-broken": broken ? "true" : undefined,
				title: broken ? `No existe la página ${target}` : target,
				class: "brain-wikilink",
			}),
			label,
		];
	},

	markdownTokenizer: {
		name: "wikiLink",
		level: "inline",
		start: (src: string) => src.indexOf("[["),
		tokenize: (src: string) => {
			const match = WIKILINK_AT_START.exec(src);
			if (!match) return undefined;
			return {
				type: "wikiLink",
				raw: match[0],
				target: match[1].trim(),
				anchor: match[2] ? match[2].slice(1).trim() || null : null,
				alias: match[3]?.trim() || null,
			};
		},
	},

	parseMarkdown: (token: {
		raw: string;
		target: string;
		anchor: string | null;
		alias: string | null;
	}) => ({
		type: "wikiLink",
		attrs: {
			target: token.target,
			anchor: token.anchor,
			alias: token.alias,
			raw: token.raw,
		},
	}),

	renderMarkdown: (node: { attrs?: Record<string, unknown> }) => {
		const attrs = (node.attrs ?? {}) as {
			target: string;
			anchor: string | null;
			alias: string | null;
			raw: string | null;
		};
		return attrs.raw ?? canonicalWikiLink(attrs);
	},
});
```

El tokenizador de `marked` recibe `src` desde la posición actual: el patrón lleva `^`. Si la API instalada difiere (por ejemplo el nombre de `start`/`tokenize`, o `parseMarkdown` recibiendo `helpers`), ajustar a los tipos reales sin cambiar el comportamiento descrito.

- [ ] **Step 5: Armar las extensiones**

`components/brain/editor/extensions.ts`:

```ts
// Conjunto de extensiones del editor del brain (spec 18.2 §4). Una sola función
// para que el editor de la pantalla y la prueba de ida y vuelta usen lo mismo.
import type { Extensions } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { WikiLink } from "./wikilink-node";

export interface EditorLookups {
	titleFor: (slug: string) => string | undefined;
	exists: (slug: string) => boolean;
}

export function buildExtensions(lookups: EditorLookups): Extensions {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3] },
			link: { openOnClick: false, autolink: false },
		}),
		Table.configure({ resizable: false }),
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({ nested: true }),
		WikiLink.configure(lookups),
		Markdown.configure({ markedOptions: { gfm: true } }),
	];
}
```

Si alguno de esos paquetes exporta por defecto en lugar de por nombre (o `Table` trae sus filas y celdas), ajustar los imports a lo que digan los tipos instalados.

- [ ] **Step 6: Escribir la prueba de ida y vuelta (debe fallar primero por la falta de código o por un caso real)**

`tests/brain/editor-roundtrip.test.ts`:

```ts
// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { buildExtensions } from "@/components/brain/editor/extensions";
import { parseWikilinks } from "@/lib/brain/core/wikilinks";
import { type CorpusCase, CORPUS, HOSTILE } from "../fixtures/markdown-corpus";

const REAL_DIR = new URL("../fixtures/brain-real/", import.meta.url);
const REAL: CorpusCase[] = existsSync(REAL_DIR)
	? readdirSync(REAL_DIR)
			.filter((file) => file.endsWith(".md"))
			.map((file) => ({
				name: `real: ${file}`,
				md: readFileSync(new URL(file, REAL_DIR), "utf8"),
				exact: false,
			}))
	: [];

function roundtrip(md: string): { markdown: string; html: string } {
	const editor = new Editor({
		extensions: buildExtensions({ titleFor: () => undefined, exists: () => true }),
		content: md,
		contentType: "markdown",
	});
	const result = { markdown: editor.getMarkdown(), html: editor.getHTML() };
	editor.destroy();
	return result;
}

// Lo que ve quien lee la página (react-markdown + GFM), sin el paso de wikilinks:
// los [[...]] se comparan aparte, byte a byte.
function rendered(md: string): string {
	return renderToStaticMarkup(
		createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md),
	);
}

const links = (md: string) =>
	parseWikilinks(md).map((link) => md.slice(link.start, link.end));

describe.each([...CORPUS, ...REAL])("ida y vuelta: $name", (testCase) => {
	const { markdown } = roundtrip(testCase.md);

	it("no pierde contenido: la vista de lectura es la misma", () => {
		expect(rendered(markdown)).toBe(rendered(testCase.md));
	});

	it("los links del brain salen byte a byte iguales", () => {
		expect(links(markdown)).toEqual(links(testCase.md));
	});

	it("es estable: una segunda pasada no cambia nada", () => {
		expect(roundtrip(markdown).markdown).toBe(markdown);
	});

	if (testCase.exact) {
		it("sale idéntico, carácter por carácter", () => {
			expect(markdown).toBe(testCase.md);
		});
	}
});

describe("un [[...]] dentro de código no es un nodo", () => {
	it("no genera elementos de link del brain", () => {
		for (const name of ["wikilink en codigo en linea", "codigo con markdown y wikilink adentro"]) {
			const found = CORPUS.find((c) => c.name === name);
			expect(found, name).toBeDefined();
			expect(roundtrip(found?.md ?? "").html).not.toContain("data-wikilink");
		}
	});
});

describe("HTML crudo: nunca se vuelve elemento (spec V10)", () => {
	it.each(HOSTILE)("$name", ({ md }) => {
		const { html, markdown } = roundtrip(md);
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/<img/i);
		expect(html).not.toMatch(/<div/i);
		expect(html).not.toMatch(/\son[a-z]+=/i);
		expect(html.toLowerCase()).not.toContain('href="javascript:');
		// y el texto no se pierde: lo que escribió el agente sigue estando
		expect(markdown.replace(/\\/g, "")).toContain(md.replace(/\\/g, "").split("\n")[0].slice(0, 12));
	});
});
```

Run: `npx vitest run tests/brain/editor-roundtrip.test.ts`

Expected: el primer corrido falla (módulo o API). Corregir `wikilink-node.ts` / `extensions.ts` hasta que **solo queden fallas que sean de contenido**.

- [ ] **Step 7: Llevar la prueba a verde o a una decisión documentada**

Para cada caso rojo, en este orden:
1. Si es un problema de configuración (indentación, `markedOptions`, orden de extensiones, `breaks`), ajustar `extensions.ts` y re-correr.
2. Si es una normalización de estilo estable que no pierde contenido: poner `exact: false` con `note` en el corpus. Una normalización es aceptable solo si (a) `rendered()` es igual antes y después, (b) los links del brain salen iguales y (c) la segunda pasada no cambia nada.
3. Si pierde contenido, rompe una tabla, toca un bloque de código, altera un link del brain, convierte HTML crudo en elementos o no se estabiliza: **frenar la tarea y reportar `BLOCKED`** con el caso, el `md` de entrada, el `markdown` de salida y la causa probable.

Si existe `tests/fixtures/brain-real/` (lo prepara el controlador antes de despachar esta tarea), el resultado de esas páginas es parte del informe: cuántas pasaron, y de las que no, el diff mínimo.

- [ ] **Step 8: Tipos, frontera y tests**

Run: `npx vitest run tests/brain/editor-roundtrip.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. `happy-dom` aplica solo a este archivo (docblock); el resto de los tests siguen en `node`. Confirmar corriendo `npx vitest run tests/brain` completo.

- [ ] **Step 9: Formatear y commitear**

```bash
npx biome check --write components/brain/editor/wikilink-node.ts components/brain/editor/extensions.ts tests/fixtures/markdown-corpus.ts tests/brain/editor-roundtrip.test.ts
git add package.json package-lock.json .gitignore components/brain/editor tests/fixtures/markdown-corpus.ts tests/brain/editor-roundtrip.test.ts
git commit -m "feat: prueba de ida y vuelta de markdown con Tiptap y nodo de link del brain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

El informe incluye la tabla de resultados del corpus (caso, `exact`, normalización) y el veredicto **SIGUE / SE FRENA**.

---

### Task 2: Funciones puras de guardado y entrada por permiso

**Files:**
- Create: `lib/brain/core/editor/body-to-save.ts`
- Create: `lib/brain/core/editor/entry-mode.ts`
- Modify: `lib/brain/core/editor/save.ts` (motivo por defecto)
- Modify: `tests/brain/editor-save.test.ts` (el test "exige motivo" pasa a "usa el motivo por defecto")
- Test: `tests/brain/editor-body-to-save.test.ts`
- Test: `tests/brain/editor-entry-mode.test.ts`

**Interfaces:**
- Consumes: `atLeast`, `Level` de `lib/brain/core/access/types.ts`.
- Produces (Tareas 5 y 6):
  - `chooseBodyToSave(input: { original: string; originalRoundtrip: string; serialized: string }): string`
  - `type EntryMode = "hidden" | "read" | "edit"` y `entryMode(level: Level | null): EntryMode`
  - `DEFAULT_WEB_REASON = "Edición desde la web"` exportada de `save.ts`.

- [ ] **Step 1: Escribir los tests**

`tests/brain/editor-body-to-save.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseBodyToSave } from "@/lib/brain/core/editor/body-to-save";

const original = "* uno\n* dos\n";
const originalRoundtrip = "- uno\n- dos";

describe("chooseBodyToSave", () => {
	it("si el editor serializa lo mismo que serializaba el original, se guarda el original tal cual", () => {
		expect(
			chooseBodyToSave({ original, originalRoundtrip, serialized: "- uno\n- dos" }),
		).toBe(original);
	});

	it("si la persona cambió el contenido, se guarda lo serializado", () => {
		expect(
			chooseBodyToSave({ original, originalRoundtrip, serialized: "- uno\n- dos\n- tres" }),
		).toBe("- uno\n- dos\n- tres");
	});

	it("escribir y deshacer hasta el mismo texto no reescribe el cuerpo", () => {
		const edited = chooseBodyToSave({ original, originalRoundtrip, serialized: "- uno\n- dos\n- x" });
		expect(edited).not.toBe(original);
		expect(
			chooseBodyToSave({ original, originalRoundtrip, serialized: originalRoundtrip }),
		).toBe(original);
	});

	it("un original que ya está en el estilo del editor se devuelve igual", () => {
		expect(
			chooseBodyToSave({ original: "texto", originalRoundtrip: "texto", serialized: "texto" }),
		).toBe("texto");
	});
});
```

`tests/brain/editor-entry-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { entryMode } from "@/lib/brain/core/editor/entry-mode";

describe("entryMode", () => {
	it("lo que no se ve es hidden; lector es read; editor y administrador son edit", () => {
		expect(entryMode(null)).toBe("hidden");
		expect(entryMode("lector")).toBe("read");
		expect(entryMode("editor")).toBe("edit");
		expect(entryMode("administrador")).toBe("edit");
	});
});
```

En `tests/brain/editor-save.test.ts`, reemplazar el test `"exige motivo"` por:

```ts
	it("sin motivo usa el de la web; con motivo, lo respeta recortado", async () => {
		const empty = deps();
		expect(await savePage({ ...input, reason: "  " }, empty.deps)).toMatchObject({ ok: true });
		expect(empty.provider.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "Edición desde la web" }),
			expect.anything(),
		);

		const given = deps();
		await savePage({ ...input, reason: "  ajusto precios  " }, given.deps);
		expect(given.provider.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "ajusto precios" }),
			expect.anything(),
		);
	});
```

(La forma de `deps()` y de `provider.upsert` es la del archivo existente; adaptar los `expect` a sus tipos.)

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/brain/editor-body-to-save.test.ts tests/brain/editor-entry-mode.test.ts tests/brain/editor-save.test.ts`
Expected: FAIL (módulos nuevos inexistentes y el motivo vacío sigue rechazándose).

- [ ] **Step 3: Implementar**

`lib/brain/core/editor/body-to-save.ts`:

```ts
// Qué cuerpo se guarda (spec 18.2 V6). El editor visual lee el markdown y lo
// vuelve a escribir, y a veces lo normaliza. Si lo que serializa ahora es lo
// mismo que serializaba el cuerpo original al cargarlo, la persona no cambió
// nada y se guarda el original tal cual.
export function chooseBodyToSave(input: {
	original: string;
	originalRoundtrip: string;
	serialized: string;
}): string {
	return input.serialized === input.originalRoundtrip
		? input.original
		: input.serialized;
}
```

`lib/brain/core/editor/entry-mode.ts`:

```ts
// Cómo se entra a una página (spec 18.2 V1): quien puede editar abre directo en
// edición; quien solo puede leer ve la hoja de lectura.
import { atLeast, type Level } from "../access/types.ts";

export type EntryMode = "hidden" | "read" | "edit";

export function entryMode(level: Level | null): EntryMode {
	if (level === null) return "hidden";
	return atLeast(level, "editor") ? "edit" : "read";
}
```

En `lib/brain/core/editor/save.ts`: agregar `export const DEFAULT_WEB_REASON = "Edición desde la web";` arriba de `savePage`; borrar el bloque `if (input.reason.trim().length === 0) return {... fields: ["reason"] ...}`; y en el armado de `write`, usar `reason: input.reason.trim() || DEFAULT_WEB_REASON`. Actualizar el comentario de cabecera del archivo con una línea: "El motivo es opcional desde la web: vacío se registra como 'Edición desde la web' (spec 18.2 V3); el agente y el MCP lo siguen dando siempre."

- [ ] **Step 4: Correr tests, frontera y tipos**

Run: `npx vitest run tests/brain/editor-body-to-save.test.ts tests/brain/editor-entry-mode.test.ts tests/brain/editor-save.test.ts tests/brain/save-action.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/editor/body-to-save.ts lib/brain/core/editor/entry-mode.ts lib/brain/core/editor/save.ts tests/brain/editor-body-to-save.test.ts tests/brain/editor-entry-mode.test.ts tests/brain/editor-save.test.ts
git add lib/brain/core/editor/body-to-save.ts lib/brain/core/editor/entry-mode.ts lib/brain/core/editor/save.ts tests/brain/editor-body-to-save.test.ts tests/brain/editor-entry-mode.test.ts tests/brain/editor-save.test.ts
git commit -m "feat: motivo opcional desde la web y funciones puras de cuerpo a guardar y de entrada por permiso

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hoja de papel y vista de lectura

**Files:**
- Modify: `app/globals.css` (variables y clases de la hoja)
- Create: `components/brain/paper.tsx`
- Create: `components/brain/page-facts.tsx`
- Create: `components/brain/details-sheet.tsx`
- Create: `components/brain/reading-view.tsx`
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx` (usa `ReadingView`; el resto de los botones se queda como está en esta tarea)

**Interfaces:**
- Consumes: `BrainMarkdown`, `PageLookup` (`components/brain/markdown.tsx`); `ConnectionsPanel`; `BrainPage`, `BrainStatus`.
- Produces (Tareas 5 y 6):
  - `<Paper className?>{children}</Paper>` (server-safe).
  - `<PageFacts page outgoing incoming titleFor tenantSlug />`
  - `<DetailsSheet title? trigger?>{children}</DetailsSheet>` (cliente).
  - `<ReadingView tenantSlug page lookup outgoing incoming actions />`.

- [ ] **Step 1: Estilos de la hoja**

En `app/globals.css`, junto a las demás variables, agregar a `:root` y a `.dark` (iguales en los dos):

```css
	--paper: #ffffff;
	--paper-foreground: #1c1c1c;
	--paper-muted: #f4f2ec;
	--paper-muted-foreground: #6b6b6b;
	--paper-border: #e4e1d8;
```

y debajo de las reglas `.brain-prose`:

```css
/* Hoja de papel del brain (spec 18.2 §6): blanca en los dos temas, con borde
   sutil. Re-escribe los tokens adentro para que el texto, el código y las tablas
   se vean bien también con el tema oscuro del sistema. */
.brain-paper {
	--foreground: var(--paper-foreground);
	--muted: var(--paper-muted);
	--muted-foreground: var(--paper-muted-foreground);
	--border: var(--paper-border);
	background: var(--paper);
	color: var(--paper-foreground);
	border: 1px solid var(--paper-border);
	border-radius: var(--radius-md);
	box-shadow: 0 1px 2px oklch(0 0 0 / 5%);
	margin-inline: auto;
	max-width: 46rem;
	padding: 1.25rem;
}
@media (min-width: 768px) {
	.brain-paper {
		padding: 3rem;
	}
}
@media (max-width: 639px) {
	.brain-paper {
		border-inline-width: 0;
		border-radius: 0;
	}
}
```

- [ ] **Step 2: La hoja, los datos y el panel de detalles**

`components/brain/paper.tsx`:

```tsx
import { cn } from "cn";
import type { ReactNode } from "react";

// Hoja de papel del brain (spec 18.2 §6). La usan la lectura y la edición.
export function Paper({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("brain-paper", className)}>{children}</div>;
}
```

`components/brain/page-facts.tsx` (mueve a un componente lo que hoy está en el `<aside>` de `p/[...slug]/page.tsx`: estado, categoría, revisión, fecha, slug, tags y conexiones):

```tsx
import Link from "next/link";
import { ConnectionsPanel } from "@/components/brain/connections-panel";
import type { OutgoingLink } from "@/lib/brain/core/links";
import type { BrainPage } from "@/lib/brain/core/types";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export function PageFacts({
	tenantSlug,
	page,
	outgoing,
	incoming,
	titleFor,
}: {
	tenantSlug: string;
	page: BrainPage;
	outgoing: OutgoingLink[];
	incoming: string[];
	titleFor: (slug: string) => string;
}) {
	return (
		<div className="space-y-6">
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
				<dt className="text-muted-foreground">Estado</dt>
				<dd>{STATUS_LABEL[page.status]}</dd>
				<dt className="text-muted-foreground">Categoría</dt>
				<dd className="capitalize">{page.category}</dd>
				<dt className="text-muted-foreground">Revisión</dt>
				<dd>{page.revision}</dd>
				<dt className="text-muted-foreground">Editada</dt>
				<dd>{new Date(page.updatedAt).toLocaleDateString("es-AR")}</dd>
				<dt className="text-muted-foreground">Slug</dt>
				<dd className="break-all">
					<code>{page.slug}</code>
				</dd>
			</dl>
			{page.tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{page.tags.map((tag) => (
						<Link
							key={tag}
							href={`/${tenantSlug}/brain?tag=${encodeURIComponent(tag)}`}
							className="rounded-full border px-2 py-0.5 text-xs"
						>
							{tag}
						</Link>
					))}
				</div>
			)}
			<ConnectionsPanel
				tenantSlug={tenantSlug}
				outgoing={outgoing}
				incoming={incoming}
				titleFor={titleFor}
			/>
		</div>
	);
}
```

`components/brain/details-sheet.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";

// Panel lateral con los datos de la página (spec 18.2 §4). Lo usan la lectura
// (solo datos) y el espacio de trabajo (datos y metadatos editables).
export function DetailsSheet({
	children,
	title = "Detalles",
}: {
	children: ReactNode;
	title?: string;
}) {
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button variant="outline" className="min-h-11 lg:min-h-0">
					Detalles
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="w-[90vw] overflow-y-auto p-4">
				<SheetHeader className="p-0">
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="sr-only">
						Datos de la página y sus conexiones.
					</SheetDescription>
				</SheetHeader>
				{children}
			</SheetContent>
		</Sheet>
	);
}
```

- [ ] **Step 3: La vista de lectura**

`components/brain/reading-view.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { BrainMarkdown, type PageLookup } from "@/components/brain/markdown";
import { DetailsSheet } from "@/components/brain/details-sheet";
import { PageFacts } from "@/components/brain/page-facts";
import { Paper } from "@/components/brain/paper";
import type { OutgoingLink } from "@/lib/brain/core/links";
import type { BrainPage } from "@/lib/brain/core/types";

// Vista de lectura (spec 18.2 §6): título y cuerpo sobre la hoja; los datos van
// en el panel "Detalles". `actions` son los botones que decide la ruta.
export function ReadingView({
	tenantSlug,
	page,
	lookup,
	outgoing,
	incoming,
	actions,
}: {
	tenantSlug: string;
	page: BrainPage;
	lookup: PageLookup;
	outgoing: OutgoingLink[];
	incoming: string[];
	actions?: ReactNode;
}) {
	const titleFor = (slug: string) => lookup.get(slug)?.title ?? slug;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href={`/${tenantSlug}/brain`}
					className="mr-auto text-muted-foreground text-sm"
				>
					← Brain · <span className="capitalize">{page.category}</span>
				</Link>
				{actions}
				<DetailsSheet>
					<PageFacts
						tenantSlug={tenantSlug}
						page={page}
						outgoing={outgoing}
						incoming={incoming}
						titleFor={titleFor}
					/>
				</DetailsSheet>
			</div>
			<article>
				<Paper>
					<h1 className="mb-6 text-3xl leading-tight">{page.title}</h1>
					<BrainMarkdown body={page.body} tenantSlug={tenantSlug} pages={lookup} />
				</Paper>
			</article>
		</div>
	);
}
```

- [ ] **Step 4: Usarla en la ruta de la página**

En `app/[tenant]/brain/p/[...slug]/page.tsx`: conservar el bloque que arma `page`, `suggestions` (página inexistente), `index`, `lookup` y `titleFor`; reemplazar el `return` final (el `grid` con `article` y `aside`) por:

```tsx
	return (
		<ReadingView
			tenantSlug={tenantSlug}
			page={page}
			lookup={lookup}
			outgoing={index.outgoing.get(slug) ?? []}
			incoming={index.incoming.get(slug) ?? []}
			actions={
				<>
					<Button asChild variant="outline">
						<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
					</Button>
					{ctx.access(slug) === "administrador" && (
						<DeletePageButton tenantSlug={tenantSlug} slug={slug} title={page.title} />
					)}
					{atLeast(ctx.access(slug), "editor") && (
						<Button asChild>
							<Link href={editHref(tenantSlug, slug)}>Editar</Link>
						</Button>
					)}
				</>
			}
		/>
	);
```

con los imports que falten (`ReadingView`, `Button`, `Link`, `DeletePageButton`, `atLeast`, `editHref`, `historyHref`) y sin los que queden sin uso (`ConnectionsPanel`, `BrainMarkdown`, `STATUS_LABEL`, etc.). Los botones se quedan como están: la Tarea 6 los reordena.

- [ ] **Step 5: Tipos, lint y suite**

```bash
npm run typecheck && npx vitest run tests/brain
npx biome check --write app/globals.css components/brain/paper.tsx components/brain/page-facts.tsx components/brain/details-sheet.tsx components/brain/reading-view.tsx "app/[tenant]/brain/p/[...slug]/page.tsx"
```
Expected: todo en verde. Si Biome reformatea código ajeno al cambio dentro de `globals.css`, revertir ese hunk.

- [ ] **Step 6: Verificar en el navegador (si el entorno lo permite)**

Si el worktree no tiene `.env.local` ni login sembrado, **no intentarlo**: dejar escrito exactamente qué no se verificó. Con entorno: abrir una página como lector y comprobar la hoja blanca centrada de unos 720 px con borde sutil (también con el tema oscuro del sistema), "Detalles" abre el panel con los datos y las conexiones, y a 375 px la hoja ocupa todo el ancho sin scroll horizontal.

- [ ] **Step 7: Commitear**

```bash
git add app/globals.css components/brain/paper.tsx components/brain/page-facts.tsx components/brain/details-sheet.tsx components/brain/reading-view.tsx "app/[tenant]/brain/p/[...slug]/page.tsx"
git commit -m "feat: vista de lectura del brain sobre una hoja de papel con panel de detalles

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Editor visual con barra de herramientas

**Files:**
- Create: `components/brain/editor/toolbar.tsx`
- Create: `components/brain/editor/markdown-editor.tsx`
- Modify: `app/globals.css` (estilos del contenido editable)

**Interfaces:**
- Consumes: `buildExtensions` (Tarea 1); `wikilinkQueryAt` de `lib/brain/core/editor/autocomplete.ts`; `pageHref`; `BrainStatus`.
- Produces (Tarea 5):
  - `<MarkdownEditor tenantSlug initialMarkdown value pages disabled? invalid? onChange onBaseline />` con:
    - `value: string` = el cuerpo vigente que decide el espacio de trabajo (se muestra en la vista de código),
    - `onBaseline(markdown: string): void` = la serialización del contenido tal como cargó, una vez,
    - `onChange(markdown: string): void` = la serialización (visual) o el texto (código) después de cada cambio.

- [ ] **Step 1: La barra de herramientas**

`components/brain/editor/toolbar.tsx`:

```tsx
"use client";

import type { Editor } from "@tiptap/react";
import {
	Bold,
	Code,
	FileCode,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	Link as LinkIcon,
	Link2,
	List,
	ListChecks,
	ListOrdered,
	Minus,
	Quote,
	Redo2,
	Strikethrough,
	Table as TableIcon,
	Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Barra de herramientas del editor (spec 18.2 §4). Se desplaza en horizontal
// dentro de sí misma: a 375 px no mueve la página. Si algún ícono no existe en
// la versión instalada de lucide-react, usar el más parecido.
function Tool({
	label,
	active,
	disabled,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button
			type="button"
			variant={active ? "secondary" : "ghost"}
			size="icon"
			aria-label={label}
			title={label}
			aria-pressed={active}
			disabled={disabled}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className="size-11 shrink-0 lg:size-8"
		>
			{children}
		</Button>
	);
}

function Separator() {
	return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

export function Toolbar({
	editor,
	onWikiLink,
	onToggleSource,
	source,
}: {
	editor: Editor | null;
	onWikiLink: () => void;
	onToggleSource: () => void;
	source: boolean;
}) {
	const [linkOpen, setLinkOpen] = useState(false);
	const [url, setUrl] = useState("");

	if (!editor) return <div className="h-11 lg:h-10" />;
	const off = source;
	const can = editor.can();
	const inTable = editor.isActive("table");

	function applyLink() {
		const href = url.trim();
		if (!editor) return;
		if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
		else editor.chain().focus().extendMarkRange("link").unsetLink().run();
		setLinkOpen(false);
		setUrl("");
	}

	return (
		<div
			role="toolbar"
			aria-label="Formato"
			className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1 lg:flex-nowrap"
		>
			<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
				<Tool label="Deshacer" disabled={off || !can.undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 /></Tool>
				<Tool label="Rehacer" disabled={off || !can.redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 /></Tool>
				<Separator />
				<Tool label="Título 1" disabled={off} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></Tool>
				<Tool label="Título 2" disabled={off} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></Tool>
				<Tool label="Título 3" disabled={off} active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></Tool>
				<Separator />
				<Tool label="Negrita" disabled={off} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Tool>
				<Tool label="Cursiva" disabled={off} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Tool>
				<Tool label="Tachado" disabled={off} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></Tool>
				<Tool label="Código en línea" disabled={off} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></Tool>
				<Separator />
				<Tool label="Lista con viñetas" disabled={off} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></Tool>
				<Tool label="Lista numerada" disabled={off} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></Tool>
				<Tool label="Lista de tareas" disabled={off} active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks /></Tool>
				<Tool label="Cita" disabled={off} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></Tool>
				<Tool label="Bloque de código" disabled={off} active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><FileCode /></Tool>
				<Tool label="Línea divisoria" disabled={off} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></Tool>
				<Separator />
				<Tool label="Tabla" disabled={off} active={inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon /></Tool>
				<Tool label="Link" disabled={off} active={editor.isActive("link")} onClick={() => { setUrl(editor.getAttributes("link").href ?? ""); setLinkOpen((v) => !v); }}><LinkIcon /></Tool>
				<Tool label="Link a página del brain" disabled={off} onClick={onWikiLink}><Link2 /></Tool>
			</div>
			<Button
				type="button"
				variant={source ? "secondary" : "outline"}
				aria-pressed={source}
				onClick={onToggleSource}
				className="min-h-11 shrink-0 lg:min-h-8"
			>
				Markdown
			</Button>
			{inTable && !off && (
				<div className="flex w-full flex-wrap gap-1 border-t pt-1">
					<Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Columna</Button>
					<Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>− Columna</Button>
					<Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Fila</Button>
					<Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>− Fila</Button>
					<Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>Borrar tabla</Button>
				</div>
			)}
			{linkOpen && !off && (
				<div className="flex w-full items-center gap-2 border-t pt-1">
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://… (vacío para quitar el link)"
						aria-label="Dirección del link"
						className="min-h-11 lg:min-h-8"
						onKeyDown={(e) => {
							if (e.key === "Enter") { e.preventDefault(); applyLink(); }
							if (e.key === "Escape") setLinkOpen(false);
						}}
					/>
					<Button type="button" className="min-h-11 lg:min-h-8" onClick={applyLink}>Aplicar</Button>
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 2: El editor**

`components/brain/editor/markdown-editor.tsx`:

```tsx
"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { wikilinkQueryAt } from "@/lib/brain/core/editor/autocomplete";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { BrainStatus } from "@/lib/brain/core/types";
import { buildExtensions } from "./extensions";
import { Toolbar } from "./toolbar";

const MAX_SUGGESTIONS = 8;

interface PageRef {
	slug: string;
	title: string;
	status: BrainStatus;
}

export interface MarkdownEditorProps {
	tenantSlug: string;
	// Markdown con el que se carga el editor visual.
	initialMarkdown: string;
	// Cuerpo vigente que decide el espacio de trabajo: es lo que muestra la vista de código.
	value: string;
	pages: PageRef[];
	disabled?: boolean;
	invalid?: boolean;
	// La serialización del contenido tal como cargó (una vez, al crearse el editor).
	onBaseline: (markdown: string) => void;
	// La serialización (visual) o el texto (código) después de cada cambio.
	onChange: (markdown: string) => void;
}

export function MarkdownEditor({
	tenantSlug,
	initialMarkdown,
	value,
	pages,
	disabled,
	invalid,
	onBaseline,
	onChange,
}: MarkdownEditorProps) {
	const [source, setSource] = useState(false);
	const [query, setQuery] = useState<{ query: string; from: number; to: number } | null>(null);
	const titles = useMemo(() => new Map(pages.map((p) => [p.slug, p.title])), [pages]);
	const extensions = useMemo(
		() => buildExtensions({ titleFor: (slug) => titles.get(slug), exists: (slug) => titles.has(slug) }),
		[titles],
	);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const detectQuery = useCallback((ed: NonNullable<ReturnType<typeof useEditor>>) => {
		const { $from, empty } = ed.state.selection;
		if (!empty || !$from.parent.isTextblock) return setQuery(null);
		const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
		const found = wikilinkQueryAt(before, before.length);
		if (!found) return setQuery(null);
		setQuery({ query: found.query, from: $from.pos - (before.length - found.start), to: $from.pos });
	}, []);

	const editor = useEditor({
		extensions,
		content: initialMarkdown,
		contentType: "markdown",
		immediatelyRender: false,
		editable: !disabled,
		editorProps: {
			attributes: {
				class: "brain-prose min-h-[40vh] focus:outline-none",
				"aria-label": "Contenido de la página",
				...(invalid ? { "aria-invalid": "true" } : {}),
			},
			// Cmd/Ctrl + clic en un link del brain lo abre en otra pestaña.
			handleClickOn: (_view, _pos, node, _nodePos, event) => {
				if (node.type.name === "wikiLink" && (event.metaKey || event.ctrlKey)) {
					window.open(pageHref(tenantSlug, String(node.attrs.target)), "_blank", "noopener");
					return true;
				}
				return false;
			},
		},
		onCreate: ({ editor: ed }) => onBaseline(ed.getMarkdown()),
		onUpdate: ({ editor: ed }) => {
			onChangeRef.current(ed.getMarkdown());
			detectQuery(ed);
		},
		onSelectionUpdate: ({ editor: ed }) => detectQuery(ed),
	});

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [editor, disabled]);

	const suggestions = query
		? pages
				.filter((p) => `${p.slug} ${p.title}`.toLowerCase().includes(query.query.toLowerCase()))
				.slice(0, MAX_SUGGESTIONS)
		: [];

	function insertWiki(target: string) {
		if (!editor) return;
		const range = query ?? undefined;
		const chain = editor.chain().focus();
		if (range) chain.deleteRange({ from: range.from, to: range.to });
		chain.insertContent({ type: "wikiLink", attrs: { target, anchor: null, alias: null, raw: null } }).run();
		setQuery(null);
	}

	function toggleSource() {
		if (!editor) return;
		if (!source) {
			setSource(true);
			return;
		}
		// De código a visual: se vuelve a leer lo que se escribió.
		editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
		setSource(false);
		onChangeRef.current(editor.getMarkdown());
	}

	return (
		<div className="space-y-3">
			<div className="sticky top-28 z-10">
				<Toolbar
					editor={editor}
					source={source}
					onToggleSource={toggleSource}
					onWikiLink={() => {
						editor?.chain().focus().insertContent("[[").run();
					}}
				/>
			</div>
			<div className="relative">
				{source ? (
					<Textarea
						value={value}
						rows={24}
						className="font-mono text-sm"
						aria-label="Markdown de la página"
						aria-invalid={invalid}
						disabled={disabled}
						onChange={(event) => onChange(event.target.value)}
					/>
				) : (
					<EditorContent editor={editor} />
				)}
				{!source && suggestions.length > 0 && (
					<ul className="absolute right-0 bottom-0 left-0 z-10 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground text-sm shadow-md">
						{suggestions.map((p) => (
							<li key={p.slug}>
								<button
									type="button"
									className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-muted"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => insertWiki(p.slug)}
								>
									<span>{p.title}</span>
									<span className="text-muted-foreground text-xs">{p.slug}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
```

Notas para quien implemente: el botón "Link a página" inserta `[[` para disparar el buscador (misma vía que escribir `[[` a mano). La clase `top-28` de la barra pegajosa deja la barra debajo de la cabecera del sitio (alto 3.5 rem más la fila de navegación): si en el navegador queda tapada o con hueco, ajustar el valor. `setContent(..., { emitUpdate: false })`: si la opción no existe en la versión instalada, usar `{ contentType: "markdown" }` y suprimir el evento con la bandera que traiga la API.

- [ ] **Step 3: Estilos del contenido editable**

En `app/globals.css`, debajo de las reglas de `.brain-prose` / `.brain-paper`:

```css
/* Contenido del editor visual (Tiptap): mismo aspecto que la lectura. */
.brain-prose .ProseMirror {
	outline: none;
}
.brain-prose :where(table) {
	border-collapse: collapse;
	width: 100%;
}
.brain-prose :where(th, td) {
	border: 1px solid var(--border);
	padding: 0.4em 0.6em;
	text-align: left;
	vertical-align: top;
}
.brain-prose :where(th) {
	background: var(--muted);
}
.brain-prose :where(blockquote) {
	border-left: 3px solid var(--border);
	color: var(--muted-foreground);
	padding-left: 1em;
}
.brain-prose ul[data-type="taskList"] {
	list-style: none;
	padding-left: 0.2em;
}
.brain-prose ul[data-type="taskList"] li {
	align-items: flex-start;
	display: flex;
	gap: 0.5em;
}
.brain-wikilink {
	background: color-mix(in oklab, var(--primary) 10%, transparent);
	border-radius: 4px;
	color: var(--primary);
	cursor: pointer;
	padding: 0 0.25em;
	text-decoration: underline;
	text-underline-offset: 2px;
}
.brain-wikilink[data-broken="true"] {
	background: color-mix(in oklab, var(--destructive) 10%, transparent);
	color: var(--destructive);
	text-decoration-style: dotted;
}
.ProseMirror-selectednode.brain-wikilink {
	outline: 2px solid var(--ring);
}
```

- [ ] **Step 4: Tipos, lint y suite**

```bash
npm run typecheck && npx vitest run tests/brain
npx biome check --write components/brain/editor/toolbar.tsx components/brain/editor/markdown-editor.tsx app/globals.css
```
Expected: todo en verde. Si Biome reformatea de más en `toolbar.tsx` (las líneas de `Tool` son largas), dejar que formatee solo ese archivo.

- [ ] **Step 5: Verificar en el navegador (si el entorno lo permite)**

Sin `.env.local` ni login no se puede: dejar escrito qué no se verificó (barra pegajosa y su `top-28`, que a 375 px la barra se desplaza sola, que `[[` abre el buscador y el nodo se inserta, la tabla y su menú, el interruptor "Markdown" en los dos sentidos, Cmd/Ctrl + clic en un link del brain). La Tarea 5 monta este editor en la pantalla; la verificación visual completa se hace después.

- [ ] **Step 6: Commitear**

```bash
git add components/brain/editor/toolbar.tsx components/brain/editor/markdown-editor.tsx app/globals.css
git commit -m "feat: editor visual de markdown del brain con barra de herramientas y vista de código

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Espacio de trabajo (título, detalles, guardado)

**Files:**
- Create: `components/brain/editor/page-workspace.tsx`

**Interfaces:**
- Consumes: `MarkdownEditor` (Tarea 4); `chooseBodyToSave` (Tarea 2); `saveBrainPage` (`app/[tenant]/brain/actions.ts`); `SavePageResult`; `DetailsSheet`, `Paper` (Tarea 3); `DiffView`; `diffLines`; `DeletePageButton` (18.1); `pageHref`, `historyHref`; `CANON_TAGS`, `BRAIN_STATUSES`.
- Produces (Tarea 6):
  - `interface WorkspaceInitial { slug: string; title: string; category: string; status: BrainStatus; tags: string[]; frontmatter: Record<string, unknown>; body: string; revision: number | null }`
  - `<PageWorkspace mode tenantSlug categories knownTags pages initial facts? canDelete? />` donde `facts` es el `ReactNode` ya armado en el servidor (`<PageFacts/>`), solo en modo `edit`.

- [ ] **Step 1: Escribir el espacio de trabajo**

`components/brain/editor/page-workspace.tsx` — porta a la pantalla nueva la lógica de `app/[tenant]/brain/page-form.tsx` (estado del formulario, tags, conflicto con diff, aviso de salida). Cumple la spec §4: cabecera, hoja con título y editor, panel "Detalles" con los metadatos, y barra de guardado que aparece solo con cambios.

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
	useTransition,
} from "react";
import { saveBrainPage } from "@/app/[tenant]/brain/actions";
import { DeletePageButton } from "@/components/brain/delete-page-button";
import { DetailsSheet } from "@/components/brain/details-sheet";
import { DiffView } from "@/components/brain/diff-view";
import { Paper } from "@/components/brain/paper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diffLines } from "@/lib/brain/core/diff";
import { chooseBodyToSave } from "@/lib/brain/core/editor/body-to-save";
import type { SavePageResult } from "@/lib/brain/core/editor/save";
import { historyHref, pageHref } from "@/lib/brain/core/editor/slug";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
} from "@/lib/brain/core/types";
import { MarkdownEditor } from "./markdown-editor";

export interface WorkspaceInitial {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number | null; // null en una página nueva
}

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export interface PageWorkspaceProps {
	mode: "edit" | "new";
	tenantSlug: string;
	categories: string[];
	knownTags: string[];
	pages: Array<{ slug: string; title: string; status: BrainStatus }>;
	initial: WorkspaceInitial;
	// Datos y conexiones, ya armados en el servidor (solo modo edit).
	facts?: ReactNode;
	canDelete?: boolean;
}

export function PageWorkspace({
	mode,
	tenantSlug,
	categories,
	knownTags,
	pages,
	initial,
	facts,
	canDelete,
}: PageWorkspaceProps) {
	const router = useRouter();
	// `saved` es el último estado guardado de los campos (para detectar cambios).
	const [saved, setSaved] = useState(initial);
	const [form, setForm] = useState(initial);
	const [tagsText, setTagsText] = useState(initial.tags.join(", "));
	// Cuerpo: el original cargado, lo que serializó el editor al cargarlo
	// (`baseline`) y lo último que informó (`serialized`). Spec 18.2 V6.
	const [original, setOriginal] = useState(initial.body);
	const [baseline, setBaseline] = useState<string | null>(null);
	const [serialized, setSerialized] = useState(initial.body);
	const [reason, setReason] = useState("");
	const [baseRevision, setBaseRevision] = useState(initial.revision);
	const [result, setResult] = useState<SavePageResult | null>(null);
	const [serverBody, setServerBody] = useState<string | null>(null);
	const [editorKey, setEditorKey] = useState(0);
	const [isPending, startTransition] = useTransition();

	const body = useMemo(
		() =>
			chooseBodyToSave({
				original,
				originalRoundtrip: baseline ?? original,
				serialized,
			}),
		[original, baseline, serialized],
	);
	const tags = useMemo(
		() =>
			tagsText
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		[tagsText],
	);
	const dirty =
		form.title !== saved.title ||
		form.category !== saved.category ||
		form.status !== saved.status ||
		form.slug !== saved.slug ||
		tags.join(",") !== saved.tags.join(",") ||
		body !== original;

	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const fieldError = (field: string) =>
		result &&
		!result.ok &&
		result.code === "validation" &&
		result.fields.some((f) => f === field || f.startsWith(`${field}.`));

	function submit(event: FormEvent) {
		event.preventDefault();
		startTransition(async () => {
			const outcome = await saveBrainPage({
				tenantSlug,
				slug: form.slug,
				title: form.title,
				category: form.category,
				status: form.status,
				tags,
				frontmatter: form.frontmatter,
				body,
				reason,
				baseRevision,
			});
			setResult(outcome);
			if (outcome.ok) {
				if (mode === "new") {
					router.replace(pageHref(tenantSlug, outcome.slug));
					return;
				}
				// Sigue en edición sobre la revisión nueva. Si el cuerpo cambió, el
				// nuevo original es lo guardado y el editor ya lo serializa igual; si
				// no cambió (solo metadatos), el original y la línea de base quedan.
				if (body !== original) {
					setBaseline(body);
					setSerialized(body);
				}
				setOriginal(body);
				setSaved({ ...form, tags, body, revision: outcome.revision });
				setBaseRevision(outcome.revision);
				setReason("");
				setResult(null);
				setServerBody(null);
				router.refresh();
				return;
			}
			if (outcome.code === "conflict" && outcome.currentRevision !== null) {
				// Se trae la vigente para mostrar el diff; el texto de la persona queda.
				const response = await fetch(`/${tenantSlug}/brain/raw/${form.slug}`, {
					cache: "no-store",
				});
				setServerBody(response.ok ? await response.text() : null);
			}
		});
	}

	function discard() {
		setForm(saved);
		setTagsText(saved.tags.join(", "));
		setReason("");
		setResult(null);
		setServerBody(null);
		// Remonta el editor: vuelve a cargar el cuerpo original y avisa su línea de base.
		setEditorKey((key) => key + 1);
	}

	const detailsFields = (
		<div className="space-y-4 text-sm">
			<label className="block space-y-1">
				<span>Categoría</span>
				<select
					className="h-11 w-full rounded-md border bg-background px-3 lg:h-9"
					value={form.category}
					aria-invalid={!!fieldError("category")}
					onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
				>
					{categories.map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
			</label>
			<label className="block space-y-1">
				<span>Estado</span>
				<select
					className="h-11 w-full rounded-md border bg-background px-3 lg:h-9"
					value={form.status}
					onChange={(e) =>
						setForm((f) => ({ ...f, status: e.target.value as BrainStatus }))
					}
				>
					{BRAIN_STATUSES.map((s) => (
						<option key={s} value={s}>
							{STATUS_LABEL[s]}
						</option>
					))}
				</select>
			</label>
			<label className="block space-y-1">
				<span>Tags, separados por coma</span>
				<Input
					value={tagsText}
					list="brain-tags"
					className="min-h-11 lg:min-h-9"
					aria-invalid={!!fieldError("tags")}
					onChange={(e) => setTagsText(e.target.value)}
				/>
				<datalist id="brain-tags">
					{[...new Set([...CANON_TAGS, ...knownTags])].map((tag) => (
						<option key={tag} value={tag} />
					))}
				</datalist>
			</label>
			{mode === "edit" && (
				<>
					<p className="text-muted-foreground">
						Slug: <code className="break-all">{form.slug}</code>
					</p>
					{facts}
					{canDelete && (
						<DeletePageButton
							tenantSlug={tenantSlug}
							slug={form.slug}
							title={form.title}
						/>
					)}
				</>
			)}
		</div>
	);

	return (
		<form onSubmit={submit} className="space-y-4 pb-48">
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href={`/${tenantSlug}/brain`}
					className="mr-auto text-muted-foreground text-sm"
				>
					← Brain · <span className="capitalize">{form.category}</span>
				</Link>
				{mode === "edit" && (
					<Button asChild variant="outline" className="min-h-11 lg:min-h-0">
						<Link href={historyHref(tenantSlug, form.slug)}>Historial</Link>
					</Button>
				)}
				<DetailsSheet title={mode === "edit" ? "Detalles" : "Datos de la página"}>
					{detailsFields}
				</DetailsSheet>
			</div>

			<Paper>
				{mode === "new" && (
					<label className="mb-4 block space-y-1 text-sm">
						<span>Slug</span>
						<Input
							value={form.slug}
							aria-invalid={!!fieldError("slug")}
							className="min-h-11 lg:min-h-9"
							placeholder="comercial/nueva-pagina"
							onChange={(e) =>
								setForm((f) => ({
									...f,
									slug: e.target.value.trim().toLowerCase(),
								}))
							}
						/>
					</label>
				)}
				<input
					value={form.title}
					aria-label="Título"
					aria-invalid={!!fieldError("title")}
					placeholder="Título"
					className="mb-6 w-full bg-transparent font-semibold text-3xl leading-tight outline-none placeholder:text-muted-foreground aria-invalid:text-destructive"
					onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
				/>
				<MarkdownEditor
					key={editorKey}
					tenantSlug={tenantSlug}
					initialMarkdown={original}
					value={body}
					pages={pages}
					invalid={!!fieldError("body")}
					onBaseline={(markdown) => {
						setBaseline(markdown);
						setSerialized(markdown);
					}}
					onChange={setSerialized}
				/>
			</Paper>

			{(dirty || (result && !result.ok)) && (
				<div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
					<div className="mx-auto max-w-3xl space-y-2 p-3">
						{result && !result.ok && (
							<div
								role="alert"
								className="max-h-[50vh] overflow-y-auto rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm"
							>
								<p className="font-medium">{result.message}</p>
								{/* mode !== "new": reintentar una creación no tiene una revisión
								    propia contra la cual apoyarse; save.ts ya fuerza
								    currentRevision a null en ese caso, esto es una segunda
								    barrera contra pisar otra página. */}
								{mode !== "new" &&
									result.code === "conflict" &&
									result.currentRevision !== null && (
										<div className="mt-2 space-y-2">
											<p>
												Tu texto sigue acá. Mirá qué cambió y, si querés
												guardar igual, reintentá sobre la revisión{" "}
												{result.currentRevision}.
											</p>
											{serverBody !== null && (
												<details open>
													<summary className="cursor-pointer">
														Diferencias entre la vigente y tu versión
													</summary>
													<div className="mt-2">
														<DiffView blocks={diffLines(serverBody, body)} />
													</div>
												</details>
											)}
											<Button
												type="button"
												variant="outline"
												className="min-h-11"
												onClick={() => {
													setBaseRevision(result.currentRevision);
													setResult(null);
												}}
											>
												Reintentar sobre la revisión {result.currentRevision}
											</Button>
										</div>
									)}
							</div>
						)}
						<div className="flex flex-wrap items-center gap-2">
							<Input
								value={reason}
								aria-label="Motivo del cambio"
								placeholder="Motivo (opcional): qué cambiaste"
								className="min-h-11 min-w-0 flex-1 lg:min-h-9"
								onChange={(e) => setReason(e.target.value)}
							/>
							<Button
								type="button"
								variant="ghost"
								className="min-h-11"
								onClick={discard}
							>
								Descartar
							</Button>
							<Button type="submit" className="min-h-11" disabled={isPending}>
								{isPending ? "Guardando…" : "Guardar"}
							</Button>
						</div>
					</div>
				</div>
			)}
		</form>
	);
}
```

Notas para quien implemente: el aviso `Reintentar` debe re-evaluar `result` dentro del `onClick` solo mientras el narrowing de TypeScript lo permita (si no, guardar `result.currentRevision` en una constante antes del JSX). Si `Button` no acepta `asChild` con `className`, ajustar a como lo usa `app/[tenant]/brain/p/[...slug]/page.tsx`. Las clases `h-11 lg:h-9` y `min-h-11 lg:min-h-9` mantienen 44 px en mobile y la altura de siempre en escritorio.

- [ ] **Step 2: Tipos, lint y suite**

```bash
npm run typecheck && npx vitest run tests/brain
npx biome check --write components/brain/editor/page-workspace.tsx
```
Expected: todo en verde.

- [ ] **Step 3: Verificar en el navegador (si el entorno lo permite)**

Sin `.env.local` ni login no se puede: dejar escrito qué no se verificó. Con entorno: la barra de guardado aparece solo con cambios; guardar sin motivo registra "Edición desde la web" en el historial; abrir una página escrita por el agente, cambiar solo un tag y guardar deja el cuerpo idéntico (ver la revisión en el historial); un conflicto (guardar la misma página desde dos pestañas) muestra el diff y "Reintentar sobre la revisión N"; "Descartar" vuelve al contenido guardado; título vacío muestra el error en el campo sin perder lo escrito; a 375 px la barra de guardado no tapa el contenido ni mueve la página.

- [ ] **Step 4: Commitear**

```bash
git add components/brain/editor/page-workspace.tsx
git commit -m "feat: espacio de trabajo del brain con título, panel de detalles y barra de guardado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rutas — entrar en edición, redirigir y retirar el formulario

**Files:**
- Modify: `app/[tenant]/brain/p/[...slug]/page.tsx`
- Modify: `app/[tenant]/brain/editar/[...slug]/page.tsx` (redirige)
- Modify: `app/[tenant]/brain/nueva/page.tsx` (usa el espacio de trabajo)
- Delete: `app/[tenant]/brain/page-form.tsx`
- Modify: `components/brain/tree-row-menu.tsx` (sin "Editar")
- Modify: `lib/brain/core/editor/slug.ts` y `tests/brain/editor-slug.test.ts` (se retira `editHref`)

**Interfaces:**
- Consumes: `entryMode` (Tarea 2); `PageWorkspace`, `WorkspaceInitial` (Tarea 5); `ReadingView`, `PageFacts` (Tarea 3); `loadBrainPages`, `loadBrainTree`, `loadEditorContext`; `editableFolders`, `resolveNewPagePrefix`.
- Produces: el comportamiento de la spec §3.

- [ ] **Step 1: `/brain/p/<slug>` decide entre lectura y edición**

En `app/[tenant]/brain/p/[...slug]/page.tsx`, después de resolver `page` (y de la rama de "no existe la página" con sugerencias, que no cambia), reemplazar el `return` final por:

```tsx
	const level = ctx.access(slug);
	const outgoing = index.outgoing.get(slug) ?? [];
	const incoming = index.incoming.get(slug) ?? [];

	if (entryMode(level) === "edit") {
		return (
			<PageWorkspace
				mode="edit"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug: s, title, status }) => ({ slug: s, title, status }))}
				initial={{
					slug: page.slug,
					title: page.title,
					category: page.category,
					status: page.status,
					tags: page.tags,
					frontmatter: page.frontmatter,
					body: page.body,
					revision: page.revision,
				}}
				canDelete={level === "administrador"}
				facts={
					<PageFacts
						tenantSlug={tenantSlug}
						page={page}
						outgoing={outgoing}
						incoming={incoming}
						titleFor={titleFor}
					/>
				}
			/>
		);
	}

	return (
		<ReadingView
			tenantSlug={tenantSlug}
			page={page}
			lookup={lookup}
			outgoing={outgoing}
			incoming={incoming}
			actions={
				<Button asChild variant="outline">
					<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
				</Button>
			}
		/>
	);
```

con los imports (`entryMode`, `PageWorkspace`, `PageFacts`, `ReadingView`, `Button`, `Link`, `historyHref`) y sin los que queden sin uso (`atLeast`, `editHref`, `DeletePageButton`). El botón "Borrar página" ya no está en la cabecera: vive en el panel "Detalles" del espacio de trabajo.

- [ ] **Step 2: `/brain/editar/<slug>` redirige**

Reemplazar el contenido de `app/[tenant]/brain/editar/[...slug]/page.tsx` por:

```tsx
import { notFound, permanentRedirect } from "next/navigation";
import { pageHref, slugFromParams } from "@/lib/brain/core/editor/slug";

// La página ya abre en modo edición para quien puede editar (spec 18.2 V1): los
// links viejos a /editar siguen andando.
export default async function EditRedirect({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant, slug: segments } = await params;
	const slug = slugFromParams(segments);
	if (!slug) notFound();
	permanentRedirect(pageHref(tenant, slug));
}
```

- [ ] **Step 3: `/brain/nueva` usa el espacio de trabajo**

En `app/[tenant]/brain/nueva/page.tsx`: cambiar `PageForm` por `PageWorkspace` (`mode="new"`, mismas props: `tenantSlug`, `categories`, `knownTags`, `pages`, `initial` con `revision: null`), quitar el `<h1>` "Nueva página" duplicado si el espacio de trabajo ya muestra su cabecera, conservar el texto "Podés crear páginas en: …" y la lógica de `?en=` y de carpetas editables, y ajustar el import a `@/components/brain/editor/page-workspace`.

- [ ] **Step 4: Retirar el formulario viejo y el botón "Editar"**

- Borrar `app/[tenant]/brain/page-form.tsx` (`git rm`). Confirmar con `grep -rn "page-form\|PageForm" app components lib tests` que no queda ninguna referencia.
- En `components/brain/tree-row-menu.tsx`: quitar el ítem "Editar" (la página ya abre en edición) y el import de `editHref`; el resto del menú no cambia.
- En `lib/brain/core/editor/slug.ts`: borrar `editHref`; en `tests/brain/editor-slug.test.ts` quitar su assertion y el import.

- [ ] **Step 5: Tipos, tests y lint**

```bash
npm run typecheck && npm test
npx biome check --write "app/[tenant]/brain/p/[...slug]/page.tsx" "app/[tenant]/brain/editar/[...slug]/page.tsx" "app/[tenant]/brain/nueva/page.tsx" components/brain/tree-row-menu.tsx lib/brain/core/editor/slug.ts tests/brain/editor-slug.test.ts
```
Expected: todo en verde.

- [ ] **Step 6: Verificar en el navegador (si el entorno lo permite)**

Sin `.env.local` ni login no se puede: dejar escrito qué no se verificó. Con entorno: un editor abre una página y está en edición; un lector la ve sin controles de edición; `/brain/editar/<slug>` redirige; `/brain/nueva` y `?en=` funcionan; el árbol y el menú ya no ofrecen "Editar"; el borrado desde "Detalles" sigue andando.

- [ ] **Step 7: Commitear**

```bash
git add -A app components lib tests
git commit -m "feat: el brain abre en edición para quien puede editar y retira el formulario viejo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cierre — documentación y verificación final

**Files:**
- Modify: `lib/brain/README.md` (sección "Editor visual")
- Modify: `docs/01-roadmap-etapas.md` (18.2 tildada)
- Modify: `docs/superpowers/specs/2026-09-27-editor-brain-design.md` (nota de que `/editar` redirige y el motivo es opcional)

- [ ] **Step 1: Documentar**

1. `lib/brain/README.md`: sección **"Editor visual"** — la página abre en edición para `editor` o más (`entryMode`); el editor es Tiptap (`components/brain/editor/`) y vive fuera de `core`; el markdown es la fuente de verdad y `chooseBodyToSave` evita reescribir el cuerpo si no hubo cambios; el nodo `WikiLink` conserva el texto original de los links; el HTML crudo no se interpreta; el motivo es opcional desde la web (`DEFAULT_WEB_REASON`) y obligatorio para el agente y el MCP; `/editar` redirige; la prueba `tests/brain/editor-roundtrip.test.ts` y cómo correrla con páginas reales (`tests/fixtures/brain-real/`, ignorada por git). Verificar cada afirmación contra el código antes de escribirla.
2. `docs/01-roadmap-etapas.md`: tildar `18.2 · Editor visual y vista de papel` con una línea que nombre este plan y deje escrito que **no hay migración** (se despliega solo el código), qué quedó sin verificar en navegador (lista honesta de lo que no se pudo ver) y el resultado de la prueba de ida y vuelta (qué normalizaciones se aceptaron).
3. `docs/superpowers/specs/2026-09-27-editor-brain-design.md`: una nota al final del §5 (o donde se describe la edición) que diga que la 18.2 reemplaza la pantalla `/editar` y la regla del motivo obligatorio, con enlace a la spec de la 18.2.

- [ ] **Step 2: Verificación completa**

```bash
npm run typecheck
npm test
grep -rn "page-form\|PageForm\|editHref" app components lib tests || true
```
Expected: typecheck limpio; todos los tests en verde (incluidos los de ida y vuelta); el `grep` no imprime nada. Correr también `npx next build` **solo si** el entorno lo permite (necesita variables de entorno): si no, dejar escrito que no se corrió y por qué.

- [ ] **Step 3: Criterio de cierre de la spec (§1) en el navegador**

Si no hay entorno local con login, anotar en el reporte que **no se corrió** y que lo hace una persona en producción después del despliegue: los seis puntos del criterio de cierre de la spec §1 (editar en el lugar y guardar sin motivo; formato, tabla y link a página con el markdown esperado; abrir una página del agente, cambiar solo una etiqueta y verificar que el cuerpo de la revisión nueva es idéntico; hoja de lectura para un lector; escritorio y 375 px).

- [ ] **Step 4: Commitear**

```bash
git add lib/brain/README.md docs/01-roadmap-etapas.md docs/superpowers/specs/2026-09-27-editor-brain-design.md
git commit -m "docs: cierre de la entrega 18.2, editor visual y vista de papel del brain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Cobertura de la spec (§2 a §8):** V1 (entrada por permiso) → Tareas 2 y 6. V2 (guardado explícito) → Tarea 5. V3 (motivo opcional) → Tarea 2. V4 (Tiptap) → Tareas 1 y 4. V5/V6 (markdown fuente de verdad, cuerpo original si no se tocó) → Tareas 2 y 5. V7 (ida y vuelta primero, compuerta) → Tarea 1. V8 (interruptor Markdown) → Tarea 4. V9 (nodo de link) → Tarea 1. V10 (sin HTML crudo) → Tarea 1. V11 (hoja blanca en los dos temas) → Tarea 3. V12 (metadatos en "Detalles") → Tareas 3 y 5. V13 (Tiptap fuera de `core`) → Tareas 1 a 5. §3 (entrada) → Tarea 6. §4 (espacio de trabajo, link a página, vista de código) → Tareas 4 y 5. §5 (ida y vuelta) → Tarea 1. §6 (papel) → Tarea 3. §7 (guardado y motivo) → Tarea 2. §8 (pruebas) → Tareas 1, 2 y las verificaciones manuales.

**Escaneo de marcadores sin completar:** ninguno; cada paso trae el código o el comando. Los puntos donde la API instalada de Tiptap puede obligar a un ajuste menor (nombres de `markdownTokenizer`/`parseMarkdown`, exports de las extensiones de tabla, opciones de `setContent`, nombres de íconos de lucide) lo dicen en el paso.

**Consistencia de tipos:** `EditorLookups` / `buildExtensions` / `WikiLink` (Tarea 1) los usan la prueba y `MarkdownEditor` (Tarea 4); `chooseBodyToSave` y `entryMode` (Tarea 2) los usan el espacio de trabajo (Tarea 5) y la ruta (Tarea 6); `MarkdownEditorProps` (Tarea 4) coincide con lo que consume el espacio de trabajo (`initialMarkdown`, `value`, `onBaseline`, `onChange`); `WorkspaceInitial` (Tarea 5) coincide con el `initial` que arma la ruta (Tarea 6); `PageFacts`, `Paper`, `DetailsSheet`, `ReadingView` (Tarea 3) los usan las Tareas 5 y 6.
