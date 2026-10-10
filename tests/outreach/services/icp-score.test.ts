import { describe, expect, it, vi } from "vitest";
import { scoreContact } from "@/lib/outreach/services/icp-score";
import { contactRow, createFakeStore, TENANT } from "../fake-store";

const ANSWERS = {
	encaje_empresa: {
		type: "score",
		score: 1.9,
		confidence: 0.9,
		probabilities: {},
	},
	rol_decisor: {
		type: "score",
		score: 1.8,
		confidence: 0.88,
		probabilities: {},
	},
	excluir: { type: "boolean", probability: 0.03 },
};

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

describe("scoreContact", () => {
	it("manda el estado con la persona y la empresa, sin email", async () => {
		const store = createFakeStore();
		store.contacts.push({ ...contactRow(), title: "Gerente General" });
		store.accounts.push({
			id: "a1",
			tenantId: TENANT,
			domain: "acme.test",
			name: "Acme",
			ficha: {},
			firmographics: { employees: 120, industry: "envases" },
			researchedAt: "2026-09-01T00:00:00Z",
			expiresAt: "2026-12-01T00:00:00Z",
		} as never);
		const d = deps(store);

		await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		const args = d.evaluate.mock.calls[0][0] as {
			state: Record<string, unknown>;
		};
		expect(JSON.stringify(args.state)).not.toContain("@");
		expect(JSON.stringify(args.state)).toContain("Gerente General");
	});

	it("guarda los juicios crudos y devuelve el carril", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			deps(store),
		);

		expect(result).toMatchObject({ ok: true, lane: "calificado" });
		expect(store.contacts[0].icp).toMatchObject({
			encaje_empresa: { score: 1.9 },
			lane: "calificado",
		});
	});

	it.each([
		["sin_brain", "icp_sin_brain"],
		["falta", "icp_sin_niveles"],
	])(
		"ICP %s: se niega con %s y no llama al modelo",
		async (reason, refusal) => {
			const store = createFakeStore();
			store.contacts.push(contactRow());
			const d = deps(store, ANSWERS, { ok: false, reason, errors: [] });

			const result = await scoreContact(
				{ tenantId: TENANT, contactId: store.contacts[0].id },
				d,
			);

			expect(result).toMatchObject({ ok: false, reason: refusal });
			expect(d.evaluate).not.toHaveBeenCalled();
		},
	);

	it("brain caído: tira para que el runner reintente, sin llamar al modelo", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store, ANSWERS, {
			ok: false,
			reason: "brain_caido",
			errors: [],
		});

		await expect(
			scoreContact({ tenantId: TENANT, contactId: store.contacts[0].id }, d),
		).rejects.toThrow("No pude leer el brain para calificar el ICP");
		expect(d.evaluate).not.toHaveBeenCalled();
	});

	it("ICP inválido: la negativa lleva el primer error del bloque", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store, ANSWERS, {
			ok: false,
			reason: "invalido",
			errors: [
				"comercial/icp, línea 2: el nivel tiene que tener entre 10 y 400 caracteres",
			],
		});

		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		expect(result).toMatchObject({ ok: false, reason: "icp_invalido" });
		expect(result.ok === false && result.message).toContain(
			"comercial/icp, línea 2",
		);
		expect(d.evaluate).not.toHaveBeenCalled();
	});

	it("manda los niveles del brain como criterios y guarda la huella", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const d = deps(store);

		await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		const args = d.evaluate.mock.calls[0][0] as {
			questions: Record<string, { criteria?: string[]; instructions: string }>;
		};
		expect(d.loadIcp).toHaveBeenCalledWith(TENANT);
		expect(args.questions.encaje_empresa.criteria).toEqual(
			LEVELS.encaje_empresa,
		);
		expect(args.questions.excluir.instructions).toBe(LEVELS.excluir);
		expect(store.contacts[0].icp?.revision).toMatch(/^[0-9a-f]{16}$/);
	});

	it("una respuesta con forma inesperada va a revisión, no a calificado", async () => {
		const store = createFakeStore();
		store.contacts.push(contactRow());
		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			deps(store, { encaje_empresa: { type: "score" } }),
		);
		expect(result).toMatchObject({ ok: true, lane: "para_revisar" });
	});
});
