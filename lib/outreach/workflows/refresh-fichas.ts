// Primer workflow de la plataforma (spec orquestación §2): refresca las fichas
// de cuentas vencidas sin que nadie abra el chat. El trabajo nace del paso del
// tiempo, así que tiene sembrador (registry: entry "seed"). Imports relativos:
// lo usa el schedule de eve.
import type { WorkflowImpl } from "../../workflows/runner";
import { refuse } from "../result";
import type { ResearchResult } from "../services/research";
import type { OutreachStore } from "../store";

/** Cuántas cuentas siembra una pasada. El runner procesa menos (itemsPerTick):
 * el resto queda pending para la próxima. */
export const SEED_LIMIT = 50;

/** El nodo outreach/research tal como lo arma la puerta. El tenant y la pasada
 * los pone el runner, nunca el modelo: la puerta los usa para asentar el
 * consumo en la corrida correcta. */
export type ResearchNode = (input: {
	tenantId: string;
	runId: string;
	workflow: string;
	domain: string;
	name: string | null;
}) => Promise<ResearchResult>;

/** Spec §6.3: cuenta + vencimiento de la ficha que se reemplaza. Una ficha
 * refrescada vence en otra fecha, así que su próximo vencimiento es una huella
 * nueva. Va por id y no por dominio porque una cuenta es un dominio por
 * tenant, y `accounts.domain` admite hasta 253 caracteres: pegado al
 * vencimiento puede superar el check de 200 de `work_items.input_hash`. */
export function refreshInputHash(account: {
	id: string;
	expiresAt: string;
}): string {
	return `${account.id}:${account.expiresAt}`;
}

export function createRefreshFichas(deps: {
	store: Pick<OutreachStore, "listAccountsToRefresh" | "findAccountById">;
}): WorkflowImpl {
	return {
		async seed(tenantId, now) {
			const accounts = await deps.store.listAccountsToRefresh(
				tenantId,
				now,
				SEED_LIMIT,
			);
			return accounts.map((account) => ({
				subjectId: account.id,
				inputHash: refreshInputHash(account),
			}));
		},

		async runItem(item, ctx) {
			const account = await deps.store.findAccountById(
				ctx.tenantId,
				item.subjectId,
			);
			if (!account)
				return refuse(
					"cuenta_inexistente",
					`la cuenta ${item.subjectId} ya no existe`,
				);
			// biome-ignore lint/correctness/useHookAtTopLevel: ctx.useNode es PassContext.useNode (runner.ts), no un hook de React; el nombre solo coincide con la convención use*.
			const research = await ctx.useNode<ResearchNode>("outreach/research");
			const result = await research({
				tenantId: ctx.tenantId,
				runId: ctx.runId,
				workflow: ctx.workflow,
				domain: account.domain,
				name: account.name,
			});
			return result.ok
				? { ok: true }
				: { ok: false, reason: result.reason, message: result.message };
		},
	};
}
