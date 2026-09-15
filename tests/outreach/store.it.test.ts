// Solo con OUTREACH_IT=1 y .env.eval cargado (npm run test:it). Usa el tenant
// sembrado por supabase/seed-evals.sql y deja la cola vacía al terminar.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "@/lib/agents/eval-auth";
import {
	createSupabaseOutreachStore,
	type OutreachStore,
} from "@/lib/outreach/store";
import { createAdminClient } from "@/lib/supabase/admin";

const TENANT = "e7a1e7a1-0000-0000-0000-0000000000aa";
const USER = "e7a1e7a1-0000-0000-0000-000000000001";
const enabled =
	process.env.OUTREACH_IT === "1" &&
	isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

describe.skipIf(!enabled)("store de outreach contra Supabase local", () => {
	// vitest ejecuta el cuerpo de un describe salteado: el cliente se crea en
	// beforeAll para que `npm test` sin variables de Supabase no tire.
	let admin: SupabaseClient;
	let store: OutreachStore;

	beforeAll(() => {
		admin = createAdminClient();
		store = createSupabaseOutreachStore(admin);
	});

	afterAll(async () => {
		await admin.from("queue_items").delete().eq("tenant_id", TENANT);
	});

	it("lee ejecutor, listas y contactos sembrados", async () => {
		expect((await store.loadExecutor(TENANT, USER))?.slug).toBe("eval");
		const tenant = await store.loadTenantOutreach(TENANT);
		expect(tenant?.values.hook).toContain("h_eval");
		expect(tenant?.defaultHooks.v1_eval).toBe("h_eval");
		expect(
			(await store.findContactsByKeys(TENANT, ["em:laura@acme-eval.test"]))[0]
				?.email,
		).toBe("laura@acme-eval.test");
		expect(
			(await store.findAccount(TENANT, "acme-eval.test"))?.ficha.hechos,
		).toHaveLength(1);
	});

	it("encola una sola pieza viva, transiciona condicional y cuenta envíos", async () => {
		await admin.from("queue_items").delete().eq("tenant_id", TENANT);
		const [contact] = await store.findContactsByKeys(TENANT, [
			"em:laura@acme-eval.test",
		]);
		const row = {
			tenantId: TENANT,
			contactId: contact.id,
			contactKey: contact.contactKey,
			executorUserId: USER,
			kind: "msg1" as const,
			toEmail: "laura@acme-eval.test",
			subject: "Asunto",
			body: "Cuerpo",
			hook: "h_eval",
			vector: "v1_eval",
			idioma: "es_ar",
			ancla: {
				hecho: "Abrió una planta",
				fuente: "https://acme-eval.test/noticias/rafaela",
			},
			draftOriginal: { subject: "Asunto", body: "Cuerpo" },
			gateResult: {
				status: "ok" as const,
				violations: [],
				warnings: [],
				notes: [],
			},
			replyToMessageId: null,
			gmailThreadId: null,
		};
		const item = await store.insertQueueItem(row);
		expect(item).not.toBe("pieza_viva");
		expect(await store.insertQueueItem(row)).toBe("pieza_viva");
		const id = (item as { id: string }).id;
		const sentAt = new Date().toISOString();
		expect(
			await store.transitionQueueItem(TENANT, id, "pending", {
				status: "sent",
				sentAt,
				gmailThreadId: "thread-1",
			}),
		).not.toBeNull();
		expect(
			await store.transitionQueueItem(TENANT, id, "pending", {
				status: "approved",
			}),
		).toBeNull();
		const sent = await store.countSent(TENANT, {
			since: new Date(Date.now() - 60_000),
			toEmail: "laura@acme-eval.test",
		});
		expect(sent.count).toBe(1);
		expect(
			(
				await store.countSent(TENANT, {
					since: new Date(Date.now() - 60_000),
					toEmail: "laura@acme-eval.test",
					excludeThreadId: "thread-1",
				})
			).count,
		).toBe(0);
		await store.insertEvents([
			{
				tenant_id: TENANT,
				actor_user_id: USER,
				contact_key: contact.contactKey,
				channel: "email",
				type: "encolado",
				summary: "it",
				payload: { queue_item_id: id },
				run_id: null,
			},
			{
				tenant_id: TENANT,
				actor_user_id: USER,
				contact_key: contact.contactKey,
				channel: "email",
				type: "encolado",
				summary: "it",
				payload: { queue_item_id: id },
				run_id: null,
			},
		]);
		const { count, error } = await admin
			.from("events")
			.select("id", { count: "exact", head: true })
			.eq("tenant_id", TENANT)
			.eq("type", "encolado")
			.eq("payload->>queue_item_id", id);
		expect(error).toBeNull();
		expect(count).toBe(1);
	});
});
