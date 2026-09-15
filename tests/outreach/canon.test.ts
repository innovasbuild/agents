import { describe, expect, it, vi } from "vitest";
import type { BrainPage, BrainProvider } from "@/lib/brain/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { CanonUnavailableError, loadCanon } = await import(
	"@/lib/outreach/canon"
);

const page = (slug: string, tags: string[], body: string): BrainPage => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo",
	tags,
	frontmatter: {},
	body,
	revision: 1,
	updatedAt: "2026-09-15",
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
		upsert: async () => {
			throw new Error("no se usa");
		},
	};
}

describe("loadCanon", () => {
	it("sin brain, no hay canon y el gate corre con la base", async () => {
		expect(await loadCanon(null, "ana")).toEqual({
			available: false,
			pages: [],
			voice: [],
			rules: {
				vetos: [],
				maxChars: { all: null, byChannel: {} },
				formal: false,
				errors: [],
			},
		});
	});

	it("lee canon por tag, separa la voz del ejecutor y junta los vetos del tenant y del ejecutor", async () => {
		const brain = brainWith([
			page("comercial/icp", ["canon:icp"], "ICP"),
			page("marketing/voz-marca", ["canon:voz"], "Voz de marca"),
			page(
				"marketing/voz-ana",
				["canon:voz", "executor:ana"],
				"Voz de Ana\n```gate\nveto_literal: sinergia total\n```",
			),
			page(
				"marketing/voz-beto",
				["canon:voz", "executor:beto"],
				"Voz de Beto\n```gate\nveto_literal: no aplica\n```",
			),
			page(
				"comercial/gate",
				["canon:gate"],
				"```gate\nveto: clientes ... (bid|fao)\n```",
			),
		]);
		const canon = await loadCanon(brain, "ana");
		expect(canon.available).toBe(true);
		expect(canon.pages.map((p) => p.slug).sort()).toEqual([
			"comercial/icp",
			"marketing/voz-marca",
		]);
		expect(canon.voice.map((p) => p.slug)).toEqual(["marketing/voz-ana"]);
		expect(canon.rules.vetos.map((v) => v.phrase).sort()).toEqual([
			"clientes ... (bid|fao)",
			"sinergia total",
		]);
	});

	it("un brain que falla es CanonUnavailableError (el gate no puede correr sin sus vetos)", async () => {
		const broken: BrainProvider = {
			search: async () => {
				throw new Error("timeout");
			},
			read: async () => {
				throw new Error("x");
			},
			upsert: async () => {
				throw new Error("x");
			},
		};
		await expect(loadCanon(broken, "ana")).rejects.toBeInstanceOf(
			CanonUnavailableError,
		);
	});
});
