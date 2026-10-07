import { describe, expect, it, vi } from "vitest";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { withAccess } from "@/lib/brain/core/access/with-access";
import { BrainForbidden, BrainNotFound } from "@/lib/brain/core/errors";
import type { BrainPage, BrainProvider } from "@/lib/brain/core/types";

const SLUGS = [
	"comercial/icp",
	"comercial/interno/notas",
	"direccion/presupuesto",
	"otros/x",
];

function pageOf(slug: string): BrainPage {
	return {
		slug,
		title: slug,
		category: "comercial",
		status: "activo",
		tags: [],
		frontmatter: {},
		body: "x",
		revision: 1,
		updatedAt: "2026-10-01T00:00:00Z",
	};
}

function fakeProvider() {
	return {
		search: vi.fn(async () =>
			SLUGS.map((slug) => ({
				slug,
				title: slug,
				category: "comercial",
				status: "activo" as const,
				tags: [],
				snippet: `texto de ${slug}`,
				updatedAt: "2026-10-01T00:00:00Z",
			})),
		),
		read: vi.fn(async (slug: string) => {
			if (!SLUGS.includes(slug)) {
				throw new BrainNotFound(slug, [
					"comercial/icp",
					"direccion/presupuesto",
				]);
			}
			return pageOf(slug);
		}),
		list: vi.fn(async () => SLUGS.map(pageOf)),
		history: vi.fn(async (slug: string) => (SLUGS.includes(slug) ? [] : null)),
		upsert: vi.fn(async (write: { slug: string; baseRevision?: number }) => ({
			slug: write.slug,
			revision: (write.baseRevision ?? 0) + 1,
		})),
	} satisfies BrainProvider;
}

const general = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});

// Ana: lee todo salvo dirección y lo interno; edita comercial.
const RULES: AccessRule[] = [
	general("", "lector"),
	general("direccion", "ninguno"),
	general("comercial", "editor"),
	general("comercial/interno", "ninguno"),
];
const ana: Principal = { kind: "user", userId: "ana", role: "tenant_member" };
const author = { kind: "user", userId: "ana" } as const;
const write = (slug: string, baseRevision?: number) => ({
	slug,
	title: "t",
	category: "comercial",
	status: "activo" as const,
	tags: [],
	body: "b",
	reason: "r",
	...(baseRevision === undefined ? {} : { baseRevision }),
});

describe("withAccess · quién queda sin envolver", () => {
	it.each<[string, Principal]>([
		["tenant_admin", { kind: "user", userId: "u", role: "tenant_admin" }],
		["platform_admin", { kind: "user", userId: "u", role: "platform_admin" }],
		["agente", { kind: "agent", agent: "outreach" }],
		["plataforma", { kind: "platform" }],
		["import", { kind: "import" }],
	])("%s recibe el mismo proveedor", (_name, principal) => {
		const provider = fakeProvider();
		expect(withAccess(provider, principal, [general("", "ninguno")])).toBe(
			provider,
		);
	});

	it("un rol desconocido queda envuelto como miembro común", () => {
		const provider = fakeProvider();
		const intruso: Principal = {
			kind: "user",
			userId: "x",
			role: "intruso" as never,
		};
		expect(withAccess(provider, intruso, [general("", "ninguno")])).not.toBe(
			provider,
		);
	});
});

describe("withAccess · search", () => {
	it("descarta lo oculto, sin snippets de páginas ocultas", async () => {
		const provider = fakeProvider();
		const results = await withAccess(provider, ana, RULES).search({
			query: "x",
		});
		expect(results.map((r) => r.slug)).toEqual(["comercial/icp", "otros/x"]);
		expect(JSON.stringify(results)).not.toContain("direccion");
		expect(JSON.stringify(results)).not.toContain("interno");
	});

	it("pide de más al proveedor para no quedarse corto, con tope de 20, y recorta al límite pedido", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		const one = await wrapped.search({ query: "x", limit: 1 });
		expect(one).toHaveLength(1);
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ query: "x", limit: 4 }),
		);
		await wrapped.search({ query: "x", limit: 20 });
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 20 }),
		);
		await wrapped.search({ query: "x" });
		expect(provider.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 20 }),
		);
	});
});

