# Etapa 21.3a: el brain como fuente del ICP, los hooks y los vectores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el scoring lea los niveles del ICP del brain, que `config_values` de hooks y vectores sea un reflejo automático de las páginas `canon:hooks`, y que la consola exija el brain para habilitar el outreach.

**Architecture:** Un parser puro lee bloques ` ```icp `, ` ```hooks ` y ` ```vectores ` de las páginas de canon (mismo formato de líneas que ` ```gate `). `outreach/icp-score` recibe el ICP por una dependencia que lee el brain. Un envoltorio sobre `getBrainProvider` dispara el reflejo después de guardar una página `canon:hooks`; el reflejo llama una función SQL que da de alta, cambia rótulos y desactiva en una transacción.

**Tech Stack:** Next.js (App Router, server actions), TypeScript, zod, vitest, Supabase Postgres con pgTAP, biome.

**Spec:** `docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md` (§3, y de §5 solo `outreach_reflect_marco`). El plan 21.3b cubre §4, el resto de §5 y §6.

## Global Constraints

- Rama `feat/etapa-21-3-config-outreach`. Identidad de git local `innovasbuild` / `matias@innov.as`. Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. `events` es append-only: nunca UPDATE ni DELETE.
- Nada específico de un tenant en código: las plantillas y los tests no nombran a `innovas` ni sus hooks.
- Español rioplatense en textos para personas; código e identificadores en inglés.
- Solo cuentan las páginas con `status === "activo"` para los bloques (spec O8).
- Un valor de `config_values` nunca se borra, se desactiva (spec O7).
- Un reflejo que falla nunca hace fallar el guardado de la página (spec O5).
- `lib/brain/core` no importa nada de `lib/outreach`.
- Ningún nodo escribe `canon:*`: las páginas por defecto las crea la acción de un `platform_admin`.
- Después de cada tarea: `npm run typecheck` y `npm test -- <archivo>`. `npm run lint:fix` reformatea siempre los mismos cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Los comandos de base (`npm run db:test`, `npm run db:types`) necesitan Docker abierto.

## Review Focus

1. Una página `canon:hooks` en borrador con la plantilla sin completar: no tiene que reflejar nada ni desactivar los hooks vigentes (Task 2 y Task 5).
2. El mismo identificador de hook en dos páginas distintas: error que nombra las dos páginas, y no se refleja nada (Task 1).
3. Un rótulo que contiene `:` o `=>` (por ejemplo "Dolor: perdió una licitación"): el identificador es lo que está antes del primer `:` y el rótulo conserva el resto (Task 1).
4. El brain no responde mientras alguien guarda una página: la página se guarda igual y la lista vigente no cambia (Task 5).
5. `createBrain` sobre una empresa que ya tiene `comercial/icp` escrita por una persona: no la pisa (Task 6).

---

### Task 1: Parser de bloques de canon

**Files:**
- Create: `lib/outreach/canon-blocks.ts`
- Test: `tests/outreach/canon-blocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface BlockPage { slug: string; body: string }
  interface IcpLevels { encaje_empresa: string[]; rol_decisor: string[]; excluir: string }
  interface ListValue { value: string; label: string }
  interface VectorValue extends ListValue { default_hook: string | null }
  interface Marco { hooks: ListValue[]; vectores: VectorValue[] }
  parseIcpBlocks(pages: BlockPage[]): { icp: IcpLevels | null; blocks: number; errors: string[] }
  parseMarcoBlocks(pages: BlockPage[]): { hooks: ListValue[]; vectores: VectorValue[]; blocks: number; errors: string[] }
  icpRevision(icp: IcpLevels): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/canon-blocks.test.ts
import { describe, expect, it } from "vitest";
import {
	icpRevision,
	parseIcpBlocks,
	parseMarcoBlocks,
} from "@/lib/outreach/canon-blocks";

const ICP = [
	"# ICP",
	"",
	"Prosa que no cuenta. encaje: esto no es un nivel",
	"",
	"```icp",
	"# comentario",
	"encaje: No es del universo: rubro ajeno o tamaño fuera de rango",
	"encaje: Encaja bien: tamaño y rubro del perfil buscado   # alta 2026-10-10",
	"rol: Sin relación con esta decisión de compra",
	"rol: Decide: tiene control sobre el presupuesto",
	"excluir: La empresa es competidora, cliente o proveedora",
	"```",
].join("\n");

const icpPage = (body = ICP, slug = "comercial/icp") => ({ slug, body });

describe("parseIcpBlocks", () => {
	it("lee los niveles en orden y conserva los dos puntos del texto", () => {
		expect(parseIcpBlocks([icpPage()])).toEqual({
			icp: {
				encaje_empresa: [
					"No es del universo: rubro ajeno o tamaño fuera de rango",
					"Encaja bien: tamaño y rubro del perfil buscado",
				],
				rol_decisor: [
					"Sin relación con esta decisión de compra",
					"Decide: tiene control sobre el presupuesto",
				],
				excluir: "La empresa es competidora, cliente o proveedora",
			},
			blocks: 1,
			errors: [],
		});
	});

	it("sin bloque no hay ICP ni errores", () => {
		expect(parseIcpBlocks([icpPage("# ICP\n\nsolo prosa")])).toEqual({
			icp: null,
			blocks: 0,
			errors: [],
		});
	});

	it("dos bloques es un error que nombra las páginas", () => {
		const result = parseIcpBlocks([icpPage(), icpPage(ICP, "comercial/icp-viejo")]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"hay más de un bloque icp: comercial/icp, comercial/icp-viejo. Dejá uno solo.",
		]);
	});

	it("un bloque solo con comentarios (la plantilla) no es un ICP", () => {
		const result = parseIcpBlocks([
			icpPage("```icp\n# encaje: completar\n```"),
		]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"comercial/icp: el bloque icp necesita entre 2 y 10 líneas encaje (tiene 0)",
			"comercial/icp: el bloque icp necesita entre 2 y 10 líneas rol (tiene 0)",
			"comercial/icp: el bloque icp necesita exactamente una línea excluir (tiene 0)",
		]);
	});

	it("nivel corto, directiva desconocida y dos excluir: cada uno con página y línea", () => {
		const body = [
			"```icp",
			"encaje: corto",
			"encaje: Encaja bien: tamaño y rubro del perfil buscado",
			"rol: Sin relación con esta decisión de compra",
			"rol: Decide: tiene control sobre el presupuesto",
			"excluir: La empresa es competidora, cliente o proveedora",
			"excluir: La empresa cerró o está en concurso",
			"umbral: 2",
			"```",
		].join("\n");
		const result = parseIcpBlocks([icpPage(body)]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"comercial/icp, línea 2: el nivel tiene que tener entre 10 y 400 caracteres",
			'comercial/icp, línea 8: directiva no reconocida: "umbral: 2"',
			"comercial/icp: el bloque icp necesita exactamente una línea excluir (tiene 2)",
		]);
	});
});

describe("parseMarcoBlocks", () => {
	const hooks = (slug: string, lines: string[]) => ({
		slug,
		body: ["```hooks", ...lines, "```"].join("\n"),
	});
	const vectores = (slug: string, lines: string[]) => ({
		slug,
		body: ["texto", "", "```vectores", ...lines, "```"].join("\n"),
	});

	it("suma bloques de varias páginas y lee el hook por defecto", () => {
		expect(
			parseMarcoBlocks([
				hooks("comercial/hooks", ["h_uno: Hook uno", "h_dos: Dolor: perdió algo"]),
				vectores("comercial/vectores", [
					"v_uno: Vector uno => h_dos",
					"v_dos: Sin hook por defecto",
				]),
			]),
		).toEqual({
			hooks: [
				{ value: "h_uno", label: "Hook uno" },
				{ value: "h_dos", label: "Dolor: perdió algo" },
			],
			vectores: [
				{ value: "v_uno", label: "Vector uno", default_hook: "h_dos" },
				{ value: "v_dos", label: "Sin hook por defecto", default_hook: null },
			],
			blocks: 2,
			errors: [],
		});
	});

	it("sin bloques no hay listas ni errores", () => {
		expect(parseMarcoBlocks([{ slug: "p", body: "prosa" }])).toEqual({
			hooks: [],
			vectores: [],
			blocks: 0,
			errors: [],
		});
	});

	it("el mismo hook en dos páginas es un error que nombra las dos", () => {
		const result = parseMarcoBlocks([
			hooks("a", ["h_uno: Uno"]),
			hooks("b", ["h_uno: Otra vez"]),
			vectores("a2", ["v_uno: Vector"]),
		]);
		expect(result.errors).toEqual([
			'b, línea 2: el hook "h_uno" ya está en a, línea 2',
		]);
	});

	it("identificador inválido, hook por defecto inexistente y clase vacía", () => {
		expect(
			parseMarcoBlocks([
				hooks("a", ["H Uno: Mayúsculas y espacio"]),
				vectores("a2", ["v_uno: Vector => h_no_existe"]),
			]).errors,
		).toEqual([
			'a, línea 2: identificador inválido: "H Uno" (minúsculas, dígitos y guion bajo)',
			'a2, línea 4: el vector "v_uno" apunta al hook "h_no_existe", que no está en ningún bloque hooks',
			"faltan hooks: tiene que haber al menos uno en un bloque hooks",
		]);
	});

	it("solo hooks, sin vectores, es un error", () => {
		expect(parseMarcoBlocks([hooks("a", ["h_uno: Uno"])]).errors).toEqual([
			"faltan vectores: tiene que haber al menos uno en un bloque vectores",
		]);
	});
});

