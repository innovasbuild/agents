# Etapa 17.3 · Árbol y compartir del brain — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador del tenant restrinja una carpeta o página del brain y le dé acceso a personas concretas desde la interfaz: árbol de navegación estilo Obsidian, menú de tres puntos por fila y diálogo de compartir, con cada cambio auditado.

**Architecture:** La lógica nueva es pura y vive en `lib/brain/core/access/` (`tree.ts`, `explain.ts`, `manage.ts`), con dependencias inyectadas como `savePage`. Los cambios de reglas pasan por dos funciones SQL que escriben la regla y el evento `brain.access_changed` en una sola transacción. Tres server actions (`access-actions.ts`) validan con `zod` en el borde y llaman a `manage.ts`. La interfaz es un `layout.tsx` nuevo bajo `app/[tenant]/brain/` que arma el árbol en el servidor con lo que el proveedor envuelto deja ver; el plegado y el diálogo son componentes cliente.

**Tech Stack:** TypeScript, Next.js App Router (server actions), Supabase (Postgres, pgTAP), Vitest (entorno `node`, solo `*.test.ts`), shadcn/ui sobre `radix-ui`, Tailwind, Biome.

**Spec:** `docs/superpowers/specs/2026-10-05-etapa-17-permisos-brain-design.md` §3.5 (visibilidad del árbol), §3.6 (funciones puras), §4.4 (evento), §7 (pantallas), §8 (entrega 17.3). Base: 17.1 (PR 73) y 17.2 (PR 74), ya en `main` y en producción.

## Global Constraints

- Tres niveles: `lector`, `editor`, `administrador` (A1). Solo un administrador del nodo cambia reglas del nodo y de lo que cuelga (§3.4).
- Las carpetas no son filas (A5): una carpeta es el prefijo de las páginas que tiene debajo. Una regla sobre `comercial/icp` aplica a la página con ese slug y a todo lo que cuelgue de `comercial/icp/` (A6).
- Las reglas por persona se acumulan hacia abajo y no se quitan abajo (A7): el diálogo no edita las heredadas.
- Lo invisible responde `not_found`, nunca `forbidden` (A8): una acción sobre un nodo que la persona no ve responde como si no existiera.
- Sin mails, notificaciones ni "copiar vínculo" al compartir (A12).
- Cada cambio de reglas deja `brain.access_changed` en `events` con `payload: { path, principal, user_id, level, action: "set" | "remove" }` y `actor_user_id`. `events` es append-only.
- Falla cerrada: si las reglas no se pueden cargar, la acción falla; nunca se trata como "sin reglas".
- Toda tabla lleva `tenant_id` y RLS. Antes de tocar SQL se cargó `supabase-postgres-best-practices`: funciones solo para `service_role`, `search_path` vacío, objetos con esquema.
- `lib/brain/core` no importa nada fuera de `lib/brain/core`, salvo `zod`, `yaml`, `@modelcontextprotocol/sdk/*`, `node:*` y, solo como `import type`, `@supabase/supabase-js`. Lo vigila `tests/brain/boundary.test.ts`. Los imports relativos dentro de `core/access/` llevan extensión `.ts`.
- El árbol que viaja al navegador contiene solo `{ path, name, page: { slug, title, status } | null, level, children }`: nunca cuerpos de página ni reglas.
- UI en español rioplatense; código e identificadores en inglés. Estilo shadcn con la marca del tenant (variables CSS ya existentes, sin colores fijos). A 375 px: sin scroll horizontal de página y objetivos táctiles de al menos 44 px (`min-h-11`).
- Tool nueva en `agents/outreach/tools/`: no aplica; esta etapa no agrega tools.
- Commits con prefijo `feat:` / `fix:` / `refactor:` / `test:` / `docs:` y el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No correr `npm run lint:fix` sobre todo el repo (reformatea archivos ajenos). Formatear solo lo que se edita: `npx biome check --write <archivos>`; si Biome reformatea código ajeno al cambio, revertir ese hunk.
- Toda tarea se ejecuta con `cd` al worktree `/Users/mok/Sites/innovas/agents/.claude/worktrees/etapa-17-3-arbol-compartir`; antes de commitear verificar `git rev-parse --show-toplevel` y la rama `feat/etapa-17-3-arbol-compartir`.

## Desvíos respecto de la spec

1. **`visibleTree` recibe `access(path)` y no `(rules, principal)`.** El editor ya tiene esa función en el contexto (`ctx.access`) y así las reglas no salen del servidor. El resultado es el mismo.
2. **Un nodo del árbol puede ser carpeta y página a la vez** (A6: `comercial/icp` y `comercial/icp/objeciones`). La spec habla de "carpetas y hojas"; el nodo único con `page` opcional y `children` es lo que representa A6 sin duplicar filas.
3. **Un tipo aparte, `AccessRulesWriter`**, en lugar de sumar `set/remove` a `AccessRulesStore`: así los dobles de prueba de `load` de la 17.2 no cambian. `createSupabaseAccessRulesWriter` vive junto a `createSupabaseAccessRulesStore`.
4. **La regla y el evento se escriben en una función SQL** (`brain_set_access_rule`, `brain_remove_access_rule`) y no con dos llamadas desde TypeScript: o quedan las dos cosas o ninguna. Hay una migración nueva: va a producción **antes** que el código (mismo orden que la 17.2).
5. **El diálogo carga su estado con una server action de lectura** (`getShareState`), al abrirse. Las reglas del tenant no viajan al navegador con cada página.
6. **Chequeo de autoexclusión generalizado.** La spec pide que un `tenant_member` administrador de un nodo no quite ni baje su propia regla. Se implementa como invariante: tras aplicar el cambio en memoria, quien lo hace sigue siendo administrador del nodo; si no, se rechaza con `lockout`. Cubre también bajar el acceso general que le daba el permiso.
7. **El índice de `/brain` sin consulta** lista las páginas de primer nivel y las carpetas; cada carpeta lleva a `/brain?carpeta=<ruta>`, que lista las páginas de ese prefijo. La spec dice "llevan al árbol"; el árbol ya está siempre visible a la izquierda, así que el enlace filtra el listado.
8. **`/brain/nueva` se habilita si la persona es editor de alguna carpeta** (no solo de la raíz) y valida el prefijo `?en=` contra las carpetas editables. El permiso real lo sigue decidiendo `withAccess` al guardar.

## Review Focus

Entradas que la spec implica y ninguna tarea prueba por sí sola; cada una tiene su test en la tarea que se indica.

1. Una persona con acceso solo a `direccion/presupuesto-2027` ve la carpeta `direccion` con esa única hoja y ninguna hermana; la carpeta no ofrece "Nueva página acá" ni "Compartir" (nivel `null`). → Tarea 1.
2. Una página y una carpeta con el mismo nombre son un solo nodo con página e hijos; compartirlo cambia las reglas de ambos. → Tarea 1 y Tarea 4.
3. Un `tenant_member` administrador de un nodo que intenta quitarse la regla propia, bajársela o restringir el acceso general que lo hace administrador recibe `lockout` y no se escribe nada. → Tarea 4.
4. Dar acceso dos veces a la misma persona en el mismo nodo cambia el nivel y no duplica la fila; cada cambio deja exactamente un evento. → Tarea 2.
5. Un `userId` de otro tenant, de un `tenant_admin` o de nadie se rechaza; una ruta inventada (sin páginas ni reglas debajo) responde `not_found`; `inherit` sobre la raíz se rechaza. → Tarea 4.
6. El árbol serializado no contiene cuerpos de página. → Tarea 1.
7. `/brain/nueva?en=` con una ruta que no es editable o no es un slug válido se ignora en vez de precargarla. → Tarea 7.

---

### Task 1: Funciones puras del árbol y de la vista de acceso

**Files:**
- Create: `lib/brain/core/access/tree.ts`
- Create: `lib/brain/core/access/explain.ts`
- Test: `tests/brain/access-tree.test.ts`
- Test: `tests/brain/access-explain.test.ts`

**Interfaces:**
- Consumes: `ancestorChain`, `parentPath` de `./resolve-access.ts`; `Level`, `RuleLevel`, `AccessRule`, `ROOT_PATH`, `atLeast` de `./types.ts`; `BrainStatus` de `../types.ts`.
- Produces (Tareas 4, 5, 6, 7):
  - `interface TreePage { slug: string; title: string; status: BrainStatus }`
  - `interface TreeNode { path: string; name: string; page: TreePage | null; level: Level | null; children: TreeNode[] }`
  - `visibleTree(pages: Array<TreePage & Record<string, unknown>>, access: (path: string) => Level | null): TreeNode`
  - `withoutArchived(root: TreeNode): TreeNode`
  - `editableFolders(root: TreeNode): string[]`
  - `explainAccess(rules: AccessRule[], path: string): NodeAccessView` y los tipos `PersonRule`, `InheritedPersonRule`, `GeneralAccessView`, `NodeAccessView`.

- [ ] **Step 1: Escribir los tests del árbol**

`tests/brain/access-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import {
	editableFolders,
	visibleTree,
	withoutArchived,
} from "@/lib/brain/core/access/tree";
import type {
	AccessRule,
	Principal,
} from "@/lib/brain/core/access/types";

const ana: Principal = {
	kind: "user",
	userId: "ana",
	role: "tenant_member",
};
const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (
	path: string,
	userId: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "user", userId, level });

const page = (slug: string, status: "activo" | "borrador" | "archivado" = "activo") => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	status,
	body: "contenido que no debe viajar",
	tags: [],
});
const accessFor = (rules: AccessRule[], who: Principal = ana) => (path: string) =>
	resolveAccess(rules, who, path);

describe("visibleTree", () => {
	it("una persona con acceso a una sola página profunda ve la carpeta con esa hoja y nada más", () => {
		const rules = [
			members("", "lector"),
			members("direccion", "ninguno"),
			user("direccion/presupuesto-2027", "ana", "editor"),
		];
		const tree = visibleTree(
			[
				page("comercial/icp"),
				page("direccion/estrategia"),
				page("direccion/presupuesto-2027"),
			],
			accessFor(rules),
		);
		expect(tree.children.map((n) => n.name)).toEqual(["comercial", "direccion"]);
		const direccion = tree.children[1];
		expect(direccion.level).toBeNull();
		expect(direccion.children.map((n) => n.path)).toEqual([
			"direccion/presupuesto-2027",
		]);
		expect(direccion.children[0].level).toBe("editor");
	});

	it("una página y una carpeta con el mismo nombre son un solo nodo", () => {
		const tree = visibleTree(
			[page("comercial/icp"), page("comercial/icp/objeciones")],
			accessFor([members("", "lector")]),
		);
		const icp = tree.children[0].children[0];
		expect(icp.path).toBe("comercial/icp");
		expect(icp.page?.slug).toBe("comercial/icp");
		expect(icp.children.map((n) => n.path)).toEqual([
			"comercial/icp/objeciones",
		]);
	});

	it("ordena primero lo que tiene hijos y después por nombre", () => {
		const tree = visibleTree(
			[page("zeta"), page("alfa"), page("carpeta/uno")],
			accessFor([members("", "lector")]),
		);
		expect(tree.children.map((n) => n.name)).toEqual([
			"carpeta",
			"alfa",
			"zeta",
		]);
	});

	it("no copia el cuerpo ni los demás campos de la página", () => {
		const tree = visibleTree(
			[page("comercial/icp")],
			accessFor([members("", "lector")]),
		);
		const leaf = tree.children[0].children[0];
		expect(leaf.page).toEqual({
			slug: "comercial/icp",
			title: "icp",
			status: "activo",
		});
		expect(JSON.stringify(tree)).not.toContain("contenido que no debe viajar");
	});

	it("un administrador ve todo con nivel administrador", () => {
		const admin: Principal = { kind: "user", userId: "x", role: "tenant_admin" };
		const tree = visibleTree([page("a/b")], accessFor([], admin));
		expect(tree.level).toBe("administrador");
		expect(tree.children[0].level).toBe("administrador");
	});
});

describe("withoutArchived", () => {
	it("saca las archivadas y las carpetas que quedan vacías", () => {
		const tree = visibleTree(
			[
				page("vieja/a", "archivado"),
				page("mixta/a", "archivado"),
				page("mixta/b"),
			],
			accessFor([members("", "lector")]),
		);
		const clean = withoutArchived(tree);
		expect(clean.children.map((n) => n.name)).toEqual(["mixta"]);
		expect(clean.children[0].children.map((n) => n.name)).toEqual(["b"]);
	});

	it("una página archivada con hijos activos queda como carpeta sin página", () => {
		const tree = visibleTree(
			[page("x", "archivado"), page("x/y")],
			accessFor([members("", "lector")]),
		);
		const x = withoutArchived(tree).children[0];
		expect(x.page).toBeNull();
		expect(x.children.map((n) => n.path)).toEqual(["x/y"]);
	});
});

describe("editableFolders", () => {
	it("lista la raíz y las carpetas donde la persona es editor", () => {
		const rules = [members("", "lector"), user("comercial", "ana", "editor")];
		const tree = visibleTree(
			[page("comercial/icp"), page("legal/contrato"), page("suelta")],
			accessFor(rules),
		);
		expect(editableFolders(tree)).toEqual(["comercial"]);
	});

	it("incluye la raíz si es editor de ella", () => {
		const tree = visibleTree(
			[page("a/b")],
			accessFor([members("", "editor")]),
		);
		expect(editableFolders(tree)).toEqual(["", "a"]);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/access-tree.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/brain/core/access/tree"`.

