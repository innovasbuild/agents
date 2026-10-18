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
		listMeta: async () => [],
		listLinks: async () => [],
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

const VALID =
	"```hooks\nh_uno: Uno\n```\n```vectores\nv_uno: Vector => h_uno\n```";

describe("reflectMarco", () => {
	it("marco válido: aplica y devuelve los contadores", async () => {
		const s = store();
		expect(await reflectMarco("t1", { brain: brain(VALID), store: s })).toEqual(
			{
				ok: true,
				upserts: 2,
				deactivated: 1,
				unchanged: 0,
			},
		);
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
