import { describe, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/outreach/ficha";
import { refuse } from "@/lib/outreach/result";
import {
	type ResearchResult,
	researchAccount,
} from "@/lib/outreach/services/research";
import {
	createRefreshFichas,
	type ResearchNode,
	refreshInputHash,
	SEED_LIMIT,
} from "@/lib/outreach/workflows/refresh-fichas";
import type { TenantWorkflowConfig } from "@/lib/workflows/config";
import { type PassContext, runWorkflowPass } from "@/lib/workflows/runner";
import type { WorkItem } from "@/lib/workflows/types";
import { createFakeWorkflowStore } from "../../workflows/fake-workflow-store";
import { createFakeStore, TENANT } from "../fake-store";

const NOW = new Date("2026-09-21T12:00:00Z");
const now = () => NOW;

const ficha: Ficha = {
	name: "Acme",
	domain: "acme.test",
	produce: "Envases",
	gana: null,
	compra: null,
	rompe_si_crece: null,
	gap_declarado: null,
	gap_demostrable: null,
	hechos: [{ hecho: "Abrió planta", url: "https://acme.test/n", fecha: null }],
	dolores: [],
	creditos_usados: 0,
};

function account(domain: string, expiresAt: string) {
	return {
		id: `acc-${domain}`,
		tenantId: TENANT,
		domain,
		name: domain.split(".")[0],
		ficha: { ...ficha, domain },
		researchedAt: "2026-05-01T12:00:00.000Z",
		expiresAt,
	};
}

function item(subjectId: string): WorkItem {
	return {
		id: 1,
		tenantId: TENANT,
		workflow: "refresh-fichas",
		subjectType: "account",
		subjectId,
		inputHash: "h",
		attempts: 1,
	};
}

function ctxWith(research: ResearchNode): PassContext {
	return {
		tenantId: TENANT,
		runId: "run-1",
		workflow: "refresh-fichas",
		optionalNodes: new Set(),
		async useNode<T>(name: string): Promise<T> {
			if (name !== "outreach/research") throw new Error(`nodo ${name}`);
			return research as T;
		},
	};
}

const ok: ResearchResult = {
	ok: true,
	cached: false,
	domain: "acme.test",
	name: "Acme",
	ficha,
	expiresAt: "2026-12-20T12:00:00.000Z",
};

describe("refresh-fichas", () => {
	it("siembra las cuentas vencidas con su huella, pidiendo hasta SEED_LIMIT", async () => {
		const store = createFakeStore();
		store.accounts.push(
			account("vieja.test", "2026-08-01T12:00:00.000Z"),
			account("nueva.test", "2026-09-20T12:00:00.000Z"),
			account("vigente.test", "2026-12-01T12:00:00.000Z"),
		);
		const list = vi.spyOn(store, "listAccountsToRefresh");

		const seeded = await createRefreshFichas({ store }).seed?.(TENANT, NOW);

		expect(list).toHaveBeenCalledWith(TENANT, NOW, SEED_LIMIT);
		expect(seeded).toEqual([
			{
				subjectId: "acc-vieja.test",
				inputHash: "acc-vieja.test:2026-08-01T12:00:00.000Z",
			},
			{
				subjectId: "acc-nueva.test",
				inputHash: "acc-nueva.test:2026-09-20T12:00:00.000Z",
			},
		]);
	});

	it("la huella es la cuenta y el vencimiento de la ficha que se reemplaza", () => {
		expect(
			refreshInputHash({
				id: "acc-acme.test",
				expiresAt: "2026-08-01T12:00:00Z",
			}),
		).toBe("acc-acme.test:2026-08-01T12:00:00Z");
	});

	it("investiga la cuenta con el tenant y la pasada del runner", async () => {
		const store = createFakeStore();
		store.accounts.push(account("acme.test", "2026-08-01T12:00:00.000Z"));
		const research = vi.fn(async () => ok);

		const outcome = await createRefreshFichas({ store }).runItem(
			item("acc-acme.test"),
			ctxWith(research),
		);

		expect(outcome).toEqual({ ok: true });
		expect(research).toHaveBeenCalledWith({
			tenantId: TENANT,
			runId: "run-1",
			workflow: "refresh-fichas",
			domain: "acme.test",
			name: "acme",
		});
	});

	it("un rechazo del research pasa tal cual: es respuesta de negocio", async () => {
		const store = createFakeStore();
		store.accounts.push(account("acme.test", "2026-08-01T12:00:00.000Z"));

		const outcome = await createRefreshFichas({ store }).runItem(
			item("acc-acme.test"),
			ctxWith(async () => refuse("sin_ancla", "no hay hechos con fuente")),
		);

		expect(outcome).toEqual({
			ok: false,
			reason: "sin_ancla",
			message: "no hay hechos con fuente",
		});
	});

	it("una cuenta que ya no existe se rechaza sin investigar", async () => {
		const research = vi.fn(async () => ok);

		const outcome = await createRefreshFichas({
			store: createFakeStore(),
		}).runItem(item("no-existe"), ctxWith(research));

		expect(outcome).toMatchObject({ ok: false, reason: "cuenta_inexistente" });
		expect(research).not.toHaveBeenCalled();
	});

	it("una caída del research tira, para que el runner reintente", async () => {
		const store = createFakeStore();
		store.accounts.push(account("acme.test", "2026-08-01T12:00:00.000Z"));

		await expect(
			createRefreshFichas({ store }).runItem(
				item("acc-acme.test"),
				ctxWith(async () => {
					throw new Error("gateway caído");
				}),
			),
		).rejects.toThrow("gateway caído");
	});

	it("de punta a punta con el runner: siembra, investiga y deja la ficha vigente", async () => {
		const outreach = createFakeStore();
		outreach.accounts.push(account("acme.test", "2026-08-01T12:00:00.000Z"));
		const workflows = createFakeWorkflowStore(now);
		const generate = vi.fn(async () => ({ output: ficha, pagesRead: 1 }));
		const research: ResearchNode = ({ tenantId, domain, name }) =>
			researchAccount(
				{ tenantId, userId: null, domain, name },
				{
					store: outreach,
					now,
					readPage: async () => ({ ok: false, reason: "x", message: "x" }),
					generate,
				},
			);
		const config: TenantWorkflowConfig = {
			cadenceMinutes: 60,
			itemsPerTick: 5,
			optionalNodes: new Set(),
			params: {},
		};

		const result = await runWorkflowPass(
			{
				tenant: { id: TENANT, timezone: "America/Argentina/Buenos_Aires" },
				workflow: "refresh-fichas",
				config,
			},
			{
				store: workflows,
				impl: createRefreshFichas({ store: outreach }),
				nodes: { "outreach/research": research },
				now,
				clockBudgetMs: 200_000,
				leaseSeconds: 600,
			},
		);

		expect(result).toMatchObject({ status: "ok", claimed: 1, ok: 1 });
		expect(generate).toHaveBeenCalledTimes(1);
		expect(outreach.accounts[0].researchedAt).toBe(NOW.toISOString());
		expect(new Date(outreach.accounts[0].expiresAt).getTime()).toBeGreaterThan(
			NOW.getTime(),
		);
		expect(outreach.events.at(-1)).toMatchObject({
			type: "investigado",
			actor_user_id: null,
		});
	});
});
