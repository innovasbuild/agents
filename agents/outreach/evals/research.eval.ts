import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import { EVAL_TENANT_ID, resetEvalTenant } from "./support";

export default defineEval({
	description:
		"S4: research_account usa el subagente researcher y guarda una ficha con hechos con URL.",
	timeoutMs: 300_000,
	async test(t) {
		await resetEvalTenant();
		const admin = createAdminClient();
		await admin
			.from("accounts")
			.delete()
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("domain", "vercel.com");
		await t.send(
			"Investigá la empresa del dominio vercel.com con research_account y decime cuántos hechos con fuente encontraste.",
		);
		t.succeeded();
		t.calledTool("research_account");
		t.calledSubagent("researcher");
		const { data } = await admin
			.from("accounts")
			.select("ficha")
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("domain", "vercel.com")
			.maybeSingle();
		const hechos =
			(data?.ficha as { hechos?: Array<{ url: string }> } | undefined)
				?.hechos ?? [];
		if (hechos.length === 0 || hechos.some((h) => !h.url.startsWith("http"))) {
			throw new Error(
				`la ficha no quedó guardada con hechos con URL: ${JSON.stringify(data)}`,
			);
		}
	},
});
