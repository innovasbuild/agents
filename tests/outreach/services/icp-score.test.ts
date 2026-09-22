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

function deps(store = createFakeStore(), answers: unknown = ANSWERS) {
	return {
		store,
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

	it("sin niveles cargados en el tenant no llama al modelo", async () => {
		const store = createFakeStore();
		store.tenants.set(TENANT, {
			...store.tenants.get(TENANT),
			config: { ...store.tenants.get(TENANT)?.config, icp: null },
		} as never);
		store.contacts.push(contactRow());
		const d = deps(store);

		const result = await scoreContact(
			{ tenantId: TENANT, contactId: store.contacts[0].id },
			d,
		);

		expect(result).toMatchObject({ ok: false, reason: "icp_sin_niveles" });
		expect(d.evaluate).not.toHaveBeenCalled();
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
