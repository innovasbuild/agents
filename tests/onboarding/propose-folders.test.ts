// proposeFolders se prueba con `generateText` inyectado: no llama al modelo.
import { NoOutputGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import {
	GENERIC_FOLDERS,
	normalizeProposal,
} from "@/lib/onboarding/folder-template";
import {
	type FolderProposal,
	folderProposalSchema,
	PROPOSE_MAX_PAGES,
	proposeFolders,
} from "@/lib/onboarding/services/propose-folders";
import type { WebPageResult } from "@/lib/outreach/web-page";

type LeerPagina = {
	execute: (input: { url: string }, options: unknown) => Promise<unknown>;
};

const folder = (slug: string, restricted = false) => ({
	slug,
	name: slug,
	description: `Lo que va en ${slug}`,
	restricted,
});

function proposal(folders: FolderProposal["folders"]): FolderProposal {
	return {
		found: true,
		company: {
			summary: "Concesionaria",
			industry: "Automotriz",
			sizeHint: null,
			location: null,
			products: [],
		},
		brand: { colors: [], fonts: [], logoUrl: null },
		folders,
	};
}

const nine = [
	folder("direccion", true),
	folder("finanzas", true),
	folder("comercial"),
	folder("operacion"),
	folder("marketing"),
	folder("talento"),
	folder("postventa"),
	folder("proyectos"),
	folder("tecnologia"),
];

const okPage = (url: string): WebPageResult => ({
	ok: true,
	page: { url, status: 200, title: "t", text: "x", truncated: false },
});

const input = {
	domain: "lagomarsino.com.ar",
	displayName: "Lagomarsino",
	hint: null,
	model: "m",
};

describe("proposeFolders", () => {
	it("a) salida válida pasa el schema y normalizeProposal conserva 9", async () => {
		const out = proposal(nine);
		const generateText = (async () => ({
			output: out,
			steps: [],
			usage: {},
		})) as never;
		const r = await proposeFolders(input, {
			generateText,
			readPage: async (u) => okPage(u),
		});
		expect(folderProposalSchema.safeParse(r.output).success).toBe(true);
		expect(normalizeProposal(r.output as FolderProposal).folders).toHaveLength(
			9,
		);
	});

	it("b) filtra reservados y repetidas", () => {
		const n = normalizeProposal(
			proposal([...nine, folder("skills"), folder("comercial")]),
		);
		const slugs = n.folders.map((f) => f.slug);
		expect(slugs).not.toContain("skills");
		expect(slugs.filter((s) => s === "comercial")).toHaveLength(1);
		expect(n.folders.length).toBeLessThanOrEqual(10);
	});

	it("c) agrega finanzas restringida si falta", () => {
		const n = normalizeProposal(
			proposal(nine.filter((f) => f.slug !== "finanzas")),
		);
		const fin = n.folders.find((f) => f.slug === "finanzas");
		expect(fin?.restricted).toBe(true);
		expect(n.folders.length).toBeLessThanOrEqual(10);
		expect(GENERIC_FOLDERS.map((f) => f.slug)).toEqual([
			"direccion",
			"finanzas",
			"comercial",
			"operacion",
			"marketing",
			"talento",
			"tecnologia",
			"proyectos",
		]);
	});

	it("c2) fuerza restringida una finanzas que vino abierta", () => {
		const n = normalizeProposal(
			proposal(
				nine.map((f) => (f.slug === "finanzas" ? folder("finanzas") : f)),
			),
		);
		expect(n.folders.find((f) => f.slug === "finanzas")?.restricted).toBe(true);
	});

	it("d) readPage arranca en el dominio y corta a la novena lectura", async () => {
		const urls: string[] = [];
		const results: unknown[] = [];
		const generateText = (async (o: Record<string, unknown>) => {
			const tools = o.tools as { leer_pagina: LeerPagina };
			for (let i = 0; i < PROPOSE_MAX_PAGES + 1; i++)
				results.push(
					await tools.leer_pagina.execute(
						{
							url:
								i === 0
									? "https://lagomarsino.com.ar"
									: `https://lagomarsino.com.ar/${i}`,
						},
						{},
					),
				);
			return { output: proposal(nine), steps: [], usage: {} };
		}) as never;
		const r = await proposeFolders(input, {
			generateText,
			readPage: async (u) => {
				urls.push(u);
				return okPage(u);
			},
		});
		expect(urls[0]).toBe("https://lagomarsino.com.ar");
		expect(urls).toHaveLength(PROPOSE_MAX_PAGES);
		expect(results[PROPOSE_MAX_PAGES]).toMatchObject({
			ok: false,
			reason: "limite_de_paginas",
		});
		expect(r.pagesRead).toBe(PROPOSE_MAX_PAGES);
	});

	it("e) el hint aparece en el prompt", async () => {
		let prompt = "";
		const generateText = (async (o: Record<string, unknown>) => {
			prompt = String(o.prompt);
			return { output: proposal(nine), steps: [], usage: {} };
		}) as never;
		await proposeFolders(
			{ ...input, hint: "venden autos usados" },
			{ generateText, readPage: async (u) => okPage(u) },
		);
		expect(prompt).toContain("venden autos usados");
		expect(prompt).toContain("lagomarsino.com.ar");
	});

	it("f) NoOutputGeneratedError devuelve output undefined", async () => {
		const generateText = (async () => ({
			get output() {
				throw new NoOutputGeneratedError();
			},
			steps: [],
			usage: {},
		})) as never;
		const r = await proposeFolders(input, {
			generateText,
			readPage: async (u) => okPage(u),
		});
		expect(r.output).toBeUndefined();
	});

	it("g) sin lecturas y sin hint fuerza found=false; con hint lo deja", async () => {
		const generateText = (async () => ({
			output: proposal(nine),
			steps: [],
			usage: {},
		})) as never;
		const deps = { generateText, readPage: async (u: string) => okPage(u) };
		const sin = await proposeFolders(input, deps);
		expect(sin.output?.found).toBe(false);
		const con = await proposeFolders({ ...input, hint: "autos" }, deps);
		expect(con.output?.found).toBe(true);
	});
});

describe("normalizeProposal (contrato 8 a 10)", () => {
	it("el schema acepta 7 y 11", () => {
		for (const n of [7, 11]) {
			const folders = Array.from({ length: n }, (_, i) => folder(`c${i}`));
			expect(folderProposalSchema.safeParse(proposal(folders)).success).toBe(
				true,
			);
		}
	});

	it("rellena a 8 desde GENERIC_FOLDERS y pasa el schema", () => {
		const n = normalizeProposal(
			proposal([folder("direccion", true), folder("skills"), folder("x1")]),
		);
		expect(n.folders).toHaveLength(8);
		expect(folderProposalSchema.safeParse(n).success).toBe(true);
		expect(n.folders.find((f) => f.slug === "finanzas")?.restricted).toBe(true);
	});

	it("11 entran, 10 salen con dirección y finanzas", () => {
		const folders = [
			...Array.from({ length: 9 }, (_, i) => folder(`c${i}`)),
			folder("direccion", true),
			folder("finanzas", true),
		];
		const n = normalizeProposal(proposal(folders));
		expect(n.folders).toHaveLength(10);
		const slugs = n.folders.map((f) => f.slug);
		expect(slugs).toContain("direccion");
		expect(slugs).toContain("finanzas");
	});

	it("si faltan ambas, arranca direccion, finanzas", () => {
		const n = normalizeProposal(
			proposal(Array.from({ length: 8 }, (_, i) => folder(`c${i}`))),
		);
		expect(n.folders.slice(0, 2).map((f) => f.slug)).toEqual([
			"direccion",
			"finanzas",
		]);
		expect(n.folders.length).toBeLessThanOrEqual(10);
	});

	it("dedup insensible a mayúsculas y espacios", () => {
		const n = normalizeProposal(
			proposal([folder("Direccion"), folder("direccion "), ...nine.slice(1)]),
		);
		expect(n.folders.filter((f) => f.slug === "direccion")).toHaveLength(1);
		expect(n.folders[0].restricted).toBe(true);
	});
});

describe("topes de la ficha de la empresa (R13 M1)", () => {
	const long = (n: number) => "x".repeat(n);
	const bloated = (): FolderProposal => ({
		...proposal(nine),
		company: {
			summary: long(1501),
			industry: long(201),
			sizeHint: long(201),
			location: long(201),
			products: Array.from({ length: 21 }, () => long(121)),
		},
	});

	it("el schema rechaza una ficha desmedida", () => {
		expect(folderProposalSchema.safeParse(bloated()).success).toBe(false);
		const company = proposal(nine).company;
		for (const patch of [
			{ summary: long(1501) },
			{ industry: long(201) },
			{ sizeHint: long(201) },
			{ location: long(201) },
			{ products: Array.from({ length: 21 }, () => "p") },
			{ products: [long(121)] },
		])
			expect(
				folderProposalSchema.safeParse({
					...proposal(nine),
					company: { ...company, ...patch },
				}).success,
			).toBe(false);
	});

	it("normalizeProposal recorta y el resultado pasa el schema", () => {
		const n = normalizeProposal(bloated());
		expect(n.company.summary).toHaveLength(1500);
		expect(n.company.industry).toHaveLength(200);
		expect(n.company.sizeHint).toHaveLength(200);
		expect(n.company.location).toHaveLength(200);
		expect(n.company.products).toHaveLength(20);
		expect(n.company.products.every((p) => p.length === 120)).toBe(true);
		expect(folderProposalSchema.safeParse(n).success).toBe(true);
	});

	it("null en tamaño y ubicación sigue siendo null", () => {
		const n = normalizeProposal(proposal(nine));
		expect(n.company.sizeHint).toBeNull();
		expect(n.company.location).toBeNull();
	});
});