describe("withAccess · read e historial", () => {
	it("leer una página oculta da la misma respuesta que leer una que no existe", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		const hidden = await wrapped.read("direccion/presupuesto").catch((e) => e);
		const missing = await wrapped.read("comercial/no-existe").catch((e) => e);
		expect(hidden).toBeInstanceOf(BrainNotFound);
		expect(missing).toBeInstanceOf(BrainNotFound);
		expect(hidden.suggestions).toEqual([]);
		expect(missing.suggestions).toEqual([]);
		expect(hidden.code).toBe(missing.code);
		// Lo oculto ni siquiera se le pide al proveedor.
		expect(provider.read).not.toHaveBeenCalledWith(
			"direccion/presupuesto",
			expect.anything(),
		);
	});

	it("lee lo visible y nunca pide sugerencias al proveedor", async () => {
		const provider = fakeProvider();
		const page = await withAccess(provider, ana, RULES).read("comercial/icp");
		expect(page.slug).toBe("comercial/icp");
		expect(provider.read).toHaveBeenCalledWith("comercial/icp", {
			suggestions: false,
		});
	});

	it("el historial de una página oculta es null, como si no existiera", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		expect(await wrapped.history("direccion/presupuesto")).toBeNull();
		expect(provider.history).not.toHaveBeenCalledWith("direccion/presupuesto");
		expect(await wrapped.history("comercial/icp")).toEqual([]);
	});
});

describe("withAccess · list", () => {
	it("devuelve solo lo visible", async () => {
		const pages = await withAccess(fakeProvider(), ana, RULES).list();
		expect(pages.map((p) => p.slug)).toEqual(["comercial/icp", "otros/x"]);
	});
});

describe("withAccess · upsert", () => {
	it("actualizar una página oculta es not_found", async () => {
		const provider = fakeProvider();
		await expect(
			withAccess(provider, ana, RULES).upsert(
				write("direccion/presupuesto", 1),
				author,
			),
		).rejects.toBeInstanceOf(BrainNotFound);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("actualizar una página visible sin ser editor es forbidden", async () => {
		const provider = fakeProvider();
		await expect(
			withAccess(provider, ana, RULES).upsert(write("otros/x", 1), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("un editor actualiza y crea dentro de su carpeta", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		expect(await wrapped.upsert(write("comercial/icp", 1), author)).toEqual({
			slug: "comercial/icp",
			revision: 2,
		});
		expect(
			await wrapped.upsert(write("comercial/nueva"), author),
		).toMatchObject({
			slug: "comercial/nueva",
		});
		expect(provider.upsert).toHaveBeenCalledTimes(2);
	});

	it("crear sin ser editor de ese lugar es forbidden, nunca not_found ni conflicto", async () => {
		const provider = fakeProvider();
		const wrapped = withAccess(provider, ana, RULES);
		// carpeta solo lectora
		await expect(
			wrapped.upsert(write("otros/nueva"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		// carpeta oculta, aunque el slug ya exista: no se revela por conflicto
		await expect(
			wrapped.upsert(write("direccion/presupuesto"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		// subcarpeta oculta dentro de una carpeta donde sí edita
		await expect(
			wrapped.upsert(write("comercial/interno/nueva"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("una regla por persona le da editor sobre una carpeta cerrada", async () => {
		const provider = fakeProvider();
		const rules: AccessRule[] = [
			...RULES,
			{ path: "direccion", principal: "user", userId: "ana", level: "editor" },
		];
		const wrapped = withAccess(provider, ana, rules);
		expect(
			await wrapped.upsert(write("direccion/presupuesto", 1), author),
		).toMatchObject({
			revision: 2,
		});
		expect((await wrapped.list()).map((p) => p.slug)).toContain(
			"direccion/presupuesto",
		);
	});
});