describe("icpRevision", () => {
	const base = parseIcpBlocks([icpPage()]).icp;
	if (!base) throw new Error("fixture inválido");

	it("es estable ante espacios y cambia con un nivel", () => {
		const spaced = parseIcpBlocks([
			icpPage(ICP.replace("rol: Sin relación", "rol:    Sin   relación")),
		]).icp;
		const changed = {
			...base,
			excluir: "La empresa es competidora, cliente, proveedora o está en concurso",
		};
		expect(icpRevision(base)).toMatch(/^[0-9a-f]{16}$/);
		expect(spaced && icpRevision(spaced)).toBe(icpRevision(base));
		expect(icpRevision(changed)).not.toBe(icpRevision(base));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/outreach/canon-blocks.test.ts`
Expected: FAIL, no resuelve `@/lib/outreach/canon-blocks`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/outreach/canon-blocks.ts
// Bloques de canon que el outreach lee del brain (spec 21.3 §3.1 y §3.2):
// ```icp en la página canon:icp, ```hooks y ```vectores en las canon:hooks.
// Mismo formato de líneas que ```gate (gate-blocks.ts). Puro: no tira.
import { createHash } from "node:crypto";

export interface BlockPage {
	slug: string;
	body: string;
}

export interface IcpLevels {
	encaje_empresa: string[];
	rol_decisor: string[];
	excluir: string;
}

export interface ListValue {
	value: string;
	label: string;
}

export interface VectorValue extends ListValue {
	default_hook: string | null;
}

export interface Marco {
	hooks: ListValue[];
	vectores: VectorValue[];
}

// Mismo criterio que el check de config_values.value.
const VALUE = /^[a-z0-9][a-z0-9_]{0,60}$/;

interface Entry {
	key: string;
	value: string;
	raw: string;
	/** "pagina, línea N", para mostrarle a la persona. */
	at: string;
	slug: string;
}

function readBlocks(
	pages: BlockPage[],
	name: string,
): { entries: Entry[]; slugs: string[] } {
	const entries: Entry[] = [];
	const slugs: string[] = [];
	const pattern = new RegExp(
		`\`\`\`${name}[ \\t]*\\r?\\n([\\s\\S]*?)\`\`\``,
		"g",
	);
	for (const page of pages) {
		for (const block of page.body.matchAll(pattern)) {
			slugs.push(page.slug);
			const firstLine =
				page.body.slice(0, block.index ?? 0).split("\n").length + 1;
			block[1].split(/\r?\n/).forEach((rawLine, index) => {
				const line = rawLine.replace(/\s+#.*$/, "").trim();
				if (!line || line.startsWith("#")) return;
				const separator = line.indexOf(":");
				entries.push({
					key: separator === -1 ? "" : line.slice(0, separator).trim(),
					value:
						separator === -1
							? ""
							: line
									.slice(separator + 1)
									.trim()
									.replace(/\s+/g, " "),
					raw: line,
					at: `${page.slug}, línea ${firstLine + index}`,
					slug: page.slug,
				});
			});
		}
	}
	return { entries, slugs };
}

const LEVEL_KEYS = { encaje: "encaje_empresa", rol: "rol_decisor" } as const;

export function parseIcpBlocks(pages: BlockPage[]): {
	icp: IcpLevels | null;
	blocks: number;
	errors: string[];
} {
	const { entries, slugs } = readBlocks(pages, "icp");
	if (slugs.length === 0) return { icp: null, blocks: 0, errors: [] };
	if (slugs.length > 1) {
		return {
			icp: null,
			blocks: slugs.length,
			errors: [
				`hay más de un bloque icp: ${slugs.join(", ")}. Dejá uno solo.`,
			],
		};
	}
	const slug = slugs[0];
	const errors: string[] = [];
	const levels = { encaje_empresa: [] as string[], rol_decisor: [] as string[] };
	const excluir: string[] = [];

	for (const entry of entries) {
		if (entry.key !== "encaje" && entry.key !== "rol" && entry.key !== "excluir") {
			errors.push(`${entry.at}: directiva no reconocida: "${entry.raw}"`);
			continue;
		}
		if (entry.value.length < 10 || entry.value.length > 400) {
			errors.push(
				`${entry.at}: el nivel tiene que tener entre 10 y 400 caracteres`,
			);
			continue;
		}
		if (entry.key === "excluir") excluir.push(entry.value);
		else levels[LEVEL_KEYS[entry.key]].push(entry.value);
	}

	// Las cuentas se hacen sobre lo que el bloque trae, no sobre lo que pasó la
	// validación de largo: un nivel corto ya dio su propio error.
	const count = (key: string) =>
		entries.filter((entry) => entry.key === key).length;
	for (const key of ["encaje", "rol"] as const) {
		const n = count(key);
		if (n < 2 || n > 10) {
			errors.push(
				`${slug}: el bloque icp necesita entre 2 y 10 líneas ${key} (tiene ${n})`,
			);
		}
	}
	if (count("excluir") !== 1) {
		errors.push(
			`${slug}: el bloque icp necesita exactamente una línea excluir (tiene ${count("excluir")})`,
		);
	}

	return {
		icp: errors.length === 0 ? { ...levels, excluir: excluir[0] } : null,
		blocks: 1,
		errors,
	};
}

function readList(
	entries: Entry[],
	noun: "hook" | "vector",
	errors: string[],
): Array<ListValue & { rest: string; at: string }> {
	const seen = new Map<string, string>();
	const out: Array<ListValue & { rest: string; at: string }> = [];
	for (const entry of entries) {
		if (!VALUE.test(entry.key)) {
			errors.push(
				`${entry.at}: identificador inválido: "${entry.key || entry.raw}" (minúsculas, dígitos y guion bajo)`,
			);
			continue;
		}
		const arrow = entry.value.lastIndexOf(" => ");
		const label =
			noun === "vector" && arrow !== -1
				? entry.value.slice(0, arrow).trim()
				: entry.value;
		const rest =
			noun === "vector" && arrow !== -1
				? entry.value.slice(arrow + 4).trim()
				: "";
		if (label.length < 1 || label.length > 200) {
			errors.push(
				`${entry.at}: el rótulo tiene que tener entre 1 y 200 caracteres`,
			);
			continue;
		}
		const previous = seen.get(entry.key);
		if (previous) {
			errors.push(
				`${entry.at}: el ${noun} "${entry.key}" ya está en ${previous}`,
			);
			continue;
		}
		seen.set(entry.key, entry.at);
		out.push({ value: entry.key, label, rest, at: entry.at });
	}
	return out;
}

export function parseMarcoBlocks(pages: BlockPage[]): Marco & {
	blocks: number;
	errors: string[];
} {
	const hookBlocks = readBlocks(pages, "hooks");
	const vectorBlocks = readBlocks(pages, "vectores");
	const blocks = hookBlocks.slugs.length + vectorBlocks.slugs.length;
	if (blocks === 0) return { hooks: [], vectores: [], blocks: 0, errors: [] };

	const errors: string[] = [];
	const hooks = readList(hookBlocks.entries, "hook", errors);
	const vectors = readList(vectorBlocks.entries, "vector", errors);
	const hookValues = new Set(hooks.map((hook) => hook.value));
	for (const vector of vectors) {
		if (vector.rest && !hookValues.has(vector.rest)) {
			errors.push(
				`${vector.at}: el vector "${vector.value}" apunta al hook "${vector.rest}", que no está en ningún bloque hooks`,
			);
		}
	}
	if (hooks.length === 0) {
		errors.push("faltan hooks: tiene que haber al menos uno en un bloque hooks");
	}
	if (vectors.length === 0) {
		errors.push(
			"faltan vectores: tiene que haber al menos uno en un bloque vectores",
		);
	}

	return {
		hooks: hooks.map(({ value, label }) => ({ value, label })),
		vectores: vectors.map(({ value, label, rest }) => ({
			value,
			label,
			default_hook: rest || null,
		})),
		blocks,
		errors,
	};
}

/** Huella de los niveles (spec O2): cambia si cambia un nivel, no si cambia
 * la prosa de alrededor. Los espacios ya vienen normalizados del parser. */
export function icpRevision(icp: IcpLevels): string {
	return createHash("sha256")
		.update(
			JSON.stringify([icp.encaje_empresa, icp.rol_decisor, icp.excluir]),
		)
		.digest("hex")
		.slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/outreach/canon-blocks.test.ts`
Expected: PASS. Si falla el test "identificador inválido…" por el orden de los errores, el orden correcto es el del test: primero los de `readList` de hooks, después los de vectores, después las clases vacías.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/outreach/canon-blocks.ts tests/outreach/canon-blocks.test.ts
git commit -m "feat: parser de los bloques icp, hooks y vectores del canon"
```

---

### Task 2: Lectura del ICP y del marco desde el brain

**Files:**
- Modify: `lib/outreach/canon.ts` (agregar al final, antes de `brainForTenant`)
- Test: `tests/outreach/canon-load.test.ts`

**Interfaces:**
- Consumes: `parseIcpBlocks`, `parseMarcoBlocks`, `IcpLevels`, `Marco` de Task 1.
- Produces:
  ```ts
  type CanonLoad<T> =
    | { ok: true; value: T }
    | { ok: false; reason: "sin_brain" | "brain_caido" | "falta" | "invalido"; errors: string[] };
  loadIcpLevels(brain: BrainProvider | null): Promise<CanonLoad<IcpLevels>>
  loadMarco(brain: BrainProvider | null): Promise<CanonLoad<Marco>>
  const ICP_TAG = "canon:icp"; const MARCO_TAG = "canon:hooks";
  ```
  Ninguna de las dos tira: un brain que falla devuelve `brain_caido`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/outreach/canon-load.test.ts
import { describe, expect, it, vi } from "vitest";
import type { BrainPage, BrainProvider } from "@/lib/brain/core/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { loadIcpLevels, loadMarco } = await import("@/lib/outreach/canon");

const page = (
	slug: string,
	tags: string[],
	body: string,
	status: BrainPage["status"] = "activo",
): BrainPage => ({
	slug,
	title: slug,
	category: "comercial",
	status,
	tags,
	frontmatter: {},
	body,
	revision: 1,
	updatedAt: "2026-10-10",
});

function brainWith(pages: BrainPage[]): BrainProvider {
	return {
		search: async ({ tag }) =>
			pages
				.filter((p) => !tag || p.tags.includes(tag))
				.map((p) => ({
					slug: p.slug,
					title: p.title,
					category: p.category,
					status: p.status,
					tags: p.tags,
					snippet: "",
					updatedAt: p.updatedAt,
				})),
		read: async (slug) => {
			const found = pages.find((p) => p.slug === slug);
			if (!found) throw new Error("no existe");
			return found;
		},
		list: async () => [],
		history: async () => null,
		upsert: async () => {
			throw new Error("no se usa");
		},
	};
}

const ICP_BODY = [
	"```icp",
	"encaje: No es del universo: rubro ajeno o tamaño fuera de rango",
	"encaje: Encaja bien: tamaño y rubro del perfil buscado",
	"rol: Sin relación con esta decisión de compra",
	"rol: Decide: tiene control sobre el presupuesto",
	"excluir: La empresa es competidora, cliente o proveedora",
	"```",
].join("\n");
const MARCO_BODY = "```hooks\nh_uno: Uno\n```\n\n```vectores\nv_uno: Vector => h_uno\n```";

describe("loadIcpLevels", () => {
	it("sin brain", async () => {
		expect(await loadIcpLevels(null)).toEqual({
			ok: false,
			reason: "sin_brain",
			errors: [],
		});
	});

	it("lee el bloque de la página activa", async () => {
		const result = await loadIcpLevels(
			brainWith([page("comercial/icp", ["canon:icp"], ICP_BODY)]),
		);
		expect(result).toMatchObject({
			ok: true,
			value: { excluir: "La empresa es competidora, cliente o proveedora" },
		});
	});

	it("una página en borrador no cuenta: falta", async () => {
		expect(
			await loadIcpLevels(
				brainWith([page("comercial/icp", ["canon:icp"], ICP_BODY, "borrador")]),
			),
		).toEqual({ ok: false, reason: "falta", errors: [] });
	});

	it("el borrador con la plantilla no rompe el ICP de la página activa", async () => {
		const result = await loadIcpLevels(
			brainWith([
				page("comercial/icp", ["canon:icp"], "```icp\n# completar\n```", "borrador"),
				page("comercial/criterios", ["canon:icp"], ICP_BODY),
			]),
		);
		expect(result.ok).toBe(true);
	});

	it("bloque roto: inválido con sus errores", async () => {
		const result = await loadIcpLevels(
			brainWith([page("comercial/icp", ["canon:icp"], "```icp\nencaje: corto\n```")]),
		);
		expect(result).toMatchObject({ ok: false, reason: "invalido" });
		expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
	});

	it("el brain falla: brain_caido, sin tirar", async () => {
		const broken = {
			...brainWith([]),
			search: async () => {
				throw new Error("timeout");
			},
		};
		expect(await loadIcpLevels(broken)).toEqual({
			ok: false,
			reason: "brain_caido",
			errors: [],
		});
	});
});

describe("loadMarco", () => {
	it("lee hooks y vectores de las páginas activas", async () => {
		expect(
			await loadMarco(
				brainWith([page("comercial/hooks", ["canon:hooks"], MARCO_BODY)]),
			),
		).toEqual({
			ok: true,
			value: {
				hooks: [{ value: "h_uno", label: "Uno" }],
				vectores: [{ value: "v_uno", label: "Vector", default_hook: "h_uno" }],
			},
		});
	});

	it("solo prosa o solo borradores: falta", async () => {
		expect(
			await loadMarco(
				brainWith([
					page("comercial/redaccion", ["canon:hooks"], "prosa"),
					page("comercial/hooks", ["canon:hooks"], MARCO_BODY, "borrador"),
				]),
			),
		).toEqual({ ok: false, reason: "falta", errors: [] });
	});

	it("bloque roto: inválido", async () => {
		expect(
			await loadMarco(
				brainWith([page("comercial/hooks", ["canon:hooks"], "```hooks\nh_uno: Uno\n```")]),
			),
		).toEqual({
			ok: false,
			reason: "invalido",
			errors: [
				"faltan vectores: tiene que haber al menos uno en un bloque vectores",
			],
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/outreach/canon-load.test.ts`
Expected: FAIL, `loadIcpLevels is not a function`.

- [ ] **Step 3: Write the implementation**

En `lib/outreach/canon.ts`, agregar el import arriba:

```ts
import {
	type BlockPage,
	type IcpLevels,
	type Marco,
	parseIcpBlocks,
	parseMarcoBlocks,
} from "./canon-blocks";
```

Y antes de `export async function brainForTenant`:

```ts
export const ICP_TAG = "canon:icp";
export const MARCO_TAG = "canon:hooks";

/** Lo que el outreach lee de un bloque del canon, o por qué no pudo. Nunca
 * tira: quien llama decide qué hacer con cada motivo (spec 21.3 §3.3). */
export type CanonLoad<T> =
	| { ok: true; value: T }
	| {
			ok: false;
			reason: "sin_brain" | "brain_caido" | "falta" | "invalido";
			errors: string[];
	  };

// Solo páginas activas (spec O8): la búsqueda del brain devuelve borradores,
// y una plantilla sin completar no puede calificar ni reflejarse.
async function activeBlockPages(
	brain: BrainProvider,
	tag: string,
): Promise<BlockPage[]> {
	return (await readTag(brain, tag))
		.filter((page) => page.status === "activo")
		.map((page) => ({ slug: page.slug, body: page.body }));
}

async function loadBlocks<T>(
	brain: BrainProvider | null,
	tag: string,
	parse: (pages: BlockPage[]) => {
		value: T | null;
		blocks: number;
		errors: string[];
	},
): Promise<CanonLoad<T>> {
	if (!brain) return { ok: false, reason: "sin_brain", errors: [] };
	let pages: BlockPage[];
	try {
		pages = await activeBlockPages(brain, tag);
	} catch (error) {
		console.error(`canon: no pude leer ${tag}:`, error);
		return { ok: false, reason: "brain_caido", errors: [] };
	}
	const parsed = parse(pages);
	if (parsed.blocks === 0) return { ok: false, reason: "falta", errors: [] };
	if (parsed.errors.length > 0 || parsed.value === null) {
		return { ok: false, reason: "invalido", errors: parsed.errors };
	}
	return { ok: true, value: parsed.value };
}

export function loadIcpLevels(
	brain: BrainProvider | null,
): Promise<CanonLoad<IcpLevels>> {
	return loadBlocks(brain, ICP_TAG, (pages) => {
		const { icp, blocks, errors } = parseIcpBlocks(pages);
		return { value: icp, blocks, errors };
	});
}

export function loadMarco(
	brain: BrainProvider | null,
): Promise<CanonLoad<Marco>> {
	return loadBlocks(brain, MARCO_TAG, (pages) => {
		const { hooks, vectores, blocks, errors } = parseMarcoBlocks(pages);
		return { value: { hooks, vectores }, blocks, errors };
	});
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/outreach/canon-load.test.ts tests/outreach/canon.test.ts`
Expected: PASS los dos archivos (el segundo comprueba que `loadCanon` no cambió).

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/outreach/canon.ts tests/outreach/canon-load.test.ts
git commit -m "feat: el outreach lee el ICP y el marco de los bloques del brain"
```

---

### Task 3: El scoring lee el ICP del brain

**Files:**
- Modify: `lib/outreach/services/icp-score.ts`
- Modify: `lib/outreach/config.ts` (quitar `icp` de `outreachConfigSchema`)
- Modify: `agents/outreach/schedules/dispatch.ts` (armado de `icpScore`, cerca de la línea 113)
- Modify: `tests/outreach/services/icp-score.test.ts`, `tests/outreach/fake-store.ts`, `tests/outreach/config.test.ts`

**Interfaces:**
- Consumes: `CanonLoad`, `loadIcpLevels`, `brainForTenant` (Task 2); `IcpLevels`, `icpRevision` (Task 1).
- Produces: `IcpScoreDeps.loadIcp: (tenantId: string) => Promise<CanonLoad<IcpLevels>>`. Negativas nuevas de `scoreContact`: `icp_sin_brain`, `canon_no_disponible`, `icp_sin_niveles`, `icp_invalido`.

- [ ] **Step 1: Cambiar los tests de `scoreContact`**

En `tests/outreach/services/icp-score.test.ts`, agregar arriba, después de `ANSWERS`:

```ts
const LEVELS = {
	encaje_empresa: [
		"no encaja: no es el tipo de empresa que buscamos",
		"encaja bien: es exactamente el tipo de empresa que buscamos",
	],
	rol_decisor: [
		"sin relación con esta decisión de compra",
		"decide: tiene control sobre el presupuesto",
	],
	excluir: "la empresa es competidora, cliente o proveedora",
};
```

Cambiar `deps` para que reciba la carga del ICP:

```ts
function deps(
	store = createFakeStore(),
	answers: unknown = ANSWERS,
	icp: unknown = { ok: true, value: LEVELS },
) {
	return {
		store,
		loadIcp: vi.fn(async (_tenantId: string) => icp as never),
		evaluate: vi.fn(async (_args: unknown) => ({
			answers: answers as Record<string, unknown>,
			usage: { inputTokens: 400, outputTokens: 20 },
			providerMetadata: { gateway: { cost: 0.000016 } },
		})),
		now: () => new Date("2026-09-22T12:00:00Z"),
	};
}
```

Reemplazar el test `"sin niveles cargados en el tenant no llama al modelo"` entero por:

```ts
	it.each([
		["sin_brain", "icp_sin_brain"],
		["brain_caido", "canon_no_disponible"],
		["falta", "icp_sin_niveles"],
	])("ICP %s: se niega con %s y no llama al modelo", async (reason, refusal) => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store, ANSWERS, { ok: false, reason, errors: [] });

		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		expect(result).toMatchObject({ ok: false, reason: refusal });
		expect(d.evaluate).not.toHaveBeenCalled();
	});

	it("ICP inválido: la negativa lleva el primer error del bloque", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store, ANSWERS, {
			ok: false,
			reason: "invalido",
			errors: ["comercial/icp, línea 2: el nivel tiene que tener entre 10 y 400 caracteres"],
		});

		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		expect(result).toMatchObject({ ok: false, reason: "icp_invalido" });
		expect(result.ok === false && result.message).toContain("comercial/icp, línea 2");
		expect(d.evaluate).not.toHaveBeenCalled();
	});

	it("manda los niveles del brain como criterios y guarda la huella", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store);

		await scoreContact({ tenantId: TENANT, contactId: store.contacts[0].id }, d);

		const args = d.evaluate.mock.calls[0][0] as {
			questions: Record<string, { criteria?: string[]; instructions: string }>;
		};
		expect(d.loadIcp).toHaveBeenCalledWith(TENANT);
		expect(args.questions.encaje_empresa.criteria).toEqual(LEVELS.encaje_empresa);
		expect(args.questions.excluir.instructions).toBe(LEVELS.excluir);
		expect(store.contacts[0].icp?.revision).toMatch(/^[0-9a-f]{16}$/);
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/outreach/services/icp-score.test.ts`
Expected: FAIL: los tests nuevos reciben `ok: true` o `icp_sin_niveles`, y `loadIcp` no se llama.

- [ ] **Step 3: Implementar en `lib/outreach/services/icp-score.ts`**

Agregar imports:

```ts
import type { CanonLoad } from "../canon";
import { type IcpLevels, icpRevision } from "../canon-blocks";
```

Agregar `loadIcp` a `IcpScoreDeps`:

```ts
export interface IcpScoreDeps {
	store: OutreachStore;
	/** Los niveles del ICP del brain de la empresa (spec 21.3 §3.4). */
	loadIcp: (tenantId: string) => Promise<CanonLoad<IcpLevels>>;
	evaluate: (
		args: Parameters<typeof runEvaluation>[0],
	) => Promise<Awaited<ReturnType<typeof runEvaluation>>>;
	now: () => Date;
}
```

Reemplazar el comienzo de `scoreContact` (desde `const tenant = await deps.store.loadTenantOutreach` hasta el cierre del `if (!levels)`) por:

```ts
	const loaded = await deps.loadIcp(input.tenantId);
	if (!loaded.ok) {
		switch (loaded.reason) {
			case "sin_brain":
				return refuse(
					"icp_sin_brain",
					"esta empresa no tiene el brain habilitado: no se puede calificar",
				);
			case "brain_caido":
				return refuse(
					"canon_no_disponible",
					"no pude leer el ICP de la empresa en el brain",
				);
			case "falta":
				return refuse(
					"icp_sin_niveles",
					"el brain no tiene un bloque icp en una página activa con el tag canon:icp: no se puede calificar",
				);
			default:
				return refuse(
					"icp_invalido",
					`el bloque icp del brain no es válido: ${loaded.errors[0] ?? "revisá la página canon:icp"}`,
				);
		}
	}
	const levels = loaded.value;
```

Y en la llamada a `updateContactIcp`, cambiar `revision: levels.revision,` por:

```ts
		revision: icpRevision(levels),
```

- [ ] **Step 4: Quitar `icp` de la configuración**

En `lib/outreach/config.ts`, borrar del `outreachConfigSchema` el bloque completo de la clave `icp` (el comentario `// Los niveles del score del ICP…` y el `icp: z.object({...}).nullable().default(null),`). `outreachFileSchema` usa `config: outreachConfigSchema`: `tenants/innovas/outreach.json` sigue validando porque zod descarta la clave desconocida.

En `tests/outreach/fake-store.ts`, dentro de `defaultTenant`, borrar la clave `icp: {...}` entera y su comentario de tres líneas. No tocar el `icp: null` de `contactRow` (cerca de la línea 140): ese es el juicio guardado en el contacto, que no cambia.

En `tests/outreach/config.test.ts`: borrar `icp: null,` del objeto esperado (línea 32) y borrar el test que carga `icp: {...}` y afirma `config.icp?.revision` (líneas 49 a 60 aproximadamente). Agregar en su lugar:

```ts
	it("ignora una clave icp vieja: los niveles viven en el brain", () => {
		const config = parseOutreachConfig({
			icp: { revision: "2026-09-22", excluir: "x".repeat(20) },
		});
		expect("icp" in config).toBe(false);
	});
```

- [ ] **Step 5: Cablear la puerta**

En `agents/outreach/schedules/dispatch.ts`, sumar `loadIcpLevels` al import existente de `canon`:

```ts
import {
	brainForTenant,
	loadCanon,
	loadIcpLevels,
} from "../../../lib/outreach/canon";
```

Justo arriba de `const icpScore: IcpScoreNode = …`, en el mismo scope:

```ts
		// El ICP se lee una vez por pasada, no una vez por contacto (spec 21.3
		// §3.4). La clave lleva la corrida: una pasada nueva lo vuelve a leer.
		const icpByRun = new Map<string, ReturnType<typeof loadIcpLevels>>();
		const loadIcpOnce = (tenantId: string, runId: string) => {
			const key = `${tenantId}:${runId}`;
			let pending = icpByRun.get(key);
			if (!pending) {
				if (icpByRun.size >= 50) icpByRun.clear();
				pending = brainForTenant(tenantId).then(loadIcpLevels);
				icpByRun.set(key, pending);
			}
			return pending;
		};
```

Y en las dependencias de `scoreContact` dentro de `icpScore`, después de `store: outreach,`:

```ts
					loadIcp: (id) => loadIcpOnce(id, runId),
```

- [ ] **Step 6: Run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS. Si `typecheck` marca otro lector de `config.icp`, buscarlo con `grep -rn "config\.icp\|\.icp\.revision" lib agents app` y no debería quedar ninguno fuera de `contacts.icp` (el juicio guardado en el contacto, que no cambia).

- [ ] **Step 7: Commit**

```bash
git add lib/outreach/services/icp-score.ts lib/outreach/config.ts agents/outreach/schedules/dispatch.ts tests/outreach
git commit -m "feat: el scoring de ICP lee los niveles del brain y guarda su huella"
```

---

### Task 4: Función `outreach_reflect_marco`

**Files:**
- Create: `supabase/migrations/20261017120000_outreach_marco_reflect.sql`
- Test: `supabase/tests/31_outreach_marco_reflect.test.sql`
- Modify: `lib/supabase/database.types.ts` (generado)

**Interfaces:**
- Produces: `public.outreach_reflect_marco(p_tenant uuid, p_hooks jsonb, p_vectors jsonb) returns jsonb`, solo `service_role`. `p_hooks`: `[{"value","label"}]`. `p_vectors`: `[{"value","label","default_hook"}]`. Devuelve `{"upserts": n, "deactivated": n, "unchanged": n}`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices` antes de escribir SQL.

- [ ] **Step 2: Write the failing test**

```sql
-- supabase/tests/31_outreach_marco_reflect.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into public.tenants (id, slug, display_name)
values
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'mr-a', 'MR A'),
  ('d1d1d1d1-0000-0000-0000-00000000000b', 'mr-b', 'MR B');

insert into public.config_values (tenant_id, kind, value, label, active, meta)
values
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_viejo', 'Viejo', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_queda', 'Queda', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_vuelve', 'Vuelve', false, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'vector', 'v_uno', 'Uno', true, '{"default_hook": null}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'segmento', 'seg', 'Segmento', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000b', 'hook', 'h_viejo', 'De otra empresa', true, '{}');

select is(
  public.outreach_reflect_marco(
    'd1d1d1d1-0000-0000-0000-00000000000a',
    '[{"value":"h_queda","label":"Queda"},{"value":"h_vuelve","label":"Vuelve"},{"value":"h_nuevo","label":"Nuevo"}]',
    '[{"value":"v_uno","label":"Uno cambiado","default_hook":"h_nuevo"}]'
  ),
  '{"upserts": 3, "deactivated": 1, "unchanged": 1}'::jsonb,
  'devuelve altas o cambios, bajas y sin cambios'
);

select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind = 'hook' and value = 'h_viejo'),
  false, 'el hook que no vino queda desactivado');
select is(
  (select count(*)::int from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_viejo'),
  1, 'y no se borra');
select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_vuelve'),
  true, 'un hook desactivado que vuelve se reactiva');
select is(
  (select label from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_nuevo'),
  'Nuevo', 'el hook nuevo se da de alta');
select is(
  (select label || '|' || (meta->>'default_hook') from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind = 'vector' and value = 'v_uno'),
  'Uno cambiado|h_nuevo', 'el vector cambia rótulo y hook por defecto');
select is(
  (select count(*)::int from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind in ('segmento', 'idioma') and active),
  2, 'segmentos e idiomas no se tocan');
select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000b' and value = 'h_viejo'),
  true, 'la otra empresa no se toca');
select is(
  (select payload from public.events
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and type = 'outreach.marco_reflected'),
  '{"upserts": 3, "deactivated": 1, "unchanged": 1}'::jsonb,
  'deja el evento con los contadores');

select is(
  public.outreach_reflect_marco(
    'd1d1d1d1-0000-0000-0000-00000000000a',
    '[{"value":"h_queda","label":"Queda"},{"value":"h_vuelve","label":"Vuelve"},{"value":"h_nuevo","label":"Nuevo"}]',
    '[{"value":"v_uno","label":"Uno cambiado","default_hook":"h_nuevo"}]'
  ),
  '{"upserts": 0, "deactivated": 0, "unchanged": 4}'::jsonb,
  'repetir el mismo reflejo no cambia nada');

select throws_ok(
  $$select public.outreach_reflect_marco('d1d1d1d1-0000-0000-0000-00000000000a', '[]', '[{"value":"v_uno","label":"Uno","default_hook":null}]')$$,
  '23514', null, 'rechaza hooks vacío');
select throws_ok(
  $$select public.outreach_reflect_marco('d1d1d1d1-0000-0000-0000-00000000000a', '[{"value":"h_queda","label":"Queda"}]', '{}')$$,
  '23514', null, 'rechaza vectores que no es una lista');

select ok(
  not has_function_privilege('authenticated', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute'),
  'solo service_role la ejecuta');

select * from finish();
rollback;
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run db:test`
Expected: el archivo 31 falla con `function public.outreach_reflect_marco(...) does not exist`.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20261017120000_outreach_marco_reflect.sql
-- Reflejo de hooks y vectores del brain en config_values (spec 21.3 §3.5 y
-- §5.1). El brain manda: lo que viene se da de alta o se actualiza, lo que no
-- viene se desactiva. Nunca se borra (contactos y focos guardan el valor como
-- texto) y nunca se tocan segmentos ni idiomas.
create or replace function public.outreach_reflect_marco(
  p_tenant uuid, p_hooks jsonb, p_vectors jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_upserts integer;
  v_deactivated integer;
  v_result jsonb;
begin
  if p_hooks is null or p_vectors is null
     or jsonb_typeof(p_hooks) <> 'array' or jsonb_typeof(p_vectors) <> 'array'
     or jsonb_array_length(p_hooks) = 0 or jsonb_array_length(p_vectors) = 0 then
    raise exception 'el reflejo necesita al menos un hook y un vector' using errcode = '23514';
  end if;

  v_total := jsonb_array_length(p_hooks) + jsonb_array_length(p_vectors);

  with wanted as (
    select 'hook'::public.config_value_kind as kind,
           h->>'value' as value, h->>'label' as label, '{}'::jsonb as meta
      from jsonb_array_elements(p_hooks) as h
    union all
    select 'vector'::public.config_value_kind,
           v->>'value', v->>'label',
           jsonb_build_object('default_hook', v->'default_hook')
      from jsonb_array_elements(p_vectors) as v
  ),
  written as (
    insert into public.config_values as cv (tenant_id, kind, value, label, active, meta, updated_at)
    select p_tenant, w.kind, w.value, w.label, true, w.meta, now()
      from wanted as w
    on conflict (tenant_id, kind, value) do update
      set label = excluded.label, meta = excluded.meta, active = true, updated_at = now()
      where cv.label is distinct from excluded.label
         or cv.meta is distinct from excluded.meta
         or not cv.active
    returning 1
  )
  select count(*) into v_upserts from written;

  update public.config_values as cv
     set active = false, updated_at = now()
   where cv.tenant_id = p_tenant
     and cv.active
     and cv.kind in ('hook', 'vector')
     and not exists (
       select 1
         from jsonb_array_elements(case cv.kind when 'hook' then p_hooks else p_vectors end) as e
        where e->>'value' = cv.value
     );
  get diagnostics v_deactivated = row_count;

  v_result := jsonb_build_object(
    'upserts', v_upserts, 'deactivated', v_deactivated, 'unchanged', v_total - v_upserts);

  insert into public.events (tenant_id, type, summary, payload)
  values (p_tenant, 'outreach.marco_reflected',
          v_upserts || ' altas o cambios, ' || v_deactivated || ' bajas', v_result);

  return v_result;
end;
$$;

revoke execute on function public.outreach_reflect_marco(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.outreach_reflect_marco(uuid, jsonb, jsonb) to service_role;
```

Nota: `jsonb_build_object('default_hook', v->'default_hook')` deja `{"default_hook": null}` cuando el vector no tiene hook, igual que lo que escribía el script.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run db:test`
Expected: PASS todos los archivos, incluido el 31 con 13 pruebas. Si `events` rechaza el insert por una columna obligatoria que este plan no conoce, mirar cómo inserta `platform_set_agent` en `supabase/migrations/20261015120000_platform_console.sql` y copiar las columnas (ahí `actor_user_id` es opcional).

- [ ] **Step 6: Regenerar tipos y commit**

```bash
npm run db:types
git add supabase/migrations/20261017120000_outreach_marco_reflect.sql supabase/tests/31_outreach_marco_reflect.test.sql lib/supabase/database.types.ts
git commit -m "feat: funcion que refleja hooks y vectores del brain en config_values"
```

---

### Task 5: Reflejo automático al guardar y al borrar

**Files:**
- Create: `lib/outreach/marco-reflect.ts`
- Create: `lib/brain/adapters/canon-reflection.ts`
- Modify: `lib/brain/adapters/provider.ts`
- Modify: `app/[tenant]/brain/delete-actions.ts`
- Test: `tests/outreach/marco-reflect.test.ts`, `tests/brain/canon-reflection.test.ts`, `tests/brain/delete-actions.test.ts`

**Interfaces:**
- Consumes: `loadMarco`, `brainForTenant`, `CanonLoad`, `MARCO_TAG` (Task 2); `outreach_reflect_marco` (Task 4).
- Produces:
  ```ts
  // lib/outreach/marco-reflect.ts
  type MarcoReflectResult =
    | { ok: true; upserts: number; deactivated: number; unchanged: number }
    | { ok: false; reason: "sin_brain" | "brain_caido" | "falta" | "invalido"; errors: string[] };
  interface MarcoReflectStore {
    apply(tenantId: string, marco: Marco): Promise<{ upserts: number; deactivated: number; unchanged: number }>;
    recordFailure(tenantId: string, reason: string, errors: string[]): Promise<void>;
  }
  reflectMarco(tenantId: string, deps: { brain: BrainProvider | null; store: MarcoReflectStore }): Promise<MarcoReflectResult>
  reflectMarcoForTenant(tenantId: string): Promise<MarcoReflectResult>
  // lib/brain/adapters/canon-reflection.ts
  withCanonReflection(provider: BrainProvider, onMarcoChange: () => Promise<unknown>): BrainProvider
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/outreach/marco-reflect.test.ts
import { describe, expect, it, vi } from "vitest";
import type { BrainPage, BrainProvider } from "@/lib/brain/core/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { reflectMarco } = await import("@/lib/outreach/marco-reflect");

function brain(body: string | Error): BrainProvider {
	const page: BrainPage = {
		slug: "comercial/hooks",
		title: "Hooks",
		category: "comercial",
		status: "activo",
		tags: ["canon:hooks"],
		frontmatter: {},
		body: typeof body === "string" ? body : "",
		revision: 1,
		updatedAt: "2026-10-10",
	};
	return {
		search: async () => {
			if (body instanceof Error) throw body;
			return [{ ...page, snippet: "" }];
		},
		read: async () => page,
		list: async () => [],
		history: async () => null,
		upsert: async () => {
			throw new Error("no se usa");
		},
	};
}

const store = () => ({
	apply: vi.fn(async () => ({ upserts: 2, deactivated: 1, unchanged: 0 })),
	recordFailure: vi.fn(async () => {}),
});

const VALID = "```hooks\nh_uno: Uno\n```\n```vectores\nv_uno: Vector => h_uno\n```";

describe("reflectMarco", () => {
	it("marco válido: aplica y devuelve los contadores", async () => {
		const s = store();
		expect(await reflectMarco("t1", { brain: brain(VALID), store: s })).toEqual({
			ok: true,
			upserts: 2,
			deactivated: 1,
			unchanged: 0,
		});
		expect(s.apply).toHaveBeenCalledWith("t1", {
			hooks: [{ value: "h_uno", label: "Uno" }],
			vectores: [{ value: "v_uno", label: "Vector", default_hook: "h_uno" }],
		});
		expect(s.recordFailure).not.toHaveBeenCalled();
	});

	it("bloque inválido: no toca la base y deja el evento de fallo", async () => {
		const s = store();
		const result = await reflectMarco("t1", {
			brain: brain("```hooks\nh_uno: Uno\n```"),
			store: s,
		});
		expect(result).toMatchObject({ ok: false, reason: "invalido" });
		expect(s.apply).not.toHaveBeenCalled();
		expect(s.recordFailure).toHaveBeenCalledWith("t1", "invalido", [
			"faltan vectores: tiene que haber al menos uno en un bloque vectores",
		]);
	});

	it("brain caído: no toca la base y lo registra", async () => {
		const s = store();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await reflectMarco("t1", {
			brain: brain(new Error("timeout")),
			store: s,
		});
		log.mockRestore();
		expect(result).toMatchObject({ ok: false, reason: "brain_caido" });
		expect(s.apply).not.toHaveBeenCalled();
		expect(s.recordFailure).toHaveBeenCalledWith("t1", "brain_caido", []);
	});

	it.each([
		["sin brain", null],
		["sin bloques", brain("solo prosa")],
	])("%s: no toca la base ni deja evento", async (_name, b) => {
		const s = store();
		const result = await reflectMarco("t1", { brain: b, store: s });
		expect(result.ok).toBe(false);
		expect(s.apply).not.toHaveBeenCalled();
		expect(s.recordFailure).not.toHaveBeenCalled();
	});
});
```

```ts
// tests/brain/canon-reflection.test.ts
import { describe, expect, it, vi } from "vitest";
import { withCanonReflection } from "@/lib/brain/adapters/canon-reflection";
import type { BrainPage, BrainProvider, BrainWrite } from "@/lib/brain/core/types";

const write = (tags: string[]): BrainWrite => ({
	slug: "comercial/hooks",
	title: "Hooks",
	category: "comercial",
	status: "activo",
	tags,
	body: "x",
	reason: "prueba",
});
const author = { kind: "user", userId: "u1" } as const;

function provider(previousTags: string[] | null): BrainProvider {
	return {
		search: async () => [],
		read: async () => {
			if (previousTags === null) throw new Error("no existe");
			return { tags: previousTags } as BrainPage;
		},
		list: async () => [],
		history: async () => null,
		upsert: vi.fn(async () => ({ slug: "comercial/hooks", revision: 2 })),
	};
}

describe("withCanonReflection", () => {
	it("refleja después de guardar una página canon:hooks", async () => {
		const order: string[] = [];
		const base = provider(null);
		(base.upsert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			order.push("upsert");
			return { slug: "comercial/hooks", revision: 2 };
		});
		const wrapped = withCanonReflection(base, async () => {
			order.push("reflect");
		});

		expect(await wrapped.upsert(write(["canon:hooks"]), author)).toEqual({
			slug: "comercial/hooks",
			revision: 2,
		});
		expect(order).toEqual(["upsert", "reflect"]);
	});

	it("refleja si la página tenía el tag y se lo quitaron", async () => {
		const reflect = vi.fn(async () => {});
		await withCanonReflection(provider(["canon:hooks"]), reflect).upsert(
			write(["otro"]),
			author,
		);
		expect(reflect).toHaveBeenCalledTimes(1);
	});

	it("no refleja una página que no tiene ni tenía el tag, ni una nueva", async () => {
		const reflect = vi.fn(async () => {});
		await withCanonReflection(provider(["canon:icp"]), reflect).upsert(write(["canon:icp"]), author);
		await withCanonReflection(provider(null), reflect).upsert(write([]), author);
		expect(reflect).not.toHaveBeenCalled();
	});

	it("un reflejo que tira no hace fallar el guardado", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const wrapped = withCanonReflection(provider(null), async () => {
			throw new Error("base caída");
		});
		expect(await wrapped.upsert(write(["canon:hooks"]), author)).toEqual({
			slug: "comercial/hooks",
			revision: 2,
		});
		log.mockRestore();
	});

	it("si el guardado falla, no refleja y propaga el error", async () => {
		const base = provider(null);
		(base.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("conflicto"));
		const reflect = vi.fn(async () => {});
		await expect(
			withCanonReflection(base, reflect).upsert(write(["canon:hooks"]), author),
		).rejects.toThrow("conflicto");
		expect(reflect).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/outreach/marco-reflect.test.ts tests/brain/canon-reflection.test.ts`
Expected: FAIL, los dos módulos no existen.

- [ ] **Step 3: Implementar `lib/outreach/marco-reflect.ts`**

```ts
// Reflejo de hooks y vectores (spec 21.3 §3.5): el brain manda y
// config_values lo sigue. Si el marco no es válido no se escribe nada: sigue
// vigente lo último que se reflejó bien.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainProvider } from "../brain/core/types";
import { createAdminClient } from "../supabase/admin";
import { brainForTenant, type CanonLoad, loadMarco } from "./canon";
import type { Marco } from "./canon-blocks";

export interface MarcoReflectCounts {
	upserts: number;
	deactivated: number;
	unchanged: number;
}

export type MarcoReflectResult =
	| ({ ok: true } & MarcoReflectCounts)
	| Extract<CanonLoad<Marco>, { ok: false }>;

export interface MarcoReflectStore {
	apply(tenantId: string, marco: Marco): Promise<MarcoReflectCounts>;
	recordFailure(
		tenantId: string,
		reason: string,
		errors: string[],
	): Promise<void>;
}

export async function reflectMarco(
	tenantId: string,
	deps: { brain: BrainProvider | null; store: MarcoReflectStore },
): Promise<MarcoReflectResult> {
	const loaded = await loadMarco(deps.brain);
	if (!loaded.ok) {
		// "sin_brain" y "falta" no son un fallo que avisar: la empresa todavía
		// no cargó su marco (por ejemplo, recién se crearon las plantillas).
		if (loaded.reason === "invalido" || loaded.reason === "brain_caido") {
			await deps.store.recordFailure(tenantId, loaded.reason, loaded.errors);
		}
		return loaded;
	}
	return { ok: true, ...(await deps.store.apply(tenantId, loaded.value)) };
}

export function supabaseMarcoStore(client: SupabaseClient): MarcoReflectStore {
	return {
		async apply(tenantId, marco) {
			// biome-ignore lint/suspicious/noExplicitAny: rpc() no está tipado en este repo
			const { data, error } = await (client as any).rpc(
				"outreach_reflect_marco",
				{ p_tenant: tenantId, p_hooks: marco.hooks, p_vectors: marco.vectores },
			);
			if (error)
				throw new Error(`no pude reflejar el marco: ${error.message}`);
			const counts = (data ?? {}) as Partial<MarcoReflectCounts>;
			return {
				upserts: Number(counts.upserts ?? 0),
				deactivated: Number(counts.deactivated ?? 0),
				unchanged: Number(counts.unchanged ?? 0),
			};
		},
		async recordFailure(tenantId, reason, errors) {
			const { error } = await client.from("events").insert({
				tenant_id: tenantId,
				type: "outreach.marco_reflect_failed",
				summary:
					reason === "brain_caido"
						? "no pude leer los hooks y vectores del brain"
						: `los bloques de hooks y vectores no son válidos (${errors.length} errores)`,
				payload: { reason, errors: errors.slice(0, 20) },
			});
			if (error)
				console.error("marco: no pude registrar el fallo:", error.message);
		},
	};
}

export async function reflectMarcoForTenant(
	tenantId: string,
): Promise<MarcoReflectResult> {
	return reflectMarco(tenantId, {
		brain: await brainForTenant(tenantId),
		store: supabaseMarcoStore(createAdminClient()),
	});
}
```

- [ ] **Step 4: Implementar `lib/brain/adapters/canon-reflection.ts`**

```ts
// Engancha el reflejo del marco al guardado de páginas (spec 21.3 §3.5, O4).
// El brain no conoce al outreach: recibe la función por parámetro. Un reflejo
// que falla se registra y el guardado sigue (O5).
import type { BrainProvider } from "../core/types";

const MARCO_TAG = "canon:hooks";

export function withCanonReflection(
	provider: BrainProvider,
	onMarcoChange: () => Promise<unknown>,
): BrainProvider {
	return {
		search: (input) => provider.search(input),
		read: (slug, options) => provider.read(slug, options),
		list: () => provider.list(),
		history: (slug) => provider.history(slug),
		async upsert(write, author) {
			let touchesMarco = write.tags.includes(MARCO_TAG);
			if (!touchesMarco) {
				// Si le quitaron el tag, sus hooks ya no valen: hay que reflejar.
				try {
					const previous = await provider.read(write.slug, {
						suggestions: false,
					});
					touchesMarco = previous.tags.includes(MARCO_TAG);
				} catch {
					touchesMarco = false;
				}
			}
			const result = await provider.upsert(write, author);
			if (touchesMarco) {
				try {
					await onMarcoChange();
				} catch (error) {
					console.error("brain: el reflejo del marco falló:", error);
				}
			}
			return result;
		},
	};
}
```

- [ ] **Step 5: Cablear en `lib/brain/adapters/provider.ts`**

Agregar el import:

```ts
import { withCanonReflection } from "./canon-reflection";
```

Renombrar la función actual `getBrainProvider` a `rawBrainProvider` (sin `export`) y agregar debajo:

```ts
export function getBrainProvider(binding: BrainBinding): BrainProvider {
	// Import dinámico: lib/outreach/canon importa este archivo.
	return withCanonReflection(rawBrainProvider(binding), async () => {
		const { reflectMarcoForTenant } = await import(
			"../../outreach/marco-reflect"
		);
		await reflectMarcoForTenant(binding.tenantId);
	});
}
```

- [ ] **Step 6: Reflejar al borrar**

En `app/[tenant]/brain/delete-actions.ts`, agregar imports:

```ts
import { reflectMarcoForTenant } from "@/lib/outreach/marco-reflect";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
```

Y reemplazar el cuerpo de `deleteBrainPage` desde `const result = await deletePage(` hasta el `return result;` por:

```ts
	// Los tags hay que leerlos antes de borrar: después la página no existe.
	const preview = await previewDelete(tenantSlug, slug, deleteDeps());
	const wasMarco =
		preview.ok && preview.preview.canonTags.includes("canon:hooks");
	const result = await deletePage(
		tenantSlug,
		slug,
		expectedRevision,
		deleteDeps(),
	);
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	if (result.ok && wasMarco) {
		try {
			const tenant = await resolveTenantAccess(tenantSlug);
			if (tenant) await reflectMarcoForTenant(tenant.id);
		} catch (error) {
			console.error("brain: el reflejo del marco falló al borrar:", error);
		}
	}
	return result;
```

En `tests/brain/delete-actions.test.ts`, agregar junto a los otros mocks:

```ts
const reflectMarcoForTenant = vi.fn();
vi.mock("@/lib/outreach/marco-reflect", () => ({ reflectMarcoForTenant }));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => ({ id: "t1" }),
}));
```

sumar `reflectMarcoForTenant.mockReset();` al `beforeEach`, y estos tests dentro del `describe`:

```ts
	it("al borrar una página canon:hooks refleja el marco", async () => {
		previewDelete.mockResolvedValue({
			ok: true,
			preview: { canonTags: ["canon:hooks"] },
		});
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		await deleteBrainPage({ tenantSlug: "acme", slug: "comercial/hooks", expectedRevision: 3 });
		expect(reflectMarcoForTenant).toHaveBeenCalledWith("t1");
	});

	it("no refleja si la página no era canon:hooks, ni si el borrado falló", async () => {
		previewDelete.mockResolvedValue({ ok: true, preview: { canonTags: ["canon:icp"] } });
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		await deleteBrainPage({ tenantSlug: "acme", slug: "x", expectedRevision: 3 });

		previewDelete.mockResolvedValue({ ok: true, preview: { canonTags: ["canon:hooks"] } });
		deletePage.mockResolvedValue({ ok: false, code: "conflict", message: "cambió" });
		await deleteBrainPage({ tenantSlug: "acme", slug: "x", expectedRevision: 3 });

		expect(reflectMarcoForTenant).not.toHaveBeenCalled();
	});

	it("un reflejo que tira no cambia el resultado del borrado", async () => {
		previewDelete.mockResolvedValue({ ok: true, preview: { canonTags: ["canon:hooks"] } });
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		reflectMarcoForTenant.mockRejectedValue(new Error("base caída"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			await deleteBrainPage({ tenantSlug: "acme", slug: "x", expectedRevision: 3 }),
		).toEqual({ ok: true, cleaned: 0 });
		log.mockRestore();
	});
```

Los tests existentes de `deleteBrainPage` que no configuran `previewDelete` reciben `undefined`: cambiar `preview.ok` por `preview?.ok` no es la solución; en esos tests agregar `previewDelete.mockResolvedValue({ ok: false, code: "not_found", message: "No encontrado." });` antes de la llamada.

- [ ] **Step 7: Run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS. Si algún test de `tests/brain/` que usa `getBrainProvider` real falla por el import dinámico, es porque guarda una página `canon:hooks`: en ese test, mockear `@/lib/outreach/marco-reflect` igual que arriba.

- [ ] **Step 8: Commit**

```bash
git add lib/outreach/marco-reflect.ts lib/brain/adapters/canon-reflection.ts lib/brain/adapters/provider.ts "app/[tenant]/brain/delete-actions.ts" tests/outreach/marco-reflect.test.ts tests/brain/canon-reflection.test.ts tests/brain/delete-actions.test.ts
git commit -m "feat: guardar o borrar una pagina canon:hooks refleja hooks y vectores en la base"
```

---

### Task 6: Páginas por defecto al crear el brain

**Files:**
- Create: `lib/outreach/canon-templates.ts`
- Create: `lib/outreach/canon-seed.ts`
- Modify: `app/plataforma/[slug]/console-actions.ts` (`createBrain`)
- Test: `tests/outreach/canon-templates.test.ts`, `tests/outreach/canon-seed.test.ts`, `tests/plataforma/console-actions.test.ts`

**Interfaces:**
- Consumes: `parseIcpBlocks`, `parseMarcoBlocks` (Task 1); `brainForTenant` (Task 2).
- Produces:
  ```ts
  // canon-templates.ts
  const DEFAULT_CANON_PAGES: readonly { slug: string; title: string; category: string; tags: string[]; body: string }[]
  // canon-seed.ts
  seedCanonPages(brain: BrainProvider | null, userId: string): Promise<boolean>
  seedCanonPagesForTenant(tenantId: string, userId: string): Promise<boolean>
  ```
  `seedCanonPages` devuelve `false` si no pudo crear alguna página; una página que ya existe no es un fallo y no se pisa.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/outreach/canon-templates.test.ts
import { describe, expect, it } from "vitest";
import { parseIcpBlocks, parseMarcoBlocks } from "@/lib/outreach/canon-blocks";
import { DEFAULT_CANON_PAGES } from "@/lib/outreach/canon-templates";

// Completar la plantilla es sacarle el "# " a las líneas de ejemplo.
const completed = (body: string) =>
	body.replace(/^# (encaje|rol|excluir|h_|v_)/gm, "$1");

describe("plantillas de canon", () => {
	it("son dos, en comercial, con su tag", () => {
		expect(
			DEFAULT_CANON_PAGES.map(({ slug, category, tags }) => ({ slug, category, tags })),
		).toEqual([
			{ slug: "comercial/icp", category: "comercial", tags: ["canon:icp"] },
			{ slug: "comercial/hooks", category: "comercial", tags: ["canon:hooks"] },
		]);
	});

	it("sin completar no aportan niveles ni listas", () => {
		const [icp, hooks] = DEFAULT_CANON_PAGES;
		expect(parseIcpBlocks([icp]).icp).toBeNull();
		expect(parseMarcoBlocks([hooks])).toMatchObject({ hooks: [], vectores: [] });
	});

	it("completadas parsean sin errores", () => {
		const [icp, hooks] = DEFAULT_CANON_PAGES;
		expect(parseIcpBlocks([{ ...icp, body: completed(icp.body) }]).errors).toEqual([]);
		expect(parseMarcoBlocks([{ ...hooks, body: completed(hooks.body) }]).errors).toEqual([]);
	});

	it("no nombran a ningún cliente", () => {
		for (const page of DEFAULT_CANON_PAGES) {
			expect(page.body.toLowerCase()).not.toMatch(/innov|paralelo|radar/);
		}
	});
});
```

```ts
// tests/outreach/canon-seed.test.ts
import { describe, expect, it, vi } from "vitest";
import { BrainConflict } from "@/lib/brain/core/errors";
import type { BrainProvider } from "@/lib/brain/core/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { seedCanonPages } = await import("@/lib/outreach/canon-seed");

function brain(upsert: BrainProvider["upsert"]): BrainProvider {
	return {
		search: async () => [],
		read: async () => {
			throw new Error("no existe");
		},
		list: async () => [],
		history: async () => null,
		upsert,
	};
}

describe("seedCanonPages", () => {
	it("crea las dos páginas en borrador, sin baseRevision, como import", async () => {
		const upsert = vi.fn(async (write: { slug: string }) => ({ slug: write.slug, revision: 1 }));
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(true);

		expect(upsert).toHaveBeenCalledTimes(2);
		const [write, author] = upsert.mock.calls[0] as unknown as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(write).toMatchObject({ slug: "comercial/icp", status: "borrador", tags: ["canon:icp"] });
		expect(write.baseRevision).toBeUndefined();
		expect(author).toMatchObject({ kind: "import", userId: "u1", sourcePath: "plantilla:comercial/icp" });
		expect(author.sourceHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("una página que ya existe no se pisa y no es un fallo", async () => {
		const upsert = vi.fn(async () => {
			throw new BrainConflict("comercial/icp", 4);
		});
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(true);
		expect(upsert).toHaveBeenCalledTimes(2);
	});

	it("otro error devuelve false, sin tirar, y sigue con la otra página", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async () => {
			throw new Error("timeout");
		});
		expect(await seedCanonPages(brain(upsert as never), "u1")).toBe(false);
		expect(upsert).toHaveBeenCalledTimes(2);
		log.mockRestore();
	});

	it("sin brain devuelve false", async () => {
		expect(await seedCanonPages(null, "u1")).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/outreach/canon-templates.test.ts tests/outreach/canon-seed.test.ts`
Expected: FAIL, los módulos no existen.

- [ ] **Step 3: Implementar las plantillas**

```ts
// lib/outreach/canon-templates.ts
// Páginas que nacen con el brain de una empresa (spec 21.3 §3.6): carpeta y
// archivo por defecto para el ICP y para hooks y vectores. Nacen en borrador
// y con los bloques comentados: no cuentan hasta que una persona los completa
// y activa la página. Genéricas: no nombran a ningún cliente.
const ICP_BODY = `Esta página define a quién le vende la empresa. La leen el agente al redactar y el calificador de contactos.

Escribí arriba, en prosa, quién es el cliente ideal y por qué. Abajo, en el bloque, van los niveles que usa el calificador: cada línea es una situación concreta que se entiende sola, de la peor a la mejor.

Para que la página cuente: sacale el "# " a cada línea del bloque, reemplazá el texto por el tuyo y pasá la página a estado activo.

\`\`\`icp
# De 2 a 10 líneas "encaje", de la empresa que menos encaja a la que más.
# encaje: No encaja: describí acá la empresa que claramente queda afuera
# encaje: Podría encajar: describí acá la empresa que comparte algunos rasgos
# encaje: Encaja: describí acá la empresa que es exactamente la que buscás
# De 2 a 10 líneas "rol", de la persona menos indicada a la más indicada.
# rol: Sin relación: describí acá el rol que no participa de la decisión
# rol: Influye: describí acá el rol que sufre el problema pero no decide
# rol: Decide: describí acá el rol que aprueba la compra
# Una sola línea "excluir": cuándo una empresa se descarta sin mirar lo demás.
# excluir: La empresa es competidora, ya es cliente o es proveedora
\`\`\`
`;

const HOOKS_BODY = `Esta página lista los hooks (el ángulo con el que se abre un mensaje) y los vectores (de dónde sale el contacto) de la empresa. Lo que escribas en los bloques es lo que aparece en Focos y en Métricas: no hace falta cargarlo en otro lado.

Explicá en prosa qué dice cada hook y cuándo se usa. En los bloques va el identificador (minúsculas, dígitos y guion bajo), dos puntos y el rótulo. Un vector puede llevar su hook por defecto después de " => ".

Un identificador que ya se usó no se cambia: si un hook deja de usarse, sacá su línea y queda desactivado, con su historia intacta.

Para que la página cuente: sacale el "# " a las líneas de ejemplo, reemplazalas por las tuyas y pasá la página a estado activo.

\`\`\`hooks
# h_ejemplo: Rótulo del hook de ejemplo
\`\`\`

\`\`\`vectores
# v_ejemplo: Rótulo del vector de ejemplo => h_ejemplo
\`\`\`
`;

export const DEFAULT_CANON_PAGES = [
	{
		slug: "comercial/icp",
		title: "Cliente ideal (ICP)",
		category: "comercial",
		tags: ["canon:icp"],
		body: ICP_BODY,
	},
	{
		slug: "comercial/hooks",
		title: "Hooks y vectores",
		category: "comercial",
		tags: ["canon:hooks"],
		body: HOOKS_BODY,
	},
] as const;
```

- [ ] **Step 4: Implementar la siembra**

```ts
// lib/outreach/canon-seed.ts
// Crea las páginas por defecto del canon en un brain recién creado (spec 21.3
// §3.6). Sin baseRevision el brain solo crea páginas nuevas: una que ya
// existe da conflicto y se deja como está.
import { createHash } from "node:crypto";
import { BrainConflict } from "../brain/core/errors";
import type { BrainProvider } from "../brain/core/types";
import { brainForTenant } from "./canon";
import { DEFAULT_CANON_PAGES } from "./canon-templates";

export async function seedCanonPages(
	brain: BrainProvider | null,
	userId: string,
): Promise<boolean> {
	if (!brain) return false;
	let allOk = true;
	for (const page of DEFAULT_CANON_PAGES) {
		try {
			await brain.upsert(
				{
					slug: page.slug,
					title: page.title,
					category: page.category,
					status: "borrador",
					tags: [...page.tags],
					body: page.body,
					reason: "Página por defecto al crear el brain",
				},
				{
					kind: "import",
					userId,
					sourcePath: `plantilla:${page.slug}`,
					sourceHash: createHash("sha256").update(page.body).digest("hex"),
				},
			);
		} catch (error) {
			if (error instanceof BrainConflict) continue;
			console.error(`canon: no pude crear ${page.slug}:`, error);
			allOk = false;
		}
	}
	return allOk;
}

export async function seedCanonPagesForTenant(
	tenantId: string,
	userId: string,
): Promise<boolean> {
	try {
		return await seedCanonPages(await brainForTenant(tenantId), userId);
	} catch (error) {
		console.error("canon: no pude abrir el brain para sembrarlo:", error);
		return false;
	}
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/outreach/canon-templates.test.ts tests/outreach/canon-seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Llamarla desde `createBrain`**

En `tests/plataforma/console-actions.test.ts`, agregar `seed: true as boolean | Error, seedCalls: [] as string[][],` al objeto de `vi.hoisted`, este mock junto a los otros:

```ts
vi.mock("@/lib/outreach/canon-seed", () => ({
	seedCanonPagesForTenant: async (tenantId: string, userId: string) => {
		state.seedCalls.push([tenantId, userId]);
		if (state.seed instanceof Error) throw state.seed;
		return state.seed;
	},
}));
```

`state.seed = true; state.seedCalls = [];` en el `beforeEach`, y un `describe` nuevo:

```ts
describe("createBrain: páginas por defecto", () => {
	it("después de crear el brain siembra las páginas con el actor", async () => {
		expect(await actions.createBrain("acme", TENANT)).toEqual({ ok: true });
		expect(state.seedCalls).toEqual([[TENANT, "u1"]]);
	});

	it("si crear el brain falla, no siembra", async () => {
		state.rpc = {
			data: null,
			error: { code: "23514", message: "la empresa ya tiene un brain", hint: "consola" },
		};
		await actions.createBrain("acme", TENANT);
		expect(state.seedCalls).toEqual([]);
	});

	it("si la siembra falla, avisa que el brain quedó creado", async () => {
		state.seed = false;
		expect(await actions.createBrain("acme", TENANT)).toEqual({
			ok: false,
			message:
				"El brain quedó creado, pero no pude crear las páginas por defecto. Crealas a mano en comercial/icp y comercial/hooks.",
		});
		expect(state.revalidated).toEqual(["/plataforma", "/plataforma/acme"]);
	});
});
```

Run: `npm test -- tests/plataforma/console-actions.test.ts` → FAIL (`seedCalls` vacío).

En `app/plataforma/[slug]/console-actions.ts`, agregar el import:

```ts
import { seedCanonPagesForTenant } from "@/lib/outreach/canon-seed";
```

y reemplazar el `return call(slug, "platform_bind_connection", {...});` de `createBrain` por:

```ts
	const created = await call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: "brain",
		p_provider: "wiki",
		p_connector_uids: [],
		p_config: DEFAULT_BRAIN_CONFIG,
		p_verified_name: null,
	});
	if (!created.ok) return created;
	// Carpeta y archivo por defecto para el ICP y los hooks (spec 21.3 §3.6).
	const seeded = await seedCanonPagesForTenant(tenantId, admin.userId);
	return seeded
		? created
		: {
				ok: false,
				message:
					"El brain quedó creado, pero no pude crear las páginas por defecto. Crealas a mano en comercial/icp y comercial/hooks.",
			};
```

- [ ] **Step 7: Run and commit**

Run: `npm run typecheck && npm test -- tests/plataforma tests/outreach tests/server-actions-exports.test.ts`
Expected: PASS.

```bash
git add lib/outreach/canon-templates.ts lib/outreach/canon-seed.ts "app/plataforma/[slug]/console-actions.ts" tests/outreach/canon-templates.test.ts tests/outreach/canon-seed.test.ts tests/plataforma/console-actions.test.ts
git commit -m "feat: el brain nace con las paginas por defecto del ICP y de hooks y vectores"
```

---

### Task 7: El outreach requiere brain, y el "qué falta" pide ICP y marco

**Files:**
- Modify: `lib/agents/catalog.ts`
- Modify: `lib/tenants/readiness.ts`
- Modify: `app/plataforma/[slug]/console-actions.ts` (`setAgent`)
- Modify: `app/plataforma/[slug]/page.tsx`
- Test: `tests/agents/catalog.test.ts`, `tests/tenants/readiness.test.ts`, `tests/plataforma/console-actions.test.ts`

**Interfaces:**
- Consumes: `loadIcpLevels`, `loadMarco`, `brainForTenant`, `CanonLoad` (Task 2).
- Produces:
  ```ts
  AgentCatalogEntry.requiresBrain: boolean
  type ReadinessIssue = "agentes" | "brain" | "conectores" | "verificacion" | "icp" | "marco"
  type CanonState = "ok" | "falta" | "invalido" | "sin_leer"
  canonState(load: { ok: boolean; reason?: string }): CanonState
  tenantReadiness(input: { agents; connections; canon?: { icp: CanonState; marco: CanonState } })
  ```

- [ ] **Step 1: Write the failing tests**

En `tests/agents/catalog.test.ts`, agregar:

```ts
	it("el outreach requiere brain", () => {
		expect(AGENT_CATALOG.outreach.requiresBrain).toBe(true);
	});
```

(importar `AGENT_CATALOG` de `@/lib/agents/catalog` si el archivo no lo importa ya).

En `tests/tenants/readiness.test.ts`, cambiar el import a `import { canonState, READINESS_LABELS, tenantReadiness } from "@/lib/tenants/readiness";` y agregar:

```ts
describe("ICP y marco en el brain", () => {
	it("con los dos bien, no falta nada", () => {
		expect(ok({ canon: { icp: "ok", marco: "ok" } })).toEqual({ ready: true, missing: [] });
	});

	it("ICP faltante o inválido: falta el ICP", () => {
		expect(ok({ canon: { icp: "falta", marco: "ok" } }).missing).toEqual(["icp"]);
		expect(ok({ canon: { icp: "invalido", marco: "ok" } }).missing).toEqual(["icp"]);
	});

	it("marco faltante: faltan hooks y vectores", () => {
		expect(ok({ canon: { icp: "ok", marco: "falta" } }).missing).toEqual(["marco"]);
		expect(READINESS_LABELS.marco).toBe("faltan hooks y vectores en el brain");
		expect(READINESS_LABELS.icp).toBe("falta el ICP en el brain");
	});

	it("un brain que no se pudo leer no suma motivo", () => {
		expect(ok({ canon: { icp: "sin_leer", marco: "sin_leer" } }).missing).toEqual([]);
	});

	it("sin outreach habilitado no se pide ICP ni marco", () => {
		expect(
			ok({
				agents: [{ agent: "outreach", enabled: false }],
				canon: { icp: "falta", marco: "falta" },
			}).missing,
		).toEqual(["agentes"]);
	});

	it("sin canon en la entrada (el listado) no cambia nada", () => {
		expect(ok().missing).toEqual([]);
	});

	it("canonState traduce la carga", () => {
		expect(canonState({ ok: true })).toBe("ok");
		expect(canonState({ ok: false, reason: "falta" })).toBe("falta");
		expect(canonState({ ok: false, reason: "invalido" })).toBe("invalido");
		expect(canonState({ ok: false, reason: "brain_caido" })).toBe("sin_leer");
		expect(canonState({ ok: false, reason: "sin_brain" })).toBe("sin_leer");
	});
});
```

En `tests/plataforma/console-actions.test.ts`, agregar `brainRows: [{ id: "b1" }] as { id: string }[], brainRowsError: null as { message: string } | null,` al estado, y reemplazar el `from: () => ({...})` del mock de `createAdminClient` por uno que distinga la tabla:

```ts
		from: (_table: string) => {
			const chain = {
				select: () => chain,
				eq: () => chain,
				limit: async () => ({ data: state.brainRows, error: state.brainRowsError }),
				maybeSingle: async () => ({ data: state.row, error: state.rowError }),
			};
			return chain;
		},
```

`state.brainRows = [{ id: "b1" }]; state.brainRowsError = null;` en el `beforeEach`, y dentro de `describe("setAgent", …)`:

```ts
	it("no deja habilitar el outreach sin brain habilitado", async () => {
		state.brainRows = [];
		expect(await actions.setAgent("acme", TENANT, "outreach", true, "read")).toEqual({
			ok: false,
			message: "Este agente necesita el brain. Creá el brain primero.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("deshabilitar no exige brain", async () => {
		state.brainRows = [];
		expect(await actions.setAgent("acme", TENANT, "outreach", false, "none")).toEqual({ ok: true });
	});

	it("si no puede leer las conexiones, no habilita", async () => {
		state.brainRowsError = { message: "caída" };
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await actions.setAgent("acme", TENANT, "outreach", true, "read")).toEqual(GENERICO);
		expect(state.rpcCalls).toHaveLength(0);
		log.mockRestore();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/agents/catalog.test.ts tests/tenants/readiness.test.ts tests/plataforma/console-actions.test.ts`
Expected: FAIL: `requiresBrain` undefined, `canonState` no existe, `setAgent` llama a la función sin mirar el brain.

- [ ] **Step 3: Catálogo**

En `lib/agents/catalog.ts`, agregar a `AgentCatalogEntry`:

```ts
	/** Si el agente no puede trabajar sin el brain de la empresa: la consola no
	 * lo deja habilitar hasta que haya uno (spec 21.3 §3.7). */
	requiresBrain: boolean;
```

y `requiresBrain: true,` en la entrada `outreach`, debajo de `brain: true,`.

- [ ] **Step 4: Readiness**

En `lib/tenants/readiness.ts`:

```ts
export type ReadinessIssue =
	| "agentes"
	| "brain"
	| "conectores"
	| "verificacion"
	| "icp"
	| "marco";

export const READINESS_LABELS: Record<ReadinessIssue, string> = {
	agentes: "sin agentes habilitados",
	brain: "sin brain",
	conectores: "faltan conectores",
	verificacion: "conectores sin verificar",
	icp: "falta el ICP en el brain",
	marco: "faltan hooks y vectores en el brain",
};

/** Qué se pudo leer de un bloque del canon. "sin_leer" (brain caído o sin
 * brain) no es un motivo: lo avisa la consola aparte. */
export type CanonState = "ok" | "falta" | "invalido" | "sin_leer";

export function canonState(load: { ok: boolean; reason?: string }): CanonState {
	if (load.ok) return "ok";
	return load.reason === "falta" || load.reason === "invalido"
		? load.reason
		: "sin_leer";
}
```

Cambiar la firma de `tenantReadiness` para aceptar `canon?: { icp: CanonState; marco: CanonState };` en `input`, y antes del `return` final agregar:

```ts
	// Solo si algún agente habilitado necesita el brain y el brain está: sin
	// brain ya figura "brain", y pedir además el ICP sería ruido.
	const needsCanon = enabledAgents.some(
		({ agent }) => isCatalogAgent(agent) && AGENT_CATALOG[agent].requiresBrain,
	);
	if (needsCanon && input.canon && !missing.includes("brain")) {
		if (input.canon.icp === "falta" || input.canon.icp === "invalido")
			missing.push("icp");
		if (input.canon.marco === "falta" || input.canon.marco === "invalido")
			missing.push("marco");
	}
```

- [ ] **Step 5: `setAgent`**

En `app/plataforma/[slug]/console-actions.ts`, cambiar el import del catálogo a `import { AGENT_CATALOG, isCatalogAgent } from "@/lib/agents/catalog";` y en `setAgent`, después del chequeo de `BRAIN_ACCESS` y antes del `return call(...)`:

```ts
	// El catálogo vive en código: la base no sabe qué agente necesita brain.
	if (enabled === true && AGENT_CATALOG[agent].requiresBrain) {
		const { data, error } = await createAdminClient()
			.from("tenant_connections")
			.select("id")
			.eq("tenant_id", tenantId)
			.eq("capability", "brain")
			.eq("enabled", true)
			.limit(1);
		if (error) {
			console.error("consola: no pude leer el brain:", error.message);
			return GENERICO;
		}
		if (!data || data.length === 0) {
			return {
				ok: false,
				message: "Este agente necesita el brain. Creá el brain primero.",
			};
		}
	}
```

- [ ] **Step 6: La consola le pasa el canon al "qué falta"**

En `app/plataforma/[slug]/page.tsx`, agregar imports:

```ts
import { brainForTenant, loadIcpLevels, loadMarco } from "@/lib/outreach/canon";
```

y sumar `canonState` al import existente de `@/lib/tenants/readiness`. Reemplazar la línea `const readiness = readError ? null : tenantReadiness({ agents, connections });` por:

```ts
	// El ICP y el marco solo se leen acá, en el detalle: en el listado sería
	// una lectura del brain por empresa.
	const brainEnabled = connections.some(
		(c) => c.capability === "brain" && c.enabled,
	);
	let canon: Parameters<typeof tenantReadiness>[0]["canon"];
	let brainUnreadable = false;
	if (!readError && brainEnabled) {
		try {
			const brain = await brainForTenant(tenant.id);
			const [icp, marco] = await Promise.all([
				loadIcpLevels(brain),
				loadMarco(brain),
			]);
			canon = { icp: canonState(icp), marco: canonState(marco) };
			brainUnreadable =
				(!icp.ok && icp.reason === "brain_caido") ||
				(!marco.ok && marco.reason === "brain_caido");
		} catch (error) {
			console.error("consola: no pude leer el brain:", error);
			brainUnreadable = true;
		}
	}
	const readiness = readError
		? null
		: tenantReadiness({ agents, connections, canon });
```

Y en el JSX, inmediatamente después del `</ul>` que lista `readiness.missing` (cerca de la línea 205), dentro de la misma sección, agregar:

```tsx
				{brainUnreadable ? (
					<p className="mt-2 text-muted-foreground text-sm">
						No pude leer el brain: no sé si el ICP y los hooks están cargados.
					</p>
				) : null}
```

Si esa rama del ternario exige un solo hijo, envolver el `<ul>` y este párrafo en un fragmento `<>…</>`.

Si `tests/plataforma/detail-page.test.ts` falla por el import nuevo, agregarle `vi.mock("@/lib/outreach/canon", () => ({ brainForTenant: async () => null, loadIcpLevels: async () => ({ ok: false, reason: "sin_brain", errors: [] }), loadMarco: async () => ({ ok: false, reason: "sin_brain", errors: [] }) }));`.

- [ ] **Step 7: Run and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add lib/agents/catalog.ts lib/tenants/readiness.ts "app/plataforma/[slug]/console-actions.ts" "app/plataforma/[slug]/page.tsx" tests/agents/catalog.test.ts tests/tenants/readiness.test.ts tests/plataforma
git commit -m "feat: el outreach exige brain y la consola avisa si faltan el ICP o los hooks"
```

---

### Task 8: Verificación en navegador y documentación

**Files:**
- Modify: `docs/01-roadmap-etapas.md` (Etapa 21, línea `**Spec/Plan:**` y viñeta 21.3)
- Modify: `lib/outreach/config.ts` (comentario de cabecera)

- [ ] **Step 1: Verificar en navegador con la base local**

`npm run db:reset`, y levantar el servidor con la herramienta de preview (no con Bash). Como `platform_admin`:

1. En `/plataforma/<slug>` de una empresa sin brain: habilitar el outreach tiene que responder "Este agente necesita el brain. Creá el brain primero."
2. Crear el brain: en `/<slug>/brain` aparecen `comercial/icp` y `comercial/hooks` en borrador. El "qué falta" dice "falta el ICP en el brain" y "faltan hooks y vectores en el brain".
3. Completar y activar `comercial/hooks` con dos hooks y un vector: en `/<slug>/focos`, el formulario de foco nuevo ofrece esos hooks y ese vector.
4. Sacar la línea de un hook y guardar: desaparece de Focos. Romper el bloque (un vector apuntando a un hook inexistente) y guardar: la página se guarda y Focos sigue mostrando la lista anterior.
5. Completar y activar `comercial/icp`: el "qué falta" suelta los dos motivos.

Anotar en el roadmap lo que se verificó y lo que no.

- [ ] **Step 2: Documentación**

En `docs/01-roadmap-etapas.md`, en la línea `**Spec/Plan:**` de la Etapa 21, reemplazar `21.3 a 21.5: a escribir.` por:

```
21.3: `docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md` · 21.3a: `docs/superpowers/plans/2026-10-10-etapa-21-3a-brain-como-fuente.md` · 21.3b: `docs/superpowers/plans/2026-10-10-etapa-21-3b-pantallas-outreach.md`. 21.4 y 21.5: a escribir.
```

Y reemplazar la viñeta `- [ ] **21.3 · Configuración de outreach.** ICP, listas y presupuestos desde la UI.` por:

```
- [ ] **21.3 · Configuración de outreach.** 21.3a (código terminado): el ICP, los hooks y los vectores viven en el brain. El scoring lee el bloque `icp` de la página `canon:icp`; guardar o borrar una página `canon:hooks` refleja sus bloques `hooks` y `vectores` en `config_values`; el brain nace con `comercial/icp` y `comercial/hooks` en borrador; el outreach no se habilita sin brain. **Antes de desplegar:** pegar los bloques en las páginas de canon de `innovas` (spec §10), y aplicar `20261017120000_outreach_marco_reflect` antes que el código (`npx supabase migration list` primero). Después del deploy, volver a guardar una página `canon:hooks` de `innovas` y comprobar que no desactiva nada. 21.3b: pantallas del cliente, presupuestos y retiro de `outreach:config` y `workflows:set`.
```

En `lib/outreach/config.ts`, reemplazar las dos líneas del comentario de cabecera por:

```ts
// Configuración de outreach por tenant (spec 03 §4.3 y §4.8). Los niveles del
// ICP no están acá: viven en el brain (spec 21.3 O1). Solo importa zod: lo
// usa scripts/outreach-config.mts con type stripping de Node.
```

- [ ] **Step 3: Chequeo final y commit**

Run: `npm run lint:fix && npm run typecheck && npm test && npm run db:test`
Expected: todo PASS. Revertir con `git checkout --` los archivos que `lint:fix` haya tocado fuera de este plan.

```bash
git add docs/01-roadmap-etapas.md lib/outreach/config.ts
git commit -m "docs: la 21.3a deja el ICP, los hooks y los vectores en el brain"
```
