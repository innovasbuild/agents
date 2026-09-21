// La única forma de crear una arista del grafo (spec orquestación §6.2, D8).
// Sin triggers: quién encola qué se lee acá y en el registry.
import { isWorkflow, WORKFLOWS } from "./registry";

export interface EnqueueStore {
	/** Un 23505 sobre el índice único devuelve "ya_visto", no tira. */
	insertWorkItem(row: {
		tenantId: string;
		workflow: string;
		subjectType: string;
		subjectId: string;
		inputHash: string;
	}): Promise<"inserted" | "ya_visto">;
}

export type EnqueueResult =
	| { enqueued: true }
	| {
			enqueued: false;
			reason: "ya_visto" | "workflow_desconocido" | "sujeto_equivocado";
	  };

export async function enqueue(
	input: {
		tenantId: string;
		workflow: string;
		subjectType: string;
		subjectId: string;
		inputHash: string;
	},
	deps: { store: EnqueueStore },
): Promise<EnqueueResult> {
	if (!isWorkflow(input.workflow)) {
		return { enqueued: false, reason: "workflow_desconocido" };
	}
	if (WORKFLOWS[input.workflow].subjectType !== input.subjectType) {
		return { enqueued: false, reason: "sujeto_equivocado" };
	}
	const result = await deps.store.insertWorkItem(input);
	return result === "inserted"
		? { enqueued: true }
		: { enqueued: false, reason: "ya_visto" };
}
