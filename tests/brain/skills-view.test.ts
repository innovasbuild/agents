import { describe, expect, it, vi } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import { BrainForbidden, BrainNotFound } from "@/lib/brain/core/errors";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import { withoutSkills, withSkillView } from "@/lib/brain/core/skills/view";
import type {
	BrainPage,
	BrainProvider,
	BrainWrite,
} from "@/lib/brain/core/types";

const page = (slug: string, over: Partial<BrainPage> = {}): BrainPage => ({
	slug,
	title: `borrador ${slug}`,
	category: slug.startsWith("skills/") ? "skill" : "comercial",
	status: "activo",
	tags: [],
	frontmatter: { description: "borrador" },
	body: `cuerpo borrador de ${slug}`,
	revision: 9,
	updatedAt: "2026-10-11T00:00:00Z",
	...over,
});

const PAGES = [
	page("comercial/icp"),
	page("skills/publicada"),
	page("skills/sin-publicar"),
	page("skills/retirada"),
];

function fakeProvider() {
	const upsert = vi.fn(async (write: BrainWrite) => ({
		slug: write.slug,
		revision: 10,
	}));
	const provider: BrainProvider = {
		search: async () =>
			PAGES.map((p) => ({
				slug: p.slug,
				title: p.title,
				category: p.category,
				status: p.status,
				tags: [],
				snippet: p.body,
				updatedAt: p.updatedAt,
			})),
		read: async (slug) => {
			const found = PAGES.find((p) => p.slug === slug);
			if (!found) throw new BrainNotFound(slug, []);
			return found;
		},
		list: async () => PAGES,
		listMeta: async () =>
			PAGES.map(({ body: _body, frontmatter: _frontmatter, ...meta }) => meta),
		listLinks: async () =>
			PAGES.map((p) => ({
				slug: p.slug,
				links: [{ target: "comercial/icp", alias: null, anchor: null }],
			})),
		history: async () => [],
		upsert,
	};
	return { provider, upsert };
}

const snap = (action: "publicar" | "retirar") => ({
	action,
	version: 2,
	pageRevision: 4,
	filesDigest: "fd",
	title: "Publicada",
	description: "desc publicada",
	body: "cuerpo publicado",
	frontmatter: { description: "desc publicada" },
	manifest: [],
	digest: "dg",
	publishedAt: "2026-10-10T00:00:00Z",
});
const OVERVIEW: SkillOverviewRow[] = [
	{
		pageId: "p1",
		slug: "skills/publicada",
		revision: 9,
		draftFilesDigest: "x",
		current: snap("publicar"),
	},
	{
		pageId: "p2",
		slug: "skills/sin-publicar",
		revision: 9,
		draftFilesDigest: "x",
		current: null,
	},
	{
		pageId: "p3",
		slug: "skills/retirada",
		revision: 9,
		draftFilesDigest: "x",
		current: snap("retirar"),
	},
];

const write = (slug: string, category: string): BrainWrite => ({
	slug,
	title: "t",
	category,
	status: "activo",
	tags: [],
	body: "b",
	reason: "r",
});

