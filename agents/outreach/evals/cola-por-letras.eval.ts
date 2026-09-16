import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	EVAL_TENANT_ID,
	ensureContact,
	resetEvalTenant,
	seedPendingPiece,
} from "./support";

export default defineEval({
	description:
		"'A y C mandalas, B con este cambio, D descartala' produce send_email para A y C, update_queue_item para B y reject_queue_item para D.",
	timeoutMs: 300_000,
	async test(t) {
		await resetEvalTenant();
		const keys = [
			"em:laura@acme-eval.test",
			"em:sofia@acme-eval.test",
			"em:marta@acme-eval.test",
			"em:juan@acme-eval.test",
		];
		await ensureContact(keys[1], "sofia@acme-eval.test", "Sofía Paz");
		await ensureContact(keys[2], "marta@acme-eval.test", "Marta Díaz");
		await ensureContact(keys[3], "juan@acme-eval.test", "Juan Ríos");
		const ids: string[] = [];
		for (const key of keys) ids.push(await seedPendingPiece(key));

		await t.send("Mostrame la cola por letras.");
		t.calledTool("list_queue");
		await t.send(
			"A y C mandalas, B cambiale el asunto a 'Otra idea para Acme', D descartala porque no es ICP.",
		);
		t.calledTool("update_queue_item");
		t.calledTool("reject_queue_item");
		await t.respondAll("cancel");
		// calledTool matchea status "completed" por default; cancelada, la llamada queda "rejected".
		t.calledTool("send_email", { status: "rejected", count: 2 });

		const { data } = await createAdminClient()
			.from("queue_items")
			.select("id, status, subject")
			.eq("tenant_id", EVAL_TENANT_ID)
			.in("id", ids);
		const byId = new Map((data ?? []).map((row) => [row.id, row]));
		if (byId.get(ids[1])?.subject !== "Otra idea para Acme")
			throw new Error("B no quedó con el asunto nuevo");
		if (byId.get(ids[3])?.status !== "rejected")
			throw new Error("D no quedó descartada");
		if (
			byId.get(ids[0])?.status !== "pending" ||
			byId.get(ids[2])?.status !== "pending"
		)
			throw new Error("A o C cambiaron de estado pese a cancelar el envío");
	},
});