- [ ] **Step 3: Implementar `tree.ts`**

`lib/brain/core/access/tree.ts`:

```ts
// Árbol de navegación del brain (spec etapa 17 §3.5, §7.1). Puro: recibe las
// páginas que la persona puede ver y una función de permiso por ruta; no
// conoce reglas ni principales. Una carpeta es el prefijo de las páginas que
// tiene debajo (A5); una página y una carpeta con el mismo nombre comparten
// nodo (A6).
import type { BrainStatus } from "../types.ts";
import { ancestorChain } from "./resolve-access.ts";
import { atLeast, type Level, ROOT_PATH } from "./types.ts";

export interface TreePage {
	slug: string;
	title: string;
	status: BrainStatus;
}

export interface TreeNode {
	path: string; // "" para la raíz
	name: string; // último segmento de la ruta
	page: TreePage | null; // hay una página con exactamente este slug
	// Permiso sobre el nodo. null cuando la persona solo ve algo más abajo: la
	// carpeta se muestra pero no ofrece acciones propias.
	level: Level | null;
	children: TreeNode[];
}

function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

// Primero lo que tiene hijos (las carpetas), después por nombre.
function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		const folders = Number(b.children.length > 0) - Number(a.children.length > 0);
		return folders !== 0 ? folders : a.name.localeCompare(b.name, "es");
	});
	for (const node of nodes) sortNodes(node.children);
}

export function visibleTree(
	pages: Array<TreePage & Record<string, unknown>>,
	access: (path: string) => Level | null,
): TreeNode {
	const root: TreeNode = {
		path: ROOT_PATH,
		name: "",
		page: null,
		level: access(ROOT_PATH),
		children: [],
	};
	const byPath = new Map<string, TreeNode>([[ROOT_PATH, root]]);

	for (const page of pages) {
		if (access(page.slug) === null) continue;
		let parent = root;
		for (const path of ancestorChain(page.slug).slice(1)) {
			let node = byPath.get(path);
			if (!node) {
				node = {
					path,
					name: lastSegment(path),
					page: null,
					level: access(path),
					children: [],
				};
				byPath.set(path, node);
				parent.children.push(node);
			}
			parent = node;
		}
		// Solo estos tres campos viajan al navegador: nunca el cuerpo.
		parent.page = { slug: page.slug, title: page.title, status: page.status };
	}

	sortNodes(root.children);
	return root;
}

// Oculta las archivadas y las carpetas que quedan sin nada visible.
export function withoutArchived(root: TreeNode): TreeNode {
	const prune = (node: TreeNode): TreeNode | null => {
		const children = node.children
			.map(prune)
			.filter((child): child is TreeNode => child !== null);
		const page = node.page?.status === "archivado" ? null : node.page;
		if (node.path !== ROOT_PATH && page === null && children.length === 0) {
			return null;
		}
		return { ...node, page, children };
	};
	return prune(root) ?? { ...root, page: null, children: [] };
}

// Rutas donde la persona puede crear páginas: la raíz y las carpetas (nodos
// con hijos) sobre las que es editor o más.
export function editableFolders(root: TreeNode): string[] {
	const found: string[] = [];
	const walk = (node: TreeNode) => {
		const isFolder = node.path === ROOT_PATH || node.children.length > 0;
		if (isFolder && atLeast(node.level, "editor")) found.push(node.path);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return found;
}
```

- [ ] **Step 4: Correr el test del árbol**

Run: `npx vitest run tests/brain/access-tree.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Escribir los tests de `explainAccess`**

`tests/brain/access-explain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { explainAccess } from "@/lib/brain/core/access/explain";
import type { AccessRule } from "@/lib/brain/core/access/types";

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (
	path: string,
	userId: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "user", userId, level });

describe("explainAccess", () => {
	it("sin reglas, el acceso general efectivo es lector por defecto", () => {
		expect(explainAccess([], "comercial")).toEqual({
			path: "comercial",
			own: [],
			inherited: [],
			general: {
				own: null,
				inherited: { level: "lector", from: null },
				effective: "lector",
			},
		});
	});

	it("separa las reglas propias de las heredadas y dice de dónde vienen", () => {
		const rules = [
			members("", "lector"),
			user("comercial", "ana", "editor"),
			user("comercial/icp", "beto", "lector"),
		];
		const view = explainAccess(rules, "comercial/icp");
		expect(view.own).toEqual([{ userId: "beto", level: "lector" }]);
		expect(view.inherited).toEqual([
			{ userId: "ana", level: "editor", from: "comercial" },
		]);
		expect(view.general.inherited).toEqual({ level: "lector", from: "" });
	});

	it("el acceso general propio gana sobre el heredado", () => {
		const rules = [members("", "lector"), members("legal", "ninguno")];
		const view = explainAccess(rules, "legal");
		expect(view.general).toEqual({
			own: "ninguno",
			inherited: { level: "lector", from: "" },
			effective: "ninguno",
		});
	});

	it("hereda del ancestro más cercano que tenga acceso general", () => {
		const rules = [
			members("", "lector"),
			members("legal", "ninguno"),
			members("legal/contratos", "editor"),
		];
		const view = explainAccess(rules, "legal/contratos/2027");
		expect(view.general.inherited).toEqual({
			level: "editor",
			from: "legal/contratos",
		});
		expect(view.general.effective).toBe("editor");
	});

	it("de una persona con reglas en varios ancestros muestra el nivel más alto", () => {
		const rules = [
			user("a", "ana", "lector"),
			user("a/b", "ana", "administrador"),
		];
		expect(explainAccess(rules, "a/b/c").inherited).toEqual([
			{ userId: "ana", level: "administrador", from: "a/b" },
		]);
	});

	it("la raíz no hereda nada", () => {
		const view = explainAccess([members("", "editor")], "");
		expect(view.general).toEqual({
			own: "editor",
			inherited: { level: "lector", from: null },
			effective: "editor",
		});
		expect(view.inherited).toEqual([]);
	});
});
```

- [ ] **Step 6: Implementar `explain.ts`**

`lib/brain/core/access/explain.ts`:

```ts
// Vista de un nodo para el diálogo de compartir (spec etapa 17 §7.3): reglas
// propias, heredadas con su origen y acceso general efectivo. Pura.
import { parentPath } from "./resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	type Level,
	type RuleLevel,
} from "./types.ts";

export interface PersonRule {
	userId: string;
	level: Level;
}

export interface InheritedPersonRule extends PersonRule {
	from: string; // ruta del ancestro donde se dio
}

export interface GeneralAccessView {
	own: RuleLevel | null; // null = hereda
	// Lo que hereda: from es la ruta del ancestro, o null si no hay ninguna
	// fila (el valor por defecto es lector).
	inherited: { level: RuleLevel; from: string | null };
	effective: RuleLevel;
}

export interface NodeAccessView {
	path: string;
	own: PersonRule[];
	inherited: InheritedPersonRule[];
	general: GeneralAccessView;
}

function strictAncestors(path: string): string[] {
	const found: string[] = [];
	for (let n = parentPath(path); n !== null; n = parentPath(n)) found.push(n);
	return found; // del más cercano a la raíz
}

export function explainAccess(
	rules: AccessRule[],
	path: string,
): NodeAccessView {
	const userRules = rules.filter(
		(r): r is AccessRule & { userId: string; level: Level } =>
			r.principal === "user" && r.userId !== null && r.level !== "ninguno",
	);

	const own = userRules
		.filter((r) => r.path === path)
		.map(({ userId, level }) => ({ userId, level }));

	// Por persona, la regla más alta de los ancestros; si empatan, la más cercana.
	const ancestors = strictAncestors(path);
	const best = new Map<string, InheritedPersonRule>();
	for (const from of [...ancestors].reverse()) {
		for (const r of userRules.filter((x) => x.path === from)) {
			const current = best.get(r.userId);
			if (!current || !atLeast(current.level, r.level)) {
				best.set(r.userId, { userId: r.userId, level: r.level, from });
			} else if (current.level === r.level) {
				best.set(r.userId, { userId: r.userId, level: r.level, from });
			}
		}
	}

	const ownGeneral =
		rules.find((r) => r.principal === "members" && r.path === path)?.level ??
		null;
	let inherited: GeneralAccessView["inherited"] = {
		level: "lector",
		from: null,
	};
	for (const from of ancestors) {
		const rule = rules.find((r) => r.principal === "members" && r.path === from);
		if (rule) inherited = { level: rule.level, from };
	}

	return {
		path,
		own,
		inherited: [...best.values()],
		general: {
			own: ownGeneral,
			inherited,
			effective: ownGeneral ?? inherited.level,
		},
	};
}
```

- [ ] **Step 7: Correr ambos tests, tipos y frontera**

Run: `npx vitest run tests/brain/access-tree.test.ts tests/brain/access-explain.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 8: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/access/tree.ts lib/brain/core/access/explain.ts tests/brain/access-tree.test.ts tests/brain/access-explain.test.ts
git add lib/brain/core/access/tree.ts lib/brain/core/access/explain.ts tests/brain/access-tree.test.ts tests/brain/access-explain.test.ts
git commit -m "feat: árbol visible y vista de acceso por nodo, funciones puras de la 17.3

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Funciones SQL que escriben la regla y el evento

**Files:**
- Create: `supabase/migrations/20261008120000_brain_access_rule_fns.sql`
- Create: `supabase/tests/22_brain_access_rule_fns.test.sql`
- Modify: `lib/supabase/database.types.ts` (solo las dos funciones nuevas)

**Interfaces:**
- Consumes: tabla `brain_access_rules` y tipos `brain_access_principal`, `brain_access_level` de `20261007120000_brain_access_rules.sql`; tabla `events`.
- Produces (Tarea 3): RPC `brain_set_access_rule(p_tenant_id uuid, p_path text, p_principal brain_access_principal, p_user_id uuid, p_level brain_access_level, p_actor uuid) returns void` y `brain_remove_access_rule(p_tenant_id uuid, p_path text, p_principal brain_access_principal, p_user_id uuid, p_actor uuid) returns void`, ejecutables solo por `service_role`.

- [ ] **Step 1: Escribir la prueba pgTAP**

`supabase/tests/22_brain_access_rule_fns.test.sql`:

