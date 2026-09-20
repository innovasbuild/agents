import { describe, expect, it, vi } from "vitest";
import type { Canon } from "@/lib/outreach/canon";
import { CanonUnavailableError } from "@/lib/outreach/canon";
import { DEFAULT_OUTREACH_MODELS } from "@/lib/outreach/config";
import { emptyGateRules, parseGateBlocks } from "@/lib/outreach/gate-blocks";
import { draftMessage } from "@/lib/outreach/services/draft";
import {
	contactRow,
	createFakeStore,
	PASSING_BODY,
	TENANT,
	USER,
} from "../fake-store";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const caller = {
	tenantId: TENANT,
	userId: USER,
	role: "tenant_member",
	email: "ana@innov.test",
};
const now = () => new Date("2026-09-15T12:00:00Z");
const canon: Canon = {
	available: true,
	pages: [
		{
			tag: "canon:icp",
			slug: "comercial/icp",
			title: "ICP",
			body: "A quién le servimos.",
		},
	],
	voice: [],
	rules: emptyGateRules(),
};
// Sin binding de brain, o con brain sin páginas de canon: no se redacta.
const CANON_VACIO: Canon = {
	available: false,
	pages: [],
	voice: [],
	rules: emptyGateRules(),
};
const good = {
	subject: "Crecer sin sumar gente al back office",
	body: PASSING_BODY,
	hook: "h1",
	vector: "v1",
	idioma: "es_ar",
	ancla: { hecho: "Abrió planta en Rafaela", fuente: "https://acme.test/n" },
};

function seeded() {
	const store = createFakeStore();
	store.contacts.push(contactRow());
	store.accounts.push({
		id: "a1",
		tenantId: TENANT,
		domain: "acme.test",
		name: "Acme",
		ficha: {
			name: "Acme",
			domain: "acme.test",
			produce: null,
			gana: null,
			compra: null,
			rompe_si_crece: null,
			gap_declarado: null,
			gap_demostrable: null,
			hechos: [
				{
					hecho: "Abrió planta en Rafaela",
					url: "https://acme.test/n",
					fecha: null,
				},
			],
			creditos_usados: 0,
		},
		researchedAt: "2026-09-01T00:00:00Z",
		expiresAt: "2026-11-30T00:00:00Z",
	});
	return store;
}