describe("withoutSkills (asistentes)", () => {
	it("search y list dejan afuera todo skills/", async () => {
		const wrapped = withoutSkills(fakeProvider().provider);
		expect((await wrapped.search({ query: "" })).map((r) => r.slug)).toEqual([
			"comercial/icp",
		]);
		expect((await wrapped.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
	});

	it("listMeta y listLinks dejan afuera todo skills/", async () => {
		const wrapped = withoutSkills(fakeProvider().provider);
		expect((await wrapped.listMeta()).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
		expect((await wrapped.listLinks()).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
	});

	it("read e history responden como si no existiera", async () => {
		const wrapped = withoutSkills(fakeProvider().provider);
		await expect(wrapped.read("skills/publicada")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		expect(await wrapped.history("skills/publicada")).toBeNull();
		expect((await wrapped.read("comercial/icp")).slug).toBe("comercial/icp");
	});

	it("upsert rechaza la ruta y la categoría, y no llega al proveedor", async () => {
		const { provider, upsert } = fakeProvider();
		const wrapped = withoutSkills(provider);
		const author = { kind: "user" as const, userId: "u1" };
		await expect(
			wrapped.upsert(write("skills/nueva", "skill"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		await expect(
			wrapped.upsert(write("skills/nueva", "comercial"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		await expect(
			wrapped.upsert(write("comercial/x", "skill"), author),
		).rejects.toBeInstanceOf(BrainForbidden);
		expect(upsert).not.toHaveBeenCalled();
		await wrapped.upsert(write("comercial/x", "comercial"), author);
		expect(upsert).toHaveBeenCalledTimes(1);
	});
});

describe("withSkillView (web)", () => {
	const view = (level: Level | null) => {
		const overview = vi.fn(async () => OVERVIEW);
		return {
			overview,
			wrapped: withSkillView(fakeProvider().provider, {
				levelOf: () => level,
				overview,
			}),
		};
	};

	it("un editor ve el borrador", async () => {
		const { wrapped } = view("editor");
		expect((await wrapped.read("skills/publicada")).body).toBe(
			"cuerpo borrador de skills/publicada",
		);
		expect((await wrapped.list()).map((p) => p.slug)).toHaveLength(4);
		expect(await wrapped.history("skills/publicada")).toEqual([]);
	});

	it("un lector ve la copia publicada, sin nada derivado del borrador", async () => {
		const { wrapped } = view("lector");
		const read = await wrapped.read("skills/publicada");
		expect(read.body).toBe("cuerpo publicado");
		expect(read.title).toBe("Publicada");
		expect(read.frontmatter).toEqual({ description: "desc publicada" });
		expect(read.slug).toBe("skills/publicada");
		expect(read.revision).toBe(4);
		expect(read.tags).toEqual([]);
		expect(read.status).toBe("activo");
		const listed = (await wrapped.list()).find(
			(p) => p.slug === "skills/publicada",
		);
		expect(listed?.revision).toBe(4);
	});

	it("un editor ve la revisión, el estado y las etiquetas reales del borrador", async () => {
		const provider: BrainProvider = {
			...fakeProvider().provider,
			read: async (slug) =>
				page(slug, { revision: 9, status: "borrador", tags: ["x"] }),
		};
		const wrapped = withSkillView(provider, {
			levelOf: () => "editor",
			overview: async () => OVERVIEW,
		});
		const read = await wrapped.read("skills/publicada");
		expect([read.revision, read.status, read.tags]).toEqual([
			9,
			"borrador",
			["x"],
		]);
	});

	it("para un lector, sin versión vigente la skill no existe", async () => {
		const { wrapped } = view("lector");
		await expect(wrapped.read("skills/sin-publicar")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		await expect(wrapped.read("skills/retirada")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
		expect((await wrapped.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
			"skills/publicada",
		]);
	});

	it("listMeta: un editor ve el borrador y un lector la copia publicada", async () => {
		const editor = (await view("editor").wrapped.listMeta()).find(
			(p) => p.slug === "skills/publicada",
		);
		expect(editor?.revision).toBe(9);
		const reader = await view("lector").wrapped.listMeta();
		expect(reader.map((p) => p.slug)).toEqual([
			"comercial/icp",
			"skills/publicada",
		]);
		const published = reader.find((p) => p.slug === "skills/publicada");
		expect(published?.title).toBe("Publicada");
		expect(published?.revision).toBe(4);
		expect(published?.tags).toEqual([]);
		expect(published?.status).toBe("activo");
		expect(published).not.toHaveProperty("body");
	});

	it("listLinks: un editor ve los links del borrador", async () => {
		const links = await view("editor").wrapped.listLinks();
		expect(links.map((p) => p.slug)).toEqual([
			"comercial/icp",
			"skills/publicada",
			"skills/sin-publicar",
			"skills/retirada",
		]);
	});

	it("listLinks: un lector ve los links del cuerpo publicado, no los del borrador", async () => {
		// El borrador de la skill enlaza a comercial/icp; el publicado, a otra cosa.
		const published = {
			...snap("publicar"),
			body: "mirá [[comercial/otro#x|el otro]]",
		};
		const wrapped = withSkillView(fakeProvider().provider, {
			levelOf: () => "lector",
			overview: async () => [
				{ ...OVERVIEW[0], current: published },
				OVERVIEW[1],
				OVERVIEW[2],
			],
		});
		const links = await wrapped.listLinks();
		expect(links.map((p) => p.slug).sort()).toEqual([
			"comercial/icp",
			"skills/publicada",
		]);
		expect(links.find((p) => p.slug === "skills/publicada")?.links).toEqual([
			expect.objectContaining({
				target: "comercial/otro",
				anchor: "x",
				alias: "el otro",
			}),
		]);
	});

	it("listLinks: un lector ve los links publicados aunque el borrador no tenga ninguno", async () => {
		const wrapped = withSkillView(
			{ ...fakeProvider().provider, listLinks: async () => [] },
			{
				levelOf: () => "lector",
				overview: async () => [
					{
						...OVERVIEW[0],
						current: { ...snap("publicar"), body: "[[comercial/icp]]" },
					},
				],
			},
		);
		expect(await wrapped.listLinks()).toEqual([
			{
				slug: "skills/publicada",
				links: [
					expect.objectContaining({ target: "comercial/icp", alias: null }),
				],
			},
		]);
	});

	it("un lector no encuentra skills con la búsqueda ni ve su historial", async () => {
		const { wrapped } = view("lector");
		expect((await wrapped.search({ query: "" })).map((r) => r.slug)).toEqual([
			"comercial/icp",
		]);
		expect(await wrapped.history("skills/publicada")).toBeNull();
	});

	it("lo que no es skill pasa sin consultar el resumen", async () => {
		const { wrapped, overview } = view("lector");
		await wrapped.read("comercial/icp");
		expect(overview).not.toHaveBeenCalled();
	});

	it("el resumen se lee una sola vez por envoltorio", async () => {
		const { wrapped, overview } = view("lector");
		await wrapped.list();
		await wrapped.read("skills/publicada");
		expect(overview).toHaveBeenCalledTimes(1);
	});
});

describe("sugerencias de not_found no filtran skills", () => {
	const leaky = (): BrainProvider => ({
		...fakeProvider().provider,
		read: async (slug) => {
			throw new BrainNotFound(slug, ["comercial/icp", "skills/sin-publicar"]);
		},
	});

	it("withoutSkills", async () => {
		const wrapped = withoutSkills(leaky());
		const error = await wrapped.read("comercial/icpp").catch((e) => e);
		expect(error).toBeInstanceOf(BrainNotFound);
		expect(error.suggestions).toEqual(["comercial/icp"]);
	});

	it("withSkillView para un lector", async () => {
		const wrapped = withSkillView(leaky(), {
			levelOf: () => "lector",
			overview: async () => OVERVIEW,
		});
		const error = await wrapped.read("skills/sin-publicar").catch((e) => e);
		expect(error).toBeInstanceOf(BrainNotFound);
		expect(error.suggestions).toEqual(["comercial/icp"]);
	});

	it("withSkillView para un editor conserva las sugerencias", async () => {
		const wrapped = withSkillView(leaky(), {
			levelOf: () => "editor",
			overview: async () => OVERVIEW,
		});
		const error = await wrapped.read("x").catch((e) => e);
		expect(error.suggestions).toEqual(["comercial/icp", "skills/sin-publicar"]);
	});
});