```sql
-- supabase/tests/22_brain_access_rule_fns.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a3a3a3a3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@fns-a.test', now()),
  ('a3a3a3a3-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'adm@fns-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b3b3b3b3-0000-0000-0000-00000000000a', 'fns-a', 'Fns A');

select has_function('public', 'brain_set_access_rule',
  array['uuid', 'text', 'brain_access_principal', 'uuid', 'brain_access_level', 'uuid'],
  'existe brain_set_access_rule');
select has_function('public', 'brain_remove_access_rule',
  array['uuid', 'text', 'brain_access_principal', 'uuid', 'uuid'],
  'existe brain_remove_access_rule');

select ok(
  not has_function_privilege('authenticated',
    'public.brain_set_access_rule(uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid)',
    'execute'),
  'authenticated no puede ejecutar brain_set_access_rule'
);
select ok(
  has_function_privilege('service_role',
    'public.brain_set_access_rule(uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid)',
    'execute'),
  'service_role ejecuta brain_set_access_rule'
);

select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'lector', 'a3a3a3a3-0000-0000-0000-000000000002');

select is(
  (select level::text from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  'lector',
  'set crea la regla por persona'
);

select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'editor', 'a3a3a3a3-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  1,
  'dar acceso dos veces a la misma persona no duplica la fila'
);
select is(
  (select level::text from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'comercial'
      and user_id = 'a3a3a3a3-0000-0000-0000-000000000001'),
  'editor',
  'la segunda llamada cambia el nivel'
);

-- Acceso general: user_id nulo cuenta como igual (índice nulls not distinct).
select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'legal', 'members', null, 'ninguno',
  'a3a3a3a3-0000-0000-0000-000000000002');
select public.brain_set_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'legal', 'members', null, 'lector',
  'a3a3a3a3-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.brain_access_rules
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a' and path = 'legal'),
  1,
  'el acceso general de un nodo es una sola fila'
);

select is(
  (select count(*)::int from public.events
    where tenant_id = 'b3b3b3b3-0000-0000-0000-00000000000a'
      and type = 'brain.access_changed'),
  4,
  'cada set deja exactamente un evento'
);

select public.brain_remove_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000002');
select public.brain_remove_access_rule(
  'b3b3b3b3-0000-0000-0000-00000000000a', 'comercial', 'user',
  'a3a3a3a3-0000-0000-0000-000000000001', 'a3a3a3a3-0000-0000-0000-000000000002');

select results_eq(
  $$select payload->>'action', payload->>'path', payload->>'level'
      from public.events
     where type = 'brain.access_changed' and payload->>'action' = 'remove'$$,
  $$values ('remove'::text, 'comercial'::text, null::text)$$,
  'quitar una regla que existe deja un evento remove, y quitar una que ya no existe no deja otro'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run (Docker abierto): `npm run db:start` si hace falta, después `npm run db:test`
Expected: FAIL en `22_brain_access_rule_fns` — no existe `brain_set_access_rule`.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20261008120000_brain_access_rule_fns.sql`:

```sql
-- Cambios de reglas de acceso del brain (spec etapa 17 §4.4). La regla y el
-- evento brain.access_changed se escriben en una transacción: o quedan las dos
-- cosas o ninguna. Solo las ejecuta el servidor (service_role).

create or replace function public.brain_set_access_rule(
  p_tenant_id uuid,
  p_path text,
  p_principal public.brain_access_principal,
  p_user_id uuid,
  p_level public.brain_access_level,
  p_actor uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.brain_access_rules (tenant_id, path, principal, user_id, level, created_by)
  values (p_tenant_id, p_path, p_principal, p_user_id, p_level, p_actor)
  on conflict (tenant_id, path, principal, user_id)
  do update set level = excluded.level, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.access_changed',
    coalesce(nullif(p_path, ''), '(raíz)'),
    jsonb_build_object(
      'path', p_path,
      'principal', p_principal,
      'user_id', p_user_id,
      'level', p_level,
      'action', 'set'
    )
  );
end;
$$;

create or replace function public.brain_remove_access_rule(
  p_tenant_id uuid,
  p_path text,
  p_principal public.brain_access_principal,
  p_user_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.brain_access_rules
  where tenant_id = p_tenant_id
    and path = p_path
    and principal = p_principal
    and user_id is not distinct from p_user_id;

  -- Quitar lo que ya no está no cambia nada: no deja evento.
  if not found then
    return;
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (
    p_tenant_id, p_actor, 'brain.access_changed',
    coalesce(nullif(p_path, ''), '(raíz)'),
    jsonb_build_object(
      'path', p_path,
      'principal', p_principal,
      'user_id', p_user_id,
      'level', null,
      'action', 'remove'
    )
  );
end;
$$;

revoke execute on function public.brain_set_access_rule(
  uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid
) from public, anon, authenticated;
revoke execute on function public.brain_remove_access_rule(
  uuid, text, public.brain_access_principal, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.brain_set_access_rule(
  uuid, text, public.brain_access_principal, uuid, public.brain_access_level, uuid
) to service_role;
grant execute on function public.brain_remove_access_rule(
  uuid, text, public.brain_access_principal, uuid, uuid
) to service_role;
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npm run db:test`
Expected: PASS, incluidos los 11 de `22_brain_access_rule_fns` y sin regresiones en `21_brain_access_rules`. Si `on conflict (tenant_id, path, principal, user_id)` no infiere el índice con `nulls not distinct`, el error lo dice acá: en ese caso usar `on conflict on constraint` no aplica (es un índice, no una constraint); cambiar a `delete` + `insert` dentro de la misma función y dejar el resto igual.

- [ ] **Step 5: Regenerar los tipos y quedarse solo con las dos funciones**

```bash
npm run db:types
git diff --stat lib/supabase/database.types.ts
```

El generador suele meter deriva ajena (`ComputedFields: never` y similares). Revisar el diff: conservar solo las entradas nuevas de `Functions` (`brain_set_access_rule`, `brain_remove_access_rule`) y revertir cualquier otro hunk con `git checkout -p lib/supabase/database.types.ts`.

- [ ] **Step 6: Commitear**

```bash
git add supabase/migrations/20261008120000_brain_access_rule_fns.sql supabase/tests/22_brain_access_rule_fns.test.sql lib/supabase/database.types.ts
git commit -m "feat: funciones SQL que cambian una regla del brain y dejan su evento en la misma transacción

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Escritor de reglas

**Files:**
- Modify: `lib/brain/core/access/types.ts` (agrega `AccessRuleKey`, `AccessRulesWriter`)
- Modify: `lib/brain/core/access/rules-store.ts` (agrega `createSupabaseAccessRulesWriter`)
- Modify: `lib/brain/adapters/access-rules.ts` (agrega `accessRulesWriter`)
- Test: `tests/brain/access-rules-writer.test.ts`

**Interfaces:**
- Consumes: RPC de la Tarea 2; `AccessRule` de `types.ts`.
- Produces (Tareas 4, 5):
  - `interface AccessRuleKey { path: string; principal: "user" | "members"; userId: string | null }`
  - `interface AccessRulesWriter { set(tenantId: string, rule: AccessRule, actorUserId: string): Promise<void>; remove(tenantId: string, key: AccessRuleKey, actorUserId: string): Promise<void> }`
  - `createSupabaseAccessRulesWriter(client: SupabaseClient): AccessRulesWriter`
  - `accessRulesWriter(): AccessRulesWriter` (cliente admin)

- [ ] **Step 1: Escribir el test**

`tests/brain/access-rules-writer.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseAccessRulesWriter } from "@/lib/brain/core/access/rules-store";