describe("draftMessage", () => {
	it("redacta con el modelo de msg1 del tenant y devuelve la pieza que pasa el gate", async () => {
		const store = seeded();
		const generate = vi.fn(async () => ({
			output: good,
			usage: { inputTokens: 10 },
		}));
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({
			ok: true,
			subject: good.subject,
			attempts: 1,
			gate: { status: "ok" },
		});
		expect(generate).toHaveBeenCalledWith(
			"anthropic/claude-opus-5",
			expect.any(String),
			expect.any(String),
		);
		expect(store.queue).toHaveLength(0);
	});

	it("reintenta pasándole las violaciones y corta a los 3 intentos", async () => {
		const store = seeded();
		const bad = { ...good, body: `${PASSING_BODY}\nQuedo a disposición.` };
		const prompts: string[] = [];
		const generate = vi.fn(
			async (_model: string, _system: string, prompt: string) => {
				prompts.push(prompt);
				return { output: bad, usage: {} };
			},
		);
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({ ok: false, reason: "gate" });
		expect(generate).toHaveBeenCalledTimes(3);
		expect(prompts[1]).toContain("quedo a disposicion");
	});

	it("aplica los vetos del canon", async () => {
		const store = seeded();
		const rules = parseGateBlocks(
			"```gate\nveto: segunda planta\n```",
			"comercial/gate",
		);
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{
				store,
				loadCanon: async () => ({ ...canon, rules }),
				generate: async () => ({ output: good, usage: {} }),
				now,
			},
		);
		expect(result).toMatchObject({ ok: false, reason: "gate" });
	});

	it("una salida con hook fuera de la lista cuenta como intento fallido", async () => {
		const store = seeded();
		const generate = vi
			.fn()
			.mockResolvedValueOnce({
				output: { ...good, hook: "h_inventado" },
				usage: {},
			})
			.mockResolvedValue({ output: good, usage: {} });
		expect(
			await draftMessage(
				{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
				{ store, loadCanon: async () => canon, generate, now },
			),
		).toMatchObject({ ok: true, attempts: 2 });
	});

	it("negativas: contacto inexistente, sin ficha vigente, canon caído", async () => {
		const deps = (store = seeded()) => ({
			store,
			loadCanon: async () => canon,
			generate: async () => ({ output: good, usage: {} }),
			now,
		});
		expect(
			await draftMessage(
				{ caller, contactKey: "em:nadie@acme.test", kind: "msg1" },
				deps(),
			),
		).toMatchObject({ reason: "contacto_inexistente" });
		const noAccount = seeded();
		noAccount.accounts = [];
		expect(
			await draftMessage(
				{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
				deps(noAccount),
			),
		).toMatchObject({ reason: "falta_research" });
		expect(
			await draftMessage(
				{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
				{
					...deps(),
					loadCanon: async () => {
						throw new CanonUnavailableError(new Error("x"));
					},
				},
			),
		).toMatchObject({ reason: "canon_no_disponible" });
	});

	it("ya no rechaza un followup_2: los follow-ups llegaron con la escucha", async () => {
		const store = seeded();
		store.contacts[0].gmailThreadId = "th-1";
		const generate = vi.fn(async () => ({ output: good, usage: {} }));
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "followup_2" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({ ok: true, attempts: 1 });
		expect(generate).toHaveBeenCalledWith(
			DEFAULT_OUTREACH_MODELS.draft_followup,
			expect.any(String),
			expect.any(String),
		);
	});

	it("un followup necesita que el contacto ya tenga un hilo abierto", async () => {
		// Un contacto sin gmail_thread_id no puede recibir un follow-up en hilo.
		const store = seeded();
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "followup_2" },
			{
				store,
				loadCanon: async () => canon,
				generate: async () => ({ output: good, usage: {} }),
				now,
			},
		);
		expect(result).toMatchObject({ ok: false, reason: "sin_hilo" });
	});

	it("un canon vacío (tenant sin brain o sin canon cargado) no llama al modelo", async () => {
		const generate = vi.fn(async () => ({ output: good, usage: {} }));
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store: seeded(), loadCanon: async () => CANON_VACIO, generate, now },
		);
		expect(result).toMatchObject({
			ok: false,
			reason: "canon_no_disponible",
			message: expect.stringContaining("no está conectado"),
		});
		expect(generate).not.toHaveBeenCalled();
	});

	it("sin hechos con fuente en la ficha, no hay ancla y no se llama al modelo", async () => {
		const store = seeded();
		store.accounts[0].ficha = { ...store.accounts[0].ficha, hechos: [] };
		const generate = vi.fn(async () => ({ output: good, usage: {} }));
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({ ok: false, reason: "sin_ancla" });
		expect(generate).not.toHaveBeenCalled();
	});

	it("un ancla que no sale de la ficha cuenta como intento fallido y se corrige en el reintento", async () => {
		const store = seeded();
		const invented = {
			...good,
			ancla: {
				hecho: "Un hecho que no está en la ficha",
				fuente: "https://acme.test/inventado",
			},
		};
		const prompts: string[] = [];
		const generate = vi
			.fn()
			.mockImplementationOnce(
				async (_model: string, _system: string, prompt: string) => {
					prompts.push(prompt);
					return { output: invented, usage: {} };
				},
			)
			.mockImplementationOnce(
				async (_model: string, _system: string, prompt: string) => {
					prompts.push(prompt);
					return { output: good, usage: {} };
				},
			);
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({ ok: true, attempts: 2 });
		expect(prompts[1]).toContain("el ancla no sale de la ficha");
	});

	it("tres intentos con un ancla inventada agotan los intentos", async () => {
		const store = seeded();
		const invented = {
			...good,
			ancla: {
				hecho: "Un hecho que no está en la ficha",
				fuente: "https://acme.test/inventado",
			},
		};
		const generate = vi.fn(async () => ({ output: invented, usage: {} }));
		const result = await draftMessage(
			{ caller, contactKey: "em:laura@acme.test", kind: "msg1" },
			{ store, loadCanon: async () => canon, generate, now },
		);
		expect(result).toMatchObject({ ok: false, reason: "gate" });
		expect(generate).toHaveBeenCalledTimes(3);
	});
});
