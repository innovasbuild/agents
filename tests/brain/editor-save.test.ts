import { describe, expect, it, vi } from "vitest";
import { BrainConflict, BrainValidation } from "@/lib/brain/core/errors";
import type { BrainProvider } from "@/lib/brain/core/types";
import {
	type SaveDeps,
	type SavePageInput,
	savePage,
} from "@/lib/brain/editor/save";
import type { BrainBinding } from "@/lib/brain/resolve";

const wiki = {
	id: "b1",
	tenantId: "t1",
	provider: "wiki",
	config: {},
} as unknown as BrainBinding;
const mcp = {
	id: "b2",
	tenantId: "t1",
	provider: "mcp",
} as unknown as BrainBinding;

const input: SavePageInput = {
	tenantSlug: "innovas",
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: { owner: "mati" },
	body: "texto",
	reason: "ajuste",
	baseRevision: 3,
};

function deps(over: Partial<SaveDeps> = {}, upsert?: BrainProvider["upsert"]) {
	const provider: BrainProvider = {
		search: vi.fn(),
		read: vi.fn(),
		upsert:
			upsert ?? vi.fn(async () => ({ slug: "comercial/icp", revision: 4 })),
	};
	return {
		provider,
		deps: {
			access: async () => ({
				tenantId: "t1",
				role: "tenant_admin" as const,
				userId: "u1",
			}),
			binding: async () => wiki,
			provider: () => provider,
			...over,
		} satisfies SaveDeps,
	};
}

describe("savePage", () => {
	it("escribe con autor user de la sesión y baseRevision", async () => {
		const { deps: d, provider } = deps();
		expect(await savePage(input, d)).toEqual({
			ok: true,
			slug: "comercial/icp",
			revision: 4,
		});
		expect(provider.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: "comercial/icp",
				baseRevision: 3,
				reason: "ajuste",
				frontmatter: { owner: "mati" },
			}),
			{ kind: "user", userId: "u1" },
		);
	});

	it("página nueva va sin baseRevision", async () => {
		const { deps: d, provider } = deps();
		await savePage({ ...input, baseRevision: null }, d);
		expect(
			(provider.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0],
		).not.toHaveProperty("baseRevision");
	});

	it("rechaza a tenant_member y a quien no tiene acceso sin llamar al provider", async () => {
		const member = deps({
			access: async () => ({
				tenantId: "t1",
				role: "tenant_member",
				userId: "u2",
			}),
		});
		expect(await savePage(input, member.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(member.provider.upsert).not.toHaveBeenCalled();
		const nobody = deps({ access: async () => null });
		expect(await savePage(input, nobody.deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});

	it("rechaza binding mcp o ausente", async () => {
		expect(
			await savePage(input, deps({ binding: async () => mcp }).deps),
		).toMatchObject({ code: "unsupported" });
		expect(
			await savePage(input, deps({ binding: async () => null }).deps),
		).toMatchObject({ code: "unsupported" });
	});

	it("exige motivo", async () => {
		const { deps: d, provider } = deps();
		expect(await savePage({ ...input, reason: "  " }, d)).toMatchObject({
			code: "validation",
			fields: ["reason"],
		});
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("traduce conflicto y validación", async () => {
		const conflict = deps({}, async () => {
			throw new BrainConflict("comercial/icp", 5);
		});
		expect(await savePage(input, conflict.deps)).toMatchObject({
			ok: false,
			code: "conflict",
			currentRevision: 5,
		});
		const invalid = deps({}, async () => {
			throw new BrainValidation(["category"]);
		});
		expect(await savePage(input, invalid.deps)).toMatchObject({
			ok: false,
			code: "validation",
			fields: ["category"],
		});
	});

	it("slug nuevo que ya existe: conflicto sin revisión con mensaje propio, sin ofrecer reintentar", async () => {
		// brain_upsert_page (rama "else", p_base_revision null) tira BR409 con la
		// revisión vigente en el detail, no vacío: translateStoreError la traduce
		// a BrainConflict con esa revisión. savePage la fuerza a null igual,
		// porque no hay revisión válida contra la cual reintentar una creación:
		// reintentar con la revisión de otra página la pisaría (hallazgo del
		// review de la rama).
		const exists = deps({}, async () => {
			throw new BrainConflict("comercial/icp", 7);
		});
		expect(
			await savePage({ ...input, baseRevision: null }, exists.deps),
		).toMatchObject({
			code: "conflict",
			currentRevision: null,
			message: "Ya existe una página con ese slug.",
		});
	});

	it("un error inesperado sale como internal con id", async () => {
		const boom = deps({}, async () => {
			throw new Error("db caída");
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await savePage(input, boom.deps);
		expect(result).toMatchObject({ ok: false, code: "internal" });
		expect(result.ok === false && result.message).toMatch(
			/No se pudo guardar \(.+\)/,
		);
		spy.mockRestore();
	});
});