function fakeClient(error: { message: string } | null = null) {
	const rpc = vi.fn(async () => ({ data: null, error }));
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("createSupabaseAccessRulesWriter", () => {
	it("set llama a brain_set_access_rule con los nombres de la función", async () => {
		const { client, rpc } = fakeClient();
		await createSupabaseAccessRulesWriter(client).set(
			"t1",
			{ path: "comercial", principal: "user", userId: "u1", level: "editor" },
			"admin1",
		);
		expect(rpc).toHaveBeenCalledWith("brain_set_access_rule", {
			p_tenant_id: "t1",
			p_path: "comercial",
			p_principal: "user",
			p_user_id: "u1",
			p_level: "editor",
			p_actor: "admin1",
		});
	});

	it("remove llama a brain_remove_access_rule", async () => {
		const { client, rpc } = fakeClient();
		await createSupabaseAccessRulesWriter(client).remove(
			"t1",
			{ path: "", principal: "members", userId: null },
			"admin1",
		);
		expect(rpc).toHaveBeenCalledWith("brain_remove_access_rule", {
			p_tenant_id: "t1",
			p_path: "",
			p_principal: "members",
			p_user_id: null,
			p_actor: "admin1",
		});
	});

	it("si la base falla, lanza: el cambio no se da por hecho", async () => {
		const { client } = fakeClient({ message: "boom" });
		await expect(
			createSupabaseAccessRulesWriter(client).set(
				"t1",
				{ path: "a", principal: "members", userId: null, level: "lector" },
				"admin1",
			),
		).rejects.toThrow(/boom/);
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/access-rules-writer.test.ts`
Expected: FAIL — `createSupabaseAccessRulesWriter` no existe.

- [ ] **Step 3: Agregar los tipos**

En `lib/brain/core/access/types.ts`, debajo de `AccessRulesStore`:

```ts
// Identifica una regla sin su nivel: lo que hace falta para quitarla.
export interface AccessRuleKey {
	path: string;
	principal: "user" | "members";
	userId: string | null;
}

// Escritura de reglas (spec etapa 17 §7.4). Cada cambio deja también su
// evento brain.access_changed, en la misma transacción.
export interface AccessRulesWriter {
	set(tenantId: string, rule: AccessRule, actorUserId: string): Promise<void>;
	remove(
		tenantId: string,
		key: AccessRuleKey,
		actorUserId: string,
	): Promise<void>;
}
```

- [ ] **Step 4: Implementar el escritor**

En `lib/brain/core/access/rules-store.ts`, cambiar el import de tipos a `import type { AccessRule, AccessRulesStore, AccessRulesWriter, RuleLevel } from "./types.ts";` y agregar al final:

```ts
export function createSupabaseAccessRulesWriter(
	client: SupabaseClient,
): AccessRulesWriter {
	return {
		async set(tenantId, rule, actorUserId) {
			const { error } = await client.rpc("brain_set_access_rule", {
				p_tenant_id: tenantId,
				p_path: rule.path,
				p_principal: rule.principal,
				p_user_id: rule.userId,
				p_level: rule.level,
				p_actor: actorUserId,
			});
			if (error) {
				throw new Error(
					`No pude guardar el permiso del brain: ${error.message}`,
				);
			}
		},
		async remove(tenantId, key, actorUserId) {
			const { error } = await client.rpc("brain_remove_access_rule", {
				p_tenant_id: tenantId,
				p_path: key.path,
				p_principal: key.principal,
				p_user_id: key.userId,
				p_actor: actorUserId,
			});
			if (error) {
				throw new Error(
					`No pude quitar el permiso del brain: ${error.message}`,
				);
			}
		},
	};
}
```

- [ ] **Step 5: Cablear el adaptador**

En `lib/brain/adapters/access-rules.ts`: importar `createSupabaseAccessRulesWriter` y `AccessRulesWriter`, y agregar:

```ts
export function accessRulesWriter(): AccessRulesWriter {
	return createSupabaseAccessRulesWriter(createAdminClient());
}
```

- [ ] **Step 6: Correr tests, frontera y tipos**

Run: `npx vitest run tests/brain/access-rules-writer.test.ts tests/brain/access-rules-store.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 7: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/access/types.ts lib/brain/core/access/rules-store.ts lib/brain/adapters/access-rules.ts tests/brain/access-rules-writer.test.ts
git add lib/brain/core/access/types.ts lib/brain/core/access/rules-store.ts lib/brain/adapters/access-rules.ts tests/brain/access-rules-writer.test.ts
git commit -m "feat: escritor de reglas de acceso del brain sobre las funciones SQL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gestión de permisos (núcleo) y server actions

**Files:**
- Create: `lib/brain/core/access/manage.ts`
- Create: `lib/brain/adapters/access-admin.ts`
- Create: `app/[tenant]/brain/access-actions.ts`
- Test: `tests/brain/access-manage.test.ts`
- Test: `tests/brain/access-actions.test.ts`

**Interfaces:**
- Consumes: `resolveAccess` (`./resolve-access.ts`), `explainAccess`/`NodeAccessView` (Tarea 1), `AccessRulesStore`/`AccessRulesWriter` (Tarea 3), `SLUG_PATTERN`/`MAX_SLUG_LENGTH`/`BrainRole` (`../types.ts`), `isAdminRole`/`ROOT_PATH`/`Level` (`./types.ts`); `resolveTenantAccess` (`lib/tenants/resolve.ts`); `loadPeople` (`lib/tenants/people.ts`); `createAdminClient`.
- Produces (Tarea 6):
  - `type AccessChange = { kind: "grant"; path: string; userId: string; level: Level } | { kind: "revoke"; path: string; userId: string } | { kind: "general"; path: string; level: "lector" | "editor" | "ninguno" | "inherit" }`
  - `type ChangeResult = { ok: true } | { ok: false; code: "not_found" | "forbidden" | "invalid" | "lockout"; message: string }`
  - `interface ManageDeps { actor(tenantSlug): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>; rules: AccessRulesStore & AccessRulesWriter; memberRole(tenantId, userId): Promise<BrainRole | null>; pagePaths(tenantId): Promise<string[]> }`
  - `applyChange(rules, change): AccessRule[]`, `changeAccess(tenantSlug, change, deps): Promise<ChangeResult>`, `loadShareView(tenantSlug, path, deps): Promise<{ ok: true; view: NodeAccessView } | { ok: false; code: "not_found" | "forbidden" | "invalid"; message: string }>`
  - Server actions `grantAccess`, `revokeAccess`, `setGeneralAccess`, `getShareState` (Tarea 6).
  - `ShareState = { view: NodeAccessView; people: Record<string, { name: string; email: string | null }>; admins: string[]; candidates: string[] }` en `access-admin.ts`.

- [ ] **Step 1: Escribir los tests del núcleo**

`tests/brain/access-manage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	type AccessChange,
	applyChange,
	changeAccess,
	loadShareView,
	type ManageDeps,
} from "@/lib/brain/core/access/manage";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainRole } from "@/lib/brain/core/types";

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (
	path: string,
	userId: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "user", userId, level });

function setup(opts: {
	rules?: AccessRule[];
	role?: BrainRole;
	userId?: string;
	roles?: Record<string, BrainRole>;
	paths?: string[];
}) {
	const rules = opts.rules ?? [members("", "lector")];
	const set = vi.fn(async () => {});
	const remove = vi.fn(async () => {});
	const deps: ManageDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: opts.userId ?? "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		rules: { load: async () => rules, set, remove },
		memberRole: async (_t, id) =>
			(opts.roles ?? { ana: "tenant_member", beto: "tenant_member" })[id] ?? null,
		pagePaths: async () => opts.paths ?? ["comercial/icp", "legal/contrato"],
	};
	return { deps, set, remove };
}

const grant = (over: Partial<AccessChange & { kind: "grant" }> = {}): AccessChange => ({
	kind: "grant",
	path: "comercial",
	userId: "ana",
	level: "lector",
	...over,
});

describe("applyChange", () => {
	it("grant reemplaza la regla de esa persona en ese nodo y no toca las demás", () => {
		const rules = [user("a", "ana", "lector"), user("b", "ana", "editor")];
		expect(
			applyChange(rules, { kind: "grant", path: "a", userId: "ana", level: "editor" }),
		).toEqual([user("b", "ana", "editor"), user("a", "ana", "editor")]);
	});

	it("general inherit borra la fila members del nodo", () => {
		const rules = [members("a", "ninguno"), members("", "lector")];
		expect(applyChange(rules, { kind: "general", path: "a", level: "inherit" })).toEqual([
			members("", "lector"),
		]);
	});
});

describe("changeAccess", () => {
	it("un administrador da acceso a un miembro y se escribe la regla", async () => {
		const { deps, set } = setup({});
		expect(await changeAccess("innovas", grant(), deps)).toEqual({ ok: true });
		expect(set).toHaveBeenCalledWith(
			"t1",
			{ path: "comercial", principal: "user", userId: "ana", level: "lector" },
			"admin1",
		);
	});

	it("revoke quita la regla de esa persona", async () => {
		const { deps, remove } = setup({});
		await changeAccess("innovas", { kind: "revoke", path: "comercial", userId: "ana" }, deps);
		expect(remove).toHaveBeenCalledWith(
			"t1",
			{ path: "comercial", principal: "user", userId: "ana" },
			"admin1",
		);
	});

	it("general inherit quita la fila members; un nivel la escribe", async () => {
		const { deps, set, remove } = setup({});
		await changeAccess("innovas", { kind: "general", path: "legal", level: "inherit" }, deps);
		expect(remove).toHaveBeenCalledWith(
			"t1",
			{ path: "legal", principal: "members", userId: null },
			"admin1",
		);
		await changeAccess("innovas", { kind: "general", path: "legal", level: "ninguno" }, deps);
		expect(set).toHaveBeenCalledWith(
			"t1",
			{ path: "legal", principal: "members", userId: null, level: "ninguno" },
			"admin1",
		);
	});

	it("inherit sobre la raíz se rechaza", async () => {
		const { deps, remove } = setup({});
		const result = await changeAccess("innovas", { kind: "general", path: "", level: "inherit" }, deps);
		expect(result).toMatchObject({ ok: false, code: "invalid" });
		expect(remove).not.toHaveBeenCalled();
	});

	it("sin sesión del tenant responde not_found", async () => {
		const { deps } = setup({});
		deps.actor = async () => null;
		expect(await changeAccess("x", grant(), deps)).toMatchObject({ code: "not_found" });
	});

	it("un miembro que no ve el nodo recibe not_found; uno que lo ve sin administrar, forbidden", async () => {
		const hidden = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		expect(await changeAccess("i", grant(), hidden.deps)).toMatchObject({ code: "not_found" });

		const visible = setup({ role: "tenant_member", userId: "beto" });
		expect(await changeAccess("i", grant(), visible.deps)).toMatchObject({ code: "forbidden" });
		expect(visible.set).not.toHaveBeenCalled();
	});

	it("un miembro administrador del nodo puede dar acceso", async () => {
		const { deps, set } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), user("comercial", "beto", "administrador")],
		});
		expect(await changeAccess("i", grant(), deps)).toEqual({ ok: true });
		expect(set).toHaveBeenCalled();
	});

	it("un miembro administrador no puede quitarse ni bajarse la regla propia", async () => {
		const rules = [members("", "lector"), user("comercial", "beto", "administrador")];
		const a = setup({ role: "tenant_member", userId: "beto", rules });
		expect(
			await changeAccess("i", { kind: "revoke", path: "comercial", userId: "beto" }, a.deps),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(a.remove).not.toHaveBeenCalled();

		const b = setup({ role: "tenant_member", userId: "beto", rules });
		expect(
			await changeAccess("i", { kind: "grant", path: "comercial", userId: "beto", level: "editor" }, b.deps),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(b.set).not.toHaveBeenCalled();
	});

	it("un miembro administrador por acceso general no puede restringirse a sí mismo", async () => {
		const { deps, set } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), members("comercial", "administrador" as never)],
		});
		expect(
			await changeAccess("i", { kind: "general", path: "comercial", level: "ninguno" }, deps),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(set).not.toHaveBeenCalled();
	});

	it("un tenant_admin sí puede cambiar cualquier cosa, incluida la regla de otro administrador de nodo", async () => {
		const { deps, remove } = setup({
			rules: [members("", "lector"), user("comercial", "beto", "administrador")],
			roles: { beto: "tenant_member" },
		});
		expect(
			await changeAccess("i", { kind: "revoke", path: "comercial", userId: "beto" }, deps),
		).toEqual({ ok: true });
		expect(remove).toHaveBeenCalled();
	});

	it("rechaza a quien no es miembro del tenant, a un tenant_admin y a un userId inexistente", async () => {
		const { deps, set } = setup({ roles: { ana: "tenant_member", adm: "tenant_admin" } });
		expect(await changeAccess("i", grant({ userId: "extraño" }), deps)).toMatchObject({ code: "invalid" });
		expect(await changeAccess("i", grant({ userId: "adm" }), deps)).toMatchObject({ code: "invalid" });
		expect(set).not.toHaveBeenCalled();
	});

	it("una ruta inventada, sin páginas ni reglas debajo, responde not_found", async () => {
		const { deps, set } = setup({});
		expect(await changeAccess("i", grant({ path: "no-existe" }), deps)).toMatchObject({ code: "not_found" });
		expect(set).not.toHaveBeenCalled();
	});

	it("una ruta con reglas pero sin páginas sí existe; una ruta mal formada es invalid", async () => {
		const withRule = setup({ rules: [members("", "lector"), members("vacia", "ninguno")] });
		expect(await changeAccess("i", grant({ path: "vacia" }), withRule.deps)).toEqual({ ok: true });
		const { deps } = setup({});
		expect(await changeAccess("i", grant({ path: "../x" }), deps)).toMatchObject({ code: "invalid" });
		expect(await changeAccess("i", grant({ path: "A/B" }), deps)).toMatchObject({ code: "invalid" });
	});

	it("si las reglas no se pueden cargar, lanza: falla cerrada", async () => {
		const { deps } = setup({});
		deps.rules.load = async () => {
			throw new Error("base caída");
		};
		await expect(changeAccess("i", grant(), deps)).rejects.toThrow(/base caída/);
	});
});

describe("loadShareView", () => {
	it("un administrador del nodo recibe la vista", async () => {
		const { deps } = setup({ rules: [members("", "lector"), user("comercial", "ana", "editor")] });
		const result = await loadShareView("i", "comercial", deps);
		expect(result).toMatchObject({
			ok: true,
			view: { path: "comercial", own: [{ userId: "ana", level: "editor" }] },
		});
	});

	it("un miembro sin administración no la recibe", async () => {
		const { deps } = setup({ role: "tenant_member", userId: "beto" });
		expect(await loadShareView("i", "comercial", deps)).toMatchObject({ ok: false, code: "forbidden" });
	});
});
```

Nota: el caso `members("comercial", "administrador" as never)` modela un acceso general `administrador`, que la interfaz nunca ofrece (solo lector, editor o restringido) pero la base admite; por eso el test fuerza el tipo.

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/access-manage.test.ts`
Expected: FAIL — `@/lib/brain/core/access/manage` no existe.

- [ ] **Step 3: Implementar `manage.ts`**

`lib/brain/core/access/manage.ts`:

```ts
// Cambios de permisos del brain (spec etapa 17 §7.4). Sin Next ni Supabase:
// recibe sus dependencias, como savePage. Las server actions solo arman las
// dependencias reales y validan la forma en el borde.
import { MAX_SLUG_LENGTH, SLUG_PATTERN, type BrainRole } from "../types.ts";
import { explainAccess, type NodeAccessView } from "./explain.ts";
import { resolveAccess } from "./resolve-access.ts";
import {
	type AccessRule,
	type AccessRulesStore,
	type AccessRulesWriter,
	isAdminRole,
	type Level,
	type Principal,
	ROOT_PATH,
} from "./types.ts";

export type AccessChange =
	| { kind: "grant"; path: string; userId: string; level: Level }
	| { kind: "revoke"; path: string; userId: string }
	| {
			kind: "general";
			path: string;
			level: "lector" | "editor" | "ninguno" | "inherit";
	  };

export type FailureCode = "not_found" | "forbidden" | "invalid" | "lockout";
export type ChangeResult =
	| { ok: true }
	| { ok: false; code: FailureCode; message: string };

export interface ManageDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore & AccessRulesWriter;
	// Rol de esa persona en el tenant; null si no es miembro.
	memberRole(tenantId: string, userId: string): Promise<BrainRole | null>;
	// Slugs de todas las páginas del tenant: sirven para saber si una carpeta existe.
	pagePaths(tenantId: string): Promise<string[]>;
}

const fail = (code: FailureCode, message: string) =>
	({ ok: false, code, message }) as const;

function isValidPath(path: string): boolean {
	return (
		path === ROOT_PATH ||
		(path.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(path))
	);
}

// Aplica el cambio en memoria. Sirve para comprobar el resultado antes de escribir.
export function applyChange(
	rules: AccessRule[],
	change: AccessChange,
): AccessRule[] {
	if (change.kind === "general") {
		const rest = rules.filter(
			(r) => !(r.principal === "members" && r.path === change.path),
		);
		return change.level === "inherit"
			? rest
			: [
					...rest,
					{
						path: change.path,
						principal: "members",
						userId: null,
						level: change.level,
					},
				];
	}
	const rest = rules.filter(
		(r) =>
			!(
				r.principal === "user" &&
				r.userId === change.userId &&
				r.path === change.path
			),
	);
	return change.kind === "revoke"
		? rest
		: [
				...rest,
				{
					path: change.path,
					principal: "user",
					userId: change.userId,
					level: change.level,
				},
			];
}

type Authorized = {
	ok: true;
	tenantId: string;
	actor: { userId: string; role: BrainRole };
	principal: Principal;
	rules: AccessRule[];
};

// Quién es, qué ve y si administra el nodo. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	path: string,
	deps: ManageDeps,
): Promise<Authorized | Extract<ChangeResult, { ok: false }>> {
	if (!isValidPath(path)) return fail("invalid", "La ruta no es válida.");
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", "No encontrado.");

	// Si no se pueden cargar las reglas, esto lanza: falla cerrada.
	const rules = await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, path);
	if (level === null) return fail("not_found", "No encontrado.");
	if (level !== "administrador") {
		return fail("forbidden", "Solo un administrador puede cambiar los accesos.");
	}

	if (path !== ROOT_PATH) {
		const slugs = await deps.pagePaths(actor.tenantId);
		const exists =
			slugs.some((s) => s === path || s.startsWith(`${path}/`)) ||
			rules.some((r) => r.path === path || r.path.startsWith(`${path}/`));
		if (!exists) return fail("not_found", "No encontrado.");
	}

	return {
		ok: true,
		tenantId: actor.tenantId,
		actor: { userId: actor.userId, role: actor.role },
		principal,
		rules,
	};
}

export async function changeAccess(
	tenantSlug: string,
	change: AccessChange,
	deps: ManageDeps,
): Promise<ChangeResult> {
	if (
		change.kind === "general" &&
		change.path === ROOT_PATH &&
		change.level === "inherit"
	) {
		return fail("invalid", "La raíz no hereda de nadie.");
	}

	const auth = await authorize(tenantSlug, change.path, deps);
	if (!auth.ok) return auth;

	if (change.kind !== "general") {
		const role = await deps.memberRole(auth.tenantId, change.userId);
		if (role === null) {
			return fail("invalid", "Esa persona no es miembro de esta empresa.");
		}
		if (isAdminRole(role)) {
			return fail("invalid", "Esa persona ya administra todo el brain.");
		}
	}

	// Un miembro que administra un nodo no se deja afuera por error: tras el
	// cambio tiene que seguir administrándolo. Los administradores del tenant
	// siempre pueden.
	if (!isAdminRole(auth.actor.role)) {
		const after = applyChange(auth.rules, change);
		if (resolveAccess(after, auth.principal, change.path) !== "administrador") {
			return fail(
				"lockout",
				"Con ese cambio dejarías de administrar este lugar. Pedile a otra persona que lo haga.",
			);
		}
	}

	if (change.kind === "grant") {
		await deps.rules.set(
			auth.tenantId,
			{
				path: change.path,
				principal: "user",
				userId: change.userId,
				level: change.level,
			},
			auth.actor.userId,
		);
	} else if (change.kind === "revoke") {
		await deps.rules.remove(
			auth.tenantId,
			{ path: change.path, principal: "user", userId: change.userId },
			auth.actor.userId,
		);
	} else if (change.level === "inherit") {
		await deps.rules.remove(
			auth.tenantId,
			{ path: change.path, principal: "members", userId: null },
			auth.actor.userId,
		);
	} else {
		await deps.rules.set(
			auth.tenantId,
			{
				path: change.path,
				principal: "members",
				userId: null,
				level: change.level,
			},
			auth.actor.userId,
		);
	}
	return { ok: true };
}

export async function loadShareView(
	tenantSlug: string,
	path: string,
	deps: ManageDeps,
): Promise<
	| { ok: true; tenantId: string; view: NodeAccessView }
	| { ok: false; code: FailureCode; message: string }
> {
	const auth = await authorize(tenantSlug, path, deps);
	if (!auth.ok) return auth;
	return {
		ok: true,
		tenantId: auth.tenantId,
		view: explainAccess(auth.rules, path),
	};
}
```

- [ ] **Step 4: Correr el test del núcleo**

Run: `npx vitest run tests/brain/access-manage.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Escribir el adaptador y las acciones**

`lib/brain/adapters/access-admin.ts`:

```ts
// Cablea la gestión de permisos con la plataforma: sesión, cliente admin y el
// directorio de personas. El permiso lo decide manage.ts.
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPeople } from "@/lib/tenants/people";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import type { NodeAccessView } from "../core/access/explain";
import { loadShareView, type ManageDeps } from "../core/access/manage";
import type { BrainRole } from "../core/types";
import { accessRulesStore, accessRulesWriter } from "./access-rules";

export interface ShareState {
	view: NodeAccessView;
	people: Record<string, { name: string; email: string | null }>;
	// Administradores del tenant (fijos en el diálogo) y miembros comunes que
	// se pueden agregar. Son user_id; los datos están en `people`.
	admins: string[];
	candidates: string[];
}

export function manageDeps(): ManageDeps {
	const rules = accessRulesStore();
	const writer = accessRulesWriter();
	return {
		async actor(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		rules: { load: rules.load, set: writer.set, remove: writer.remove },
		async memberRole(tenantId, userId) {
			const { data, error } = await createAdminClient()
				.from("memberships")
				.select("role")
				.eq("tenant_id", tenantId)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw new Error(`No pude leer la membresía: ${error.message}`);
			return (data?.role as BrainRole | undefined) ?? null;
		},
		async pagePaths(tenantId) {
			const { data, error } = await createAdminClient()
				.from("brain_pages")
				.select("slug")
				.eq("tenant_id", tenantId);
			if (error) throw new Error(`No pude leer las páginas: ${error.message}`);
			return (data ?? []).map((row) => row.slug as string);
		},
	};
}

// Tope de miembros que se resuelven por nodo: cada uno es una llamada a la API
// de administración de Auth (como en el historial del editor).
const MAX_PEOPLE = 100;

export async function loadShareState(
	tenantSlug: string,
	path: string,
): Promise<
	| ({ ok: true } & ShareState)
	| { ok: false; code: string; message: string }
> {
	const deps = manageDeps();
	const result = await loadShareView(tenantSlug, path, deps);
	if (!result.ok) return result;

	const { data, error } = await createAdminClient()
		.from("memberships")
		.select("user_id, role")
		.eq("tenant_id", result.tenantId);
	if (error) throw new Error(`No pude leer las membresías: ${error.message}`);
	const memberships = (data ?? []) as Array<{ user_id: string; role: string }>;
	if (memberships.length > MAX_PEOPLE) {
		console.warn(
			`brain share: ${memberships.length} miembros; solo se resuelven ${MAX_PEOPLE}`,
		);
	}
	const shown = memberships.slice(0, MAX_PEOPLE);

	const directory = await loadPeople(shown.map((m) => m.user_id));
	const people: ShareState["people"] = {};
	for (const [id, person] of directory) {
		people[id] = { name: person.name, email: person.email ?? null };
	}

	return {
		ok: true,
		view: result.view,
		people,
		admins: shown.filter((m) => m.role === "tenant_admin").map((m) => m.user_id),
		candidates: shown
			.filter((m) => m.role === "tenant_member")
			.map((m) => m.user_id),
	};
}
```

`app/[tenant]/brain/access-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadShareState, manageDeps } from "@/lib/brain/adapters/access-admin";
import { type ChangeResult, changeAccess } from "@/lib/brain/core/access/manage";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide changeAccess.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	path: z.string().max(200),
};
const userId = z.string().uuid();

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

async function run(
	tenantSlug: string,
	change: Parameters<typeof changeAccess>[1],
): Promise<ChangeResult> {
	const result = await changeAccess(tenantSlug, change, manageDeps());
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}

export async function grantAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z
		.object({
			...base,
			userId,
			level: z.enum(["lector", "editor", "administrador"]),
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "grant", ...change });
}

export async function revokeAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z.object({ ...base, userId }).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "revoke", ...change });
}

export async function setGeneralAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z
		.object({
			...base,
			level: z.enum(["lector", "editor", "ninguno", "inherit"]),
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "general", ...change });
}

export async function getShareState(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return loadShareState(parsed.data.tenantSlug, parsed.data.path);
}
```

- [ ] **Step 6: Escribir el test de las acciones**

`tests/brain/access-actions.test.ts` (mismo patrón que `tests/brain/save-action.test.ts`: se mockean el adaptador y `next/cache`, y se comprueba que el borde rechaza lo mal formado antes de tocar nada y que revalida solo cuando el cambio salió bien):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const changeAccess = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/access-admin", () => ({
	manageDeps: () => ({}),
	loadShareState: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/brain/core/access/manage", () => ({ changeAccess }));

const { grantAccess, revokeAccess, setGeneralAccess } = await import(
	"@/app/[tenant]/brain/access-actions"
);

const USER = "7c1d3f0e-0000-4000-8000-000000000001";

beforeEach(() => {
	changeAccess.mockReset();
	revalidatePath.mockReset();
});

describe("access actions", () => {
	it("rechaza datos mal formados sin llegar a changeAccess", async () => {
		expect(await grantAccess({ tenantSlug: "A B", path: "x", userId: USER, level: "lector" })).toMatchObject({ ok: false, code: "invalid" });
		expect(await grantAccess({ tenantSlug: "innovas", path: "x", userId: "no-uuid", level: "lector" })).toMatchObject({ code: "invalid" });
		expect(await grantAccess({ tenantSlug: "innovas", path: "x", userId: USER, level: "ninguno" })).toMatchObject({ code: "invalid" });
		expect(await setGeneralAccess({ tenantSlug: "innovas", path: "x", level: "administrador" })).toMatchObject({ code: "invalid" });
		expect(changeAccess).not.toHaveBeenCalled();
	});

	it("pasa el cambio ya validado y revalida el brain solo si salió bien", async () => {
		changeAccess.mockResolvedValueOnce({ ok: true });
		expect(await grantAccess({ tenantSlug: "innovas", path: "comercial", userId: USER, level: "editor" })).toEqual({ ok: true });
		expect(changeAccess).toHaveBeenCalledWith(
			"innovas",
			{ kind: "grant", path: "comercial", userId: USER, level: "editor" },
			{},
		);
		expect(revalidatePath).toHaveBeenCalledWith("/innovas/brain", "layout");

		revalidatePath.mockReset();
		changeAccess.mockResolvedValueOnce({ ok: false, code: "forbidden", message: "no" });
		await revokeAccess({ tenantSlug: "innovas", path: "comercial", userId: USER });
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 7: Correr todo lo de la tarea**

Run: `npx vitest run tests/brain/access-manage.test.ts tests/brain/access-actions.test.ts tests/brain/boundary.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. Si `@/app/[tenant]/...` no resuelve en Vitest, importar con la ruta relativa `../../app/[tenant]/brain/access-actions` como lo hace `save-action.test.ts`.

- [ ] **Step 8: Formatear y commitear**

```bash
npx biome check --write lib/brain/core/access/manage.ts lib/brain/adapters/access-admin.ts "app/[tenant]/brain/access-actions.ts" tests/brain/access-manage.test.ts tests/brain/access-actions.test.ts
git add lib/brain/core/access/manage.ts lib/brain/adapters/access-admin.ts "app/[tenant]/brain/access-actions.ts" tests/brain/access-manage.test.ts tests/brain/access-actions.test.ts
git commit -m "feat: gestión de permisos del brain (dar, quitar y acceso general) con su server action

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Árbol de navegación (layout, componente y carga)

**Files:**
- Create: `components/ui/dialog.tsx`, `components/ui/sheet.tsx` (generados con shadcn)
- Modify: `lib/brain/adapters/editor.ts` (agrega `loadBrainTree`)
- Create: `app/[tenant]/brain/layout.tsx`
- Create: `components/brain/brain-shell.tsx` (cliente: columna del árbol en escritorio, `Sheet` en mobile)
- Create: `components/brain/brain-tree.tsx` (cliente: filas, plegado, archivadas)
- Test: `tests/brain/editor-tree.test.ts`

**Interfaces:**
- Consumes: `visibleTree`, `withoutArchived`, `editableFolders`, `TreeNode` (Tarea 1); `OkEditorContext`, `loadBrainPages` (`editor.ts`); `pageHref`, `editHref`, `historyHref` (`editor/slug.ts`).
- Produces (Tareas 6, 7):
  - `loadBrainTree(ctx: OkEditorContext): Promise<TreeNode>` (cacheada por request).
  - `<BrainTree tenantSlug root canCreate />`, `<BrainShell …>` y `<TreeRowMenu tenantSlug node onShare />`.
  - Un `ShareDialog` mínimo (devuelve `null`) con el contrato `{ tenantSlug, path, name, onClose }`, que la Tarea 6 reemplaza. Así esta tarea compila y se prueba sola: el menú ya ofrece "Compartir…" y la Tarea 6 lo conecta al diálogo real.

- [ ] **Step 1: Escribir el test de `loadBrainTree`**

`tests/brain/editor-tree.test.ts` (patrón de `tests/brain/editor-access.test.ts`, que ya arma un contexto con proveedor falso): el contexto lista tres páginas, el acceso oculta una; el árbol resultante no la tiene y no lleva cuerpos.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (orig) => ({
	...(await orig<typeof import("react")>()),
	cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/connectors/bindings", () => ({ loadTenantBindings: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tenants/resolve", () => ({ resolveTenantAccess: vi.fn() }));

const { loadBrainTree } = await import("@/lib/brain/adapters/editor");

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "secreto",
	revision: 1,
	updatedAt: "2026-10-07T00:00:00Z",
});

describe("loadBrainTree", () => {
	it("arma el árbol con lo que el contexto deja ver y sin cuerpos", async () => {
		const ctx = {
			kind: "ok",
			canEdit: true,
			categories: ["comercial"],
			tenant: {},
			access: (path: string) => (path.startsWith("legal") ? null : "lector"),
			provider: {
				list: async () => [page("comercial/icp"), page("legal/contrato")],
			},
		} as never;
		const tree = await loadBrainTree(ctx);
		expect(tree.children.map((n) => n.path)).toEqual(["comercial"]);
		expect(JSON.stringify(tree)).not.toContain("secreto");
	});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/brain/editor-tree.test.ts`
Expected: FAIL — `loadBrainTree` no existe.

- [ ] **Step 3: Agregar `loadBrainTree` a `editor.ts`**

Debajo de `loadBrainPages`:

```ts
// El árbol sale de lo que el proveedor envuelto ya dejó ver, filtrado otra vez
// por ctx.access: lo oculto no llega ni a la pantalla.
export const loadBrainTree = cache(
	async (ctx: OkEditorContext): Promise<TreeNode> =>
		visibleTree(await loadBrainPages(ctx), ctx.access),
);
```

con `import { type TreeNode, visibleTree } from "../core/access/tree";`.

Run: `npx vitest run tests/brain/editor-tree.test.ts` → PASS.

- [ ] **Step 4: Agregar `Dialog` y `Sheet`**

```bash
npx shadcn@latest add dialog sheet
```

Los archivos nuevos importan `cn` de `@/lib/utils`; los de `components/ui/` existentes importan `import { cn } from "cn";`. Dejar el mismo import que usan los demás. Correr `npx biome check --write components/ui/dialog.tsx components/ui/sheet.tsx` y `npm run typecheck`. Si el CLI no puede bajar el registro, traer el código con la herramienta `mcp__Shadcn_UI__get_component` (`dialog`, `sheet`, estilo `radix-nova`) y pegarlo igual.

- [ ] **Step 5: El menú de fila (navegación)**

`components/brain/tree-row-menu.tsx`:

```tsx
"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { atLeast } from "@/lib/brain/core/access/types";
import type { TreeNode } from "@/lib/brain/core/access/tree";
import { editHref, historyHref } from "@/lib/brain/core/editor/slug";

// Ítems según §7.2: lo que no corresponde no se muestra.
export function TreeRowMenu({
	tenantSlug,
	node,
	onShare,
}: {
	tenantSlug: string;
	node: TreeNode;
	onShare: () => void;
}) {
	const isFolder = node.children.length > 0;
	const canEdit = atLeast(node.level, "editor");
	const items: React.ReactNode[] = [];

	if (isFolder && canEdit) {
		items.push(
			<DropdownMenuItem asChild key="new" className="min-h-11 lg:min-h-0">
				<Link href={`/${tenantSlug}/brain/nueva?en=${node.path}`}>
					Nueva página acá
				</Link>
			</DropdownMenuItem>,
		);
	}
	if (node.page && canEdit) {
		items.push(
			<DropdownMenuItem asChild key="edit" className="min-h-11 lg:min-h-0">
				<Link href={editHref(tenantSlug, node.page.slug)}>Editar</Link>
			</DropdownMenuItem>,
		);
	}
	if (node.page) {
		items.push(
			<DropdownMenuItem asChild key="history" className="min-h-11 lg:min-h-0">
				<Link href={historyHref(tenantSlug, node.page.slug)}>Historial</Link>
			</DropdownMenuItem>,
		);
	}
	if (node.level === "administrador") {
		items.push(
			<DropdownMenuItem
				key="share"
				className="min-h-11 lg:min-h-0"
				onSelect={onShare}
			>
				Compartir…
			</DropdownMenuItem>,
		);
	}
	if (items.length === 0) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Opciones de ${node.page?.title ?? node.name}`}
				className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:bg-muted lg:size-7 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100 data-[state=open]:opacity-100"
			>
				<MoreHorizontalIcon aria-hidden className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44">
				{items}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
```

- [ ] **Step 6: El componente del árbol**

`components/brain/brain-tree.tsx`:

```tsx
"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ShareDialog } from "@/components/brain/share-dialog";
import { TreeRowMenu } from "@/components/brain/tree-row-menu";
import { type TreeNode, withoutArchived } from "@/lib/brain/core/access/tree";
import { pageHref } from "@/lib/brain/core/editor/slug";

// El plegado vive en localStorage por tenant (§7.1). Puede fallar (ventana
// privada, datos bloqueados): se envuelve y la pantalla anda igual.
function readOpen(key: string): Set<string> | null {
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : null;
		return Array.isArray(parsed) ? new Set(parsed.map(String)) : null;
	} catch {
		return null;
	}
}
function writeOpen(key: string, open: Set<string>) {
	try {
		localStorage.setItem(key, JSON.stringify([...open]));
	} catch {
		// sin almacenamiento: el plegado dura lo que dure la pantalla
	}
}

export function BrainTree({
	tenantSlug,
	root,
	canCreate,
}: {
	tenantSlug: string;
	root: TreeNode;
	canCreate: boolean;
}) {
	const pathname = usePathname();
	const storageKey = `brain-tree:${tenantSlug}`;
	const [open, setOpen] = useState<Set<string>>(new Set());
	const [showArchived, setShowArchived] = useState(false);
	const [sharing, setSharing] = useState<{ path: string; name: string } | null>(
		null,
	);
	useEffect(() => {
		const saved = readOpen(storageKey);
		if (saved) setOpen(saved);
	}, [storageKey]);

	const tree = useMemo(
		() => (showArchived ? root : withoutArchived(root)),
		[root, showArchived],
	);
	const prefix = `/${tenantSlug}/brain/p/`;
	const currentSlug = pathname.startsWith(prefix)
		? decodeURIComponent(pathname.slice(prefix.length))
		: null;

	const toggle = (path: string) => {
		const next = new Set(open);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		setOpen(next);
		writeOpen(storageKey, next);
	};

	const renderNode = (node: TreeNode, depth: number) => {
		const hasChildren = node.children.length > 0;
		// La carpeta de la página actual se muestra abierta aunque no se haya plegado a mano.
		const isOpen =
			open.has(node.path) ||
			(currentSlug !== null && currentSlug.startsWith(`${node.path}/`));
		const label = node.page?.title ?? node.name;
		const isCurrent = node.page !== null && node.page.slug === currentSlug;
		return (
			<li key={node.path}>
				<div
					className={`group flex min-h-11 items-center rounded-md lg:min-h-8 ${isCurrent ? "bg-muted font-medium" : "hover:bg-muted/50"} ${node.page?.status === "archivado" ? "opacity-60" : ""}`}
					style={{ paddingLeft: depth * 12 }}
				>
					{hasChildren ? (
						<button
							type="button"
							aria-label={isOpen ? "Plegar" : "Desplegar"}
							aria-expanded={isOpen}
							onClick={() => toggle(node.path)}
							className="inline-flex size-11 shrink-0 items-center justify-center lg:size-7"
						>
							<ChevronRightIcon
								aria-hidden
								className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
							/>
						</button>
					) : (
						<span className="size-11 shrink-0 lg:size-7" aria-hidden />
					)}
					{node.page ? (
						<Link
							href={pageHref(tenantSlug, node.page.slug)}
							title={node.page.slug}
							className="min-w-0 flex-1 truncate text-sm"
						>
							{label}
						</Link>
					) : (
						<button
							type="button"
							onClick={() => toggle(node.path)}
							className="min-w-0 flex-1 truncate text-left text-sm"
						>
							{label}
						</button>
					)}
					<TreeRowMenu
						tenantSlug={tenantSlug}
						node={node}
						onShare={() => setSharing({ path: node.path, name: label })}
					/>
				</div>
				{hasChildren && isOpen && (
					<ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
				)}
			</li>
		);
	};

	return (
		<nav aria-label="Archivos del brain" className="space-y-2 text-sm">
			<div className="flex items-center gap-2">
				<Link
					href={`/${tenantSlug}/brain`}
					className="min-w-0 flex-1 truncate font-medium"
				>
					Brain
				</Link>
				<TreeRowMenu
					tenantSlug={tenantSlug}
					node={root}
					onShare={() => setSharing({ path: "", name: "Brain" })}
				/>
			</div>
			{canCreate && (
				<Link
					href={`/${tenantSlug}/brain/nueva`}
					className="inline-flex min-h-11 w-full items-center justify-center rounded-md border text-sm hover:bg-muted lg:min-h-8"
				>
					Nueva página
				</Link>
			)}
			{tree.children.length === 0 ? (
				<p className="text-muted-foreground">No hay páginas para mostrar.</p>
			) : (
				<ul>{tree.children.map((node) => renderNode(node, 0))}</ul>
			)}
			<label className="flex min-h-11 items-center gap-2 text-muted-foreground lg:min-h-8">
				<input
					type="checkbox"
					checked={showArchived}
					onChange={(e) => setShowArchived(e.target.checked)}
				/>
				Mostrar archivadas
			</label>
			{sharing && (
				<ShareDialog
					tenantSlug={tenantSlug}
					path={sharing.path}
					name={sharing.name}
					onClose={() => setSharing(null)}
				/>
			)}
		</nav>
	);
}
```

`ShareDialog` es de la Tarea 6. Para que esta tarea compile sola, crear antes `components/brain/share-dialog.tsx` con un cuerpo mínimo que la Tarea 6 reemplaza:

```tsx
"use client";

export function ShareDialog(_props: {
	tenantSlug: string;
	path: string;
	name: string;
	onClose: () => void;
}) {
	return null;
}
```

- [ ] **Step 7: El shell (columna en escritorio, `Sheet` en mobile) y el layout**

`components/brain/brain-shell.tsx`:

```tsx
"use client";

import { MenuIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrainTree } from "@/components/brain/brain-tree";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import type { TreeNode } from "@/lib/brain/core/access/tree";

export function BrainShell({
	tenantSlug,
	root,
	canCreate,
	children,
}: {
	tenantSlug: string;
	root: TreeNode;
	canCreate: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const tree = (
		<BrainTree tenantSlug={tenantSlug} root={root} canCreate={canCreate} />
	);
	return (
		<div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
			<aside className="hidden lg:block">{tree}</aside>
			<div className="min-w-0">
				<div className="mb-4 lg:hidden">
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetTrigger asChild>
							<Button variant="outline" className="min-h-11">
								<MenuIcon aria-hidden /> Archivos
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto p-4">
							<SheetHeader className="p-0">
								<SheetTitle>Archivos</SheetTitle>
							</SheetHeader>
							{tree}
						</SheetContent>
					</Sheet>
				</div>
				{children}
			</div>
		</div>
	);
}
```

`app/[tenant]/brain/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { BrainShell } from "@/components/brain/brain-shell";
import { loadBrainTree, loadEditorContext } from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";

export default async function BrainLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ tenant: string }>;
}) {
	const { tenant } = await params;
	const ctx = await loadEditorContext(tenant);
	// Sin brain propio (o externo) cada pantalla muestra su aviso; no hay árbol.
	if (!ctx || ctx.kind !== "ok") return children;
	const root = await loadBrainTree(ctx);
	return (
		<BrainShell
			tenantSlug={tenant}
			root={root}
			canCreate={editableFolders(root).length > 0}
		>
			{children}
		</BrainShell>
	);
}
```

- [ ] **Step 8: Tipos, lint y suite del brain**

Run: `npm run typecheck && npx vitest run tests/brain`
Expected: PASS. Formatear solo lo editado:

```bash
npx biome check --write lib/brain/adapters/editor.ts "app/[tenant]/brain/layout.tsx" components/brain/brain-shell.tsx components/brain/brain-tree.tsx components/brain/tree-row-menu.tsx components/brain/share-dialog.tsx components/ui/dialog.tsx components/ui/sheet.tsx tests/brain/editor-tree.test.ts
```

- [ ] **Step 9: Verificar en el navegador**

`preview_start` con el servidor de desarrollo de `.claude/launch.json` (si no existe la entrada, crearla con `npm run dev`) y una base local con un tenant que tenga brain (`npm run db:start`, `npm run db:reset`, y los scripts de alta que ya usa el repo para el tenant de prueba). Entrar a `/<tenant>/brain` y comprobar:
- A 1280 px: columna de 260 px con carpetas plegables, el chevron y el nombre plegan, la página actual resaltada, "Mostrar archivadas" al pie.
- A 375 px (`resize_window` preset `mobile`): botón "Archivos" que abre el `Sheet`, sin scroll horizontal de la página, filas de al menos 44 px.
- Recargar: el plegado se conserva; con `localStorage` bloqueado la pantalla sigue andando (`read_console_messages` sin errores).
- Con un miembro común: no aparecen "Compartir…" ni carpetas ocultas.

Si el entorno local no tiene sesión ni tenant sembrados, dejarlo anotado en el reporte: se verifica en la Tarea 8.

- [ ] **Step 10: Commitear**

```bash
git add lib/brain/adapters/editor.ts "app/[tenant]/brain/layout.tsx" components/brain components/ui/dialog.tsx components/ui/sheet.tsx tests/brain/editor-tree.test.ts
git commit -m "feat: árbol de navegación del brain con plegado, archivadas y menú de tres puntos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Diálogo de compartir

**Files:**
- Modify (reemplaza el stub): `components/brain/share-dialog.tsx`
- Modify: `components/ui/select.tsx` solo si falta una variante; si no, sin cambios.

**Interfaces:**
- Consumes: `getShareState`, `grantAccess`, `revokeAccess`, `setGeneralAccess` (`app/[tenant]/brain/access-actions.ts`); `ShareState` (`lib/brain/adapters/access-admin.ts`); `NodeAccessView` (Tarea 1); `Dialog*` (Tarea 5), `Select*`, `Input`, `Button`.
- Produces: `<ShareDialog tenantSlug path name onClose />` — contrato ya usado por `brain-tree.tsx`.

- [ ] **Step 1: Escribir el diálogo**

`components/brain/share-dialog.tsx` reemplaza el stub. Cumple §7.3: carga su estado al abrirse; agregar personas (buscador sobre los miembros comunes que aún no tienen regla propia en el nodo, con selector de nivel; elegir a alguien lo guarda al momento); personas con acceso (administradores del tenant fijos, reglas propias con selector y "Quitar", heredadas atenuadas con "heredado de <carpeta>" que navega a esa carpeta); acceso general con la opción `Heredar (…)` que muestra lo que hereda y que no existe en la raíz.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
	getShareState,
	grantAccess,
	revokeAccess,
	setGeneralAccess,
} from "@/app/[tenant]/brain/access-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ShareState } from "@/lib/brain/adapters/access-admin";

type Level = "lector" | "editor" | "administrador";
const LEVELS: Level[] = ["lector", "editor", "administrador"];
const LEVEL_LABEL: Record<Level, string> = {
	lector: "Lector",
	editor: "Editor",
	administrador: "Administrador",
};
// Cómo se nombra, entre paréntesis, lo que un nodo hereda.
const INHERIT_LABEL = {
	ninguno: "restringido",
	lector: "lector",
	editor: "editor",
	administrador: "administrador",
} as const;

type Loaded = { ok: true } & ShareState;
type Failed = { error: string };
type Outcome = { ok: boolean; message?: string };

const normalize = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
const nameOf = (path: string) =>
	path === "" ? "Brain" : path.slice(path.lastIndexOf("/") + 1);

export function ShareDialog({
	tenantSlug,
	path: initialPath,
	name: initialName,
	onClose,
}: {
	tenantSlug: string;
	path: string;
	name: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [path, setPath] = useState(initialPath);
	const [name, setName] = useState(initialName);
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [newLevel, setNewLevel] = useState<Level>("lector");

	const load = useCallback(async () => {
		try {
			const result = await getShareState({ tenantSlug, path });
			setState(
				"view" in result
					? (result as Loaded)
					: { error: "message" in result ? result.message : "No se pudo cargar." },
			);
		} catch {
			setState({ error: "No se pudo cargar. Probá de nuevo." });
		}
	}, [tenantSlug, path]);

	useEffect(() => {
		void load();
	}, [load]);

	// Toda acción: se bloquean los controles, el error vuelve a la vista y,
	// si salió bien, se recarga el diálogo y el árbol.
	async function act(run: () => Promise<Outcome>) {
		setBusy(true);
		setError(null);
		try {
			const result = await run();
			if (!result.ok) {
				setError(result.message ?? "No se pudo guardar.");
				return;
			}
			setQuery("");
			await load();
			router.refresh();
		} catch {
			setError("No se pudo guardar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const goTo = (next: string) => {
		setPath(next);
		setName(nameOf(next));
		setState(null);
		setError(null);
	};

	const body = (() => {
		if (state === null) return <p className="text-muted-foreground text-sm">Cargando…</p>;
		if ("error" in state)
			return (
				<p role="alert" className="text-sm">
					{state.error}
				</p>
			);

		const { view, people, admins, candidates } = state;
		const label = (id: string) => people[id]?.name || people[id]?.email || "Sin nombre";
		const email = (id: string) => (people[id]?.name ? people[id]?.email : null);
		const taken = new Set(view.own.map((rule) => rule.userId));
		const q = normalize(query.trim());
		const matches = q
			? candidates
					.filter((id) => !taken.has(id))
					.filter((id) =>
						normalize(`${people[id]?.name ?? ""} ${people[id]?.email ?? ""}`).includes(q),
					)
					.slice(0, 8)
			: [];
		const isRoot = path === "";
		const inherited = view.general.inherited;
		const generalValue = view.general.own ?? "inherit";

		return (
			<div className="space-y-6">
				<section className="space-y-2">
					<h3 className="text-sm font-medium">Agregar personas</h3>
					<div className="flex gap-2">
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Buscar por nombre o correo"
							aria-label="Buscar personas para dar acceso"
							disabled={busy}
							className="min-h-11"
						/>
						<Select value={newLevel} onValueChange={(v) => setNewLevel(v as Level)}>
							<SelectTrigger className="min-h-11 w-36" aria-label="Nivel para la persona nueva">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{LEVELS.map((level) => (
									<SelectItem key={level} value={level}>
										{LEVEL_LABEL[level]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{q && matches.length === 0 && (
						<p className="text-muted-foreground text-sm">No hay personas para agregar con ese nombre.</p>
					)}
					{matches.length > 0 && (
						<ul className="divide-y rounded-md border">
							{matches.map((id) => (
								<li key={id}>
									<button
										type="button"
										disabled={busy}
										onClick={() =>
											act(() => grantAccess({ tenantSlug, path, userId: id, level: newLevel }))
										}
										className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-left hover:bg-muted/50"
									>
										<span className="text-sm">{label(id)}</span>
										{email(id) && (
											<span className="text-muted-foreground text-xs">{email(id)}</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Personas que tienen acceso</h3>
					<ul className="divide-y rounded-md border">
						{admins.map((id) => (
							<li key={`admin-${id}`} className="flex min-h-11 items-center gap-3 px-3 py-2">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(id)}</div>
									{email(id) && (
										<div className="truncate text-muted-foreground text-xs">{email(id)}</div>
									)}
								</div>
								<span className="text-muted-foreground text-sm">Administrador</span>
							</li>
						))}
						{view.own.map((rule) => (
							<li key={`own-${rule.userId}`} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(rule.userId)}</div>
									{email(rule.userId) && (
										<div className="truncate text-muted-foreground text-xs">{email(rule.userId)}</div>
									)}
								</div>
								<Select
									value={rule.level}
									disabled={busy}
									onValueChange={(v) =>
										act(() => grantAccess({ tenantSlug, path, userId: rule.userId, level: v }))
									}
								>
									<SelectTrigger className="min-h-11 w-36" aria-label={`Nivel de ${label(rule.userId)}`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{LEVELS.map((level) => (
											<SelectItem key={level} value={level}>
												{LEVEL_LABEL[level]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									disabled={busy}
									onClick={() => act(() => revokeAccess({ tenantSlug, path, userId: rule.userId }))}
								>
									Quitar
								</Button>
							</li>
						))}
						{view.inherited.map((rule) => (
							<li key={`inh-${rule.userId}`} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 opacity-60">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(rule.userId)}</div>
									<button
										type="button"
										onClick={() => goTo(rule.from)}
										className="text-left text-muted-foreground text-xs underline"
									>
										heredado de {rule.from === "" ? "Brain" : rule.from}
									</button>
								</div>
								<span className="text-sm">{LEVEL_LABEL[rule.level]}</span>
							</li>
						))}
					</ul>
				</section>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Acceso general</h3>
					<Select
						value={generalValue}
						disabled={busy}
						onValueChange={(v) => act(() => setGeneralAccess({ tenantSlug, path, level: v }))}
					>
						<SelectTrigger className="min-h-11 w-full" aria-label="Acceso general">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{!isRoot && (
								<SelectItem value="inherit">
									Heredar ({INHERIT_LABEL[inherited.level]})
								</SelectItem>
							)}
							<SelectItem value="ninguno">Restringido</SelectItem>
							<SelectItem value="lector">Todos los miembros: Lector</SelectItem>
							<SelectItem value="editor">Todos los miembros: Editor</SelectItem>
						</SelectContent>
					</Select>
				</section>
			</div>
		);
	})();

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Compartir "{name}"</DialogTitle>
					<DialogDescription>Quién ve y quién edita este lugar del brain.</DialogDescription>
				</DialogHeader>
				{body}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button type="button" className="min-h-11" onClick={onClose}>
						Listo
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

Los selectores guardan al elegir. Un valor inválido (por ejemplo, `inherit` en la raíz) no se puede elegir porque la opción no existe; si igual llegara, la acción lo rechaza con `invalid`.

- [ ] **Step 2: Tipos y lint**

Run: `npm run typecheck && npx biome check --write components/brain/share-dialog.tsx`
Expected: limpio.

- [ ] **Step 3: Verificar en el navegador**

Con la misma base local de la Tarea 5, un `tenant_admin` y dos `tenant_member` sembrados:
- Menú de tres puntos de una carpeta → "Compartir…" abre el diálogo; título correcto; agregar al miembro A como lector; aparece en "Personas que tienen acceso" y deja de ofrecerse en el buscador.
- Cambiar el acceso general de la carpeta a "Restringido": entrar como miembro B (otra ventana o sesión) y comprobar que la carpeta desaparece del árbol, `brain_search` por MCP no la devuelve y `brain_read` responde `not_found`; como miembro A sí se ve.
- Quitar a A y volver a "Heredar": B vuelve a verla.
- Una subcarpeta muestra las reglas del padre atenuadas con "heredado de …", y el link navega.
- En la raíz el selector no ofrece "Heredar".
- A 375 px el diálogo cabe sin scroll horizontal y los controles miden al menos 44 px.
- `select type, payload from events where type = 'brain.access_changed' order by id desc limit 5` muestra un evento por cada cambio.

- [ ] **Step 4: Commitear**

```bash
git add components/brain/share-dialog.tsx
git commit -m "feat: diálogo de compartir del brain con personas, heredados y acceso general

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Índice, “Nueva página acá” y detalles de las pantallas

**Files:**
- Modify: `app/[tenant]/brain/page.tsx` (índice sin agrupar por categoría; `?carpeta=`)
- Modify: `components/brain/page-list.tsx` (lista plana con ruta)
- Modify: `app/[tenant]/brain/nueva/page.tsx` (`?en=` y gate por carpetas editables)
- Create: `lib/brain/core/editor/new-page.ts` (`resolveNewPagePrefix`)
- Test: `tests/brain/editor-new-page.test.ts`

**Interfaces:**
- Consumes: `loadBrainTree`, `loadBrainPages`, `loadEditorContext` (`editor.ts`); `editableFolders`, `TreeNode` (Tarea 1); `SLUG_PATTERN` (`core/types.ts`).
- Produces: `resolveNewPagePrefix(en: string | undefined, folders: string[]): string` — devuelve `"<carpeta>/"` si `en` es un slug válido y está en `folders` (o es `""` y la raíz está), y `""` en cualquier otro caso.

- [ ] **Step 1: Escribir el test de `resolveNewPagePrefix`**

`tests/brain/editor-new-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";

describe("resolveNewPagePrefix", () => {
	it("precarga la carpeta si es editable", () => {
		expect(resolveNewPagePrefix("comercial", ["comercial", "legal"])).toBe("comercial/");
	});
	it("ignora una carpeta que no es editable", () => {
		expect(resolveNewPagePrefix("direccion", ["comercial"])).toBe("");
	});
	it("ignora lo que no es un slug válido, sin importar si figura en la lista", () => {
		expect(resolveNewPagePrefix("../x", ["../x"])).toBe("");
		expect(resolveNewPagePrefix("A B", ["A B"])).toBe("");
	});
	it("sin parámetro o con la raíz, no precarga nada", () => {
		expect(resolveNewPagePrefix(undefined, ["comercial"])).toBe("");
		expect(resolveNewPagePrefix("", [""])).toBe("");
	});
});
```

- [ ] **Step 2: Correr y ver que falla, implementar y ver que pasa**

Run: `npx vitest run tests/brain/editor-new-page.test.ts` → FAIL (no existe el módulo).

`lib/brain/core/editor/new-page.ts`:

```ts
// Prefijo con el que se precarga el slug de una página nueva (spec etapa 17
// §7.2, "Nueva página acá"). El valor viene de la URL: solo se acepta una
// carpeta con slug válido donde la persona puede escribir.
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";

export function resolveNewPagePrefix(
	en: string | undefined,
	editableFolders: string[],
): string {
	if (!en || en.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(en)) return "";
	return editableFolders.includes(en) ? `${en}/` : "";
}
```

Run: `npx vitest run tests/brain/editor-new-page.test.ts tests/brain/boundary.test.ts` → PASS.

- [ ] **Step 3: `/brain/nueva` con `?en=` y gate por carpetas editables**

Reemplazar `app/[tenant]/brain/nueva/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
} from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";
import { PageForm } from "../page-form";

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
	return (
		<div>
			<h1 className="mb-2 text-3xl leading-tight">Nueva página</h1>
			{!folders.includes("") && (
				<p className="mb-6 text-muted-foreground text-sm">
					Podés crear páginas en: {folders.join(", ")}.
				</p>
			)}
			<PageForm
				mode="new"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug, title, status }) => ({
					slug,
					title,
					status,
				}))}
				initial={{
					slug: resolveNewPagePrefix(en, folders),
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

- [ ] **Step 4: Índice sin agrupar por categoría**

Reemplazar `components/brain/page-list.tsx`:

```tsx
import Link from "next/link";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { type BrainPage, CANON_TAGS } from "@/lib/brain/core/types";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

// Lista plana con la ruta de cada página: el árbol de la izquierda es la
// estructura; acá no se agrupa por categoría (A13), que queda como insignia.
export function PageList({
	pages,
	tenantSlug,
	counts,
}: {
	pages: BrainPage[];
	tenantSlug: string;
	counts: Map<string, { in: number; out: number }>;
}) {
	if (pages.length === 0)
		return (
			<p className="text-muted-foreground">No hay páginas que coincidan.</p>
		);
	return (
		<ul className="divide-y rounded-lg border">
			{pages.map((page) => {
				const count = counts.get(page.slug) ?? { in: 0, out: 0 };
				const canon = page.tags.filter((t) =>
					(CANON_TAGS as readonly string[]).includes(t),
				);
				return (
					<li key={page.slug}>
						<Link
							href={pageHref(tenantSlug, page.slug)}
							className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/50"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{page.title}</span>
								<span className="block truncate text-muted-foreground text-xs">
									{page.slug}
								</span>
							</span>
							<span className="rounded-full border px-2 py-0.5 text-xs capitalize">
								{page.category}
							</span>
							{canon.map((tag) => (
								<span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
									{tag}
								</span>
							))}
							{page.status !== "activo" && (
								<span className="rounded-full bg-muted px-2 py-0.5 text-xs">
									{STATUS_LABEL[page.status]}
								</span>
							)}
							<span
								className="text-muted-foreground text-xs tabular-nums"
								title="Links entrantes · salientes"
							>
								← {count.in} · {count.out} →
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
```

En `app/[tenant]/brain/page.tsx`: sumar `carpeta?: string` a `searchParams`; reemplazar desde `const counts = …` hasta el final del componente por lo siguiente, y agregar los imports `loadBrainTree` (de `@/lib/brain/adapters/editor`), `editableFolders` y `type TreeNode` (de `@/lib/brain/core/access/tree`), y `SLUG_PATTERN` (de `@/lib/brain/core/types`).

```tsx
	const folder = carpeta && SLUG_PATTERN.test(carpeta) ? carpeta : null;
	if (folder)
		visible = visible.filter(
			(p) => p.slug === folder || p.slug.startsWith(`${folder}/`),
		);

	const tree = await loadBrainTree(ctx);
	// Sin consulta, carpeta ni etiqueta: las carpetas de primer nivel y las páginas
	// sueltas. Con alguna, la lista plana de resultados.
	const browsing = !q.trim() && !tag && !folder;
	const folders = browsing ? tree.children.filter((n) => n.children.length > 0) : [];
	const countPages = (node: TreeNode): number =>
		(node.page ? 1 : 0) + node.children.reduce((sum, c) => sum + countPages(c), 0);
	const listed = browsing ? visible.filter((p) => !p.slug.includes("/")) : visible;
	if (!q.trim()) listed.sort((a, b) => a.slug.localeCompare(b.slug));

	const counts = new Map(
		pages.map((p) => [
			p.slug,
			{
				in: index.incoming.get(p.slug)?.length ?? 0,
				out: index.outgoing.get(p.slug)?.length ?? 0,
			},
		]),
	);
	const href = (next: Record<string, string | undefined>) => {
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries({
			q: q || undefined,
			estado,
			tag,
			carpeta: folder ?? undefined,
			...next,
		}))
			if (v) sp.set(k, v);
		const qs = sp.toString();
		return `/${slug}/brain${qs ? `?${qs}` : ""}`;
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="mr-auto text-3xl leading-tight">
					Brain{folder ? ` / ${folder}` : ""}
				</h1>
				<Button asChild variant="outline">
					<Link href={`/${slug}/brain/mapa`}>Mapa de conexiones</Link>
				</Button>
				{editableFolders(tree).length > 0 && (
					<Button asChild className="lg:hidden">
						<Link href={`/${slug}/brain/nueva`}>Nueva página</Link>
					</Button>
				)}
			</div>
			{folder && (
				<Link href={href({ carpeta: undefined })} className="text-muted-foreground text-sm underline">
					Quitar filtro de carpeta
				</Link>
			)}
			<form className="flex flex-wrap gap-2" action={`/${slug}/brain`}>
				<Input
					name="q"
					defaultValue={q}
					placeholder="Buscar en el brain"
					className="max-w-sm"
				/>
				<select
					name="estado"
					defaultValue={status ?? ""}
					className="h-9 rounded-md border bg-background px-3 text-sm"
				>
					<option value="">Activas y borradores</option>
					<option value="activo">Activas</option>
					<option value="borrador">Borradores</option>
					<option value="archivado">Archivadas</option>
				</select>
				{tag && <input type="hidden" name="tag" value={tag} />}
				{folder && <input type="hidden" name="carpeta" value={folder} />}
				<Button type="submit" variant="secondary">
					Buscar
				</Button>
			</form>
			<div className="flex flex-wrap gap-2 text-sm">
				{CANON_TAGS.map((t) => (
					<Link
						key={t}
						href={href({ tag: tag === t ? undefined : t })}
						className={`rounded-full border px-3 py-1 ${tag === t ? "bg-primary text-primary-foreground" : ""}`}
					>
						{t}
					</Link>
				))}
			</div>
			{folders.length > 0 && (
				<ul className="divide-y rounded-lg border">
					{folders.map((node) => (
						<li key={node.path}>
							<Link
								href={href({ carpeta: node.path })}
								className="flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-muted/50"
							>
								<span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
								<span className="text-muted-foreground text-xs">
									{countPages(node)} páginas
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
			<PageList pages={listed} tenantSlug={slug} counts={counts} />
		</div>
	);
}
```

El mensaje `No hay páginas que coincidan.` de `PageList` aparece también en el índice sin consulta cuando solo hay carpetas; para no mostrarlo en ese caso, renderizar `<PageList …/>` solo si `listed.length > 0 || folders.length === 0`.

- [ ] **Step 5: Tipos, lint y suite completa**

```bash
npm run typecheck && npm test
npx biome check --write "app/[tenant]/brain/page.tsx" "app/[tenant]/brain/nueva/page.tsx" components/brain/page-list.tsx lib/brain/core/editor/new-page.ts tests/brain/editor-new-page.test.ts
```
Expected: todo en verde.

- [ ] **Step 6: Verificar en el navegador**

Con el tenant local: `/brain` sin consulta muestra carpetas con conteo y páginas de primer nivel; entrar a una carpeta filtra por prefijo; buscar devuelve una lista plana con rutas; "Nueva página acá" desde una carpeta abre `/brain/nueva?en=<ruta>` con el slug precargado; con una ruta no editable en `?en=` el slug queda vacío; un miembro que solo es editor de una carpeta ve "Nueva página" y puede abrir `/brain/nueva`, y uno solo lector recibe 404.

- [ ] **Step 7: Commitear**

```bash
git add "app/[tenant]/brain/page.tsx" "app/[tenant]/brain/nueva/page.tsx" components/brain/page-list.tsx lib/brain/core/editor/new-page.ts tests/brain/editor-new-page.test.ts
git commit -m "feat: índice del brain sin agrupar por categoría y Nueva página acá por carpeta

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Cierre — documentación y verificación final

**Files:**
- Modify: `lib/brain/README.md` (cómo se cambian las reglas, qué hace cada pieza nueva)
- Modify: `docs/01-roadmap-etapas.md` (tildar la 17.3 con el orden de despliegue)

- [ ] **Step 1: Documentar**

En `lib/brain/README.md`, agregar una sección "Cambiar permisos" que explique: `manage.ts` es el único camino que cambia reglas desde la app (exige administrador del nodo, valida membresía y existencia de la ruta, y aplica el chequeo de autoexclusión); `brain_set_access_rule` y `brain_remove_access_rule` escriben regla y evento en una transacción; `visibleTree`/`explainAccess`/`editableFolders` son puras; el árbol que llega al navegador no lleva cuerpos ni reglas. En `docs/01-roadmap-etapas.md`, tildar `17.3 · Árbol y compartir` con una línea que nombre este plan y deje escrito: **antes de desplegar, aplicar la migración `20261008120000_brain_access_rule_fns` a producción (corriendo `npx supabase migration list` antes: `db push` aplica todas las pendientes) y recién después desplegar el código; al revés, el diálogo falla por falta de las funciones.**

- [ ] **Step 2: Verificación completa**

```bash
npm run typecheck
npm test
npm run db:test
grep -rn "getBrainProvider" app | grep -v "^app/api" || true
```
Expected: typecheck limpio; todos los tests en verde; pgTAP en verde (incluye `22_brain_access_rule_fns`); el `grep` no lista ninguna pantalla que arme un proveedor sin envolver.

- [ ] **Step 3: Verificar el criterio de cierre de la spec (§1.1) en el navegador**

Recorrer una vez, en escritorio y a 375 px, el flujo completo: un `tenant_admin` restringe una carpeta desde el diálogo y le da lectura a una sola persona; esa persona la ve en el árbol y otra no (la carpeta no aparece, `/brain/p/<slug>` da 404). Anotar en el reporte lo que no se pudo probar localmente (MCP real, tenant `innovas`): ese chequeo lo hace Mati en producción después del despliegue.

- [ ] **Step 4: Commitear**

```bash
git add lib/brain/README.md docs/01-roadmap-etapas.md
git commit -m "docs: cierre de la entrega 17.3, árbol y compartir del brain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Cobertura de la spec (§7, §3.5–3.6, §4.4, §8):**
- §3.5 y §3.6 `visibleTree`, `explainAccess` → Tarea 1. `AccessRulesStore.set/remove` → Tarea 3 (como `AccessRulesWriter`, desvío 3). Evento §4.4 → Tarea 2.
- §7.1 árbol (panel de 260 px, `Sheet` en mobile, plegado en `localStorage`, archivadas, "Nueva página") → Tarea 5. §7.2 menú de tres puntos → Tareas 5 y 7 ("Nueva página acá"). §7.3 diálogo → Tarea 6 con `explainAccess` de la Tarea 1. §7.4 acciones y la regla de autoexclusión → Tarea 4. §7.5 índice y resto → Tarea 7; el resto de las pantallas (404 si invisible, "Editar" solo con editor, paneles de enlaces sin destinos invisibles) ya lo hace la 17.2 porque todo sale del proveedor envuelto.
- §8 17.3 terminado cuando el criterio 1 se cumple desde la UI → Tarea 8 paso 3.

**Escaneo de marcadores sin completar:** ningún paso queda en prosa sin código. En la Tarea 7 el índice se reemplaza desde `const counts` hasta el final del componente; el principio de `page.tsx` (carga del contexto, búsqueda por relevancia, filtro de estado y de etiqueta) no cambia salvo por el parámetro `carpeta`.

**Consistencia de tipos:** `TreeNode`/`TreePage` (Tarea 1) los usan las Tareas 5 y 7; `AccessChange`/`ChangeResult`/`ManageDeps` (Tarea 4) los usan `access-actions.ts` y su test; `ShareState` (Tarea 4) lo consume el diálogo (Tarea 6); `AccessRulesWriter` (Tarea 3) lo consume `manageDeps`; `resolveNewPagePrefix` (Tarea 7) solo la usa `nueva/page.tsx`.
