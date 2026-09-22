// Workflow icp-scoring (spec etapa 13 §7): tres carriles después de calificar
// un contacto. Sin sembrador: los ítems los encola target-search aguas abajo.

import type { PassContext, WorkflowImpl } from "../../workflows/runner";
import type { ItemOutcome, WorkItem } from "../../workflows/types";
import type { IcpScoreResult } from "../services/icp-score";

/** El nodo outreach/icp-score tal como lo arma la puerta (mismo patrón que
 * ResearchNode en refresh-fichas.ts): el tenant y la pasada los pone el
 * runner, nunca el modelo, para que la medición del gasto quede asentada en
 * la corrida correcta. */
export type IcpScoreNode = (input: {
	tenantId: string;
	runId: string;
	workflow: string;
	contactId: string;
}) => Promise<IcpScoreResult>;

export function createIcpScoringWorkflow(): WorkflowImpl {
	return {
		async runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome> {
			// biome-ignore lint/correctness/useHookAtTopLevel: ctx.useNode es PassContext.useNode (runner.ts), no un hook de React; el nombre solo coincide con la convención use*.
			const node = await ctx.useNode<IcpScoreNode>("outreach/icp-score");
			const result = await node({
				tenantId: ctx.tenantId,
				runId: ctx.runId,
				workflow: ctx.workflow,
				contactId: item.subjectId,
			});

			if (!result.ok) {
				// Guard de infraestructura/config (p. ej. icp_sin_niveles o
				// contacto_inexistente): no es una calificación, es un rechazo.
				return { ok: false, reason: result.reason, message: result.message };
			}

			if (result.lane === "descartado") {
				// Respuesta de negocio: el contacto no entra en el ICP. No se
				// reintenta ni sigue aguas abajo.
				return {
					ok: false,
					reason: result.reason,
					message: `contacto descartado del ICP: ${result.reason}`,
				};
			}

			if (result.lane === "para_revisar") {
				// Ni avanza ni se descarta: queda esperando a una persona.
				return { ok: true };
			}

			return {
				ok: true,
				downstream: [{ subjectId: item.subjectId, inputHash: item.subjectId }],
			};
		},
	};
}
