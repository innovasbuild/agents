// Workflow target-search (spec etapa 13 §4.1). El sembrador toma los focos
// activos; cada ítem es una página de resultados.
import type { ItemOutcome, WorkItem } from "../../workflows/types";
import type { PassContext, WorkflowImpl } from "../../workflows/runner";
import { focusPageHash } from "../focus";
import { isRefusal } from "../result";
import type { FocusRow } from "../store";
import type { SearchPageResult } from "../services/target-search";

export interface TargetSearchWorkflowDeps {
	loadFocuses: (tenantId: string) => Promise<FocusRow[]>;
	loadFocus: (tenantId: string, id: string) => Promise<FocusRow | null>;
	search: (focus: FocusRow, page: number) => Promise<SearchPageResult>;
	updateFocus: (
		tenantId: string,
		id: string,
		patch: Partial<
			Pick<FocusRow, "status" | "accountsFound" | "contactsFound">
		>,
	) => Promise<void>;
	recordCredits: (credits: number, runId: string) => Promise<void>;
}

/** De "f1:p3" saca 3. Una huella rota vale como página 1. */
function pageOf(inputHash: string): number {
	const page = Number(inputHash.split(":p")[1]);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

export function createTargetSearchWorkflow(
	deps: TargetSearchWorkflowDeps,
): WorkflowImpl {
	return {
		async seed(tenantId: string) {
			const focuses = await deps.loadFocuses(tenantId);
			return focuses.map((focus) => ({
				subjectId: focus.id,
				// Una página por cada 100 empresas ya encontradas: la que sigue. Si
				// se sembrara siempre la página 1, enqueue() la rechazaría como
				// ya_visto desde la segunda pasada.
				inputHash: focusPageHash(
					focus.id,
					Math.floor(focus.accountsFound / 100) + 1,
				),
			}));
		},

		async runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome> {
			const focus = await deps.loadFocus(item.tenantId, item.subjectId);
			if (!focus) {
				return {
					ok: false,
					reason: "foco_inexistente",
					message: `el foco ${item.subjectId} ya no está`,
				};
			}

			const page = pageOf(item.inputHash);
			const result = await deps.search(focus, page);

			// Los créditos se asientan aunque la página no sirva: se gastaron igual.
			if (!isRefusal(result) && result.creditsUsed > 0) {
				await deps.recordCredits(result.creditsUsed, ctx.runId);
			}
			if (isRefusal(result)) return result;

			const accountsFound = focus.accountsFound + result.accounts;
			const contactsFound = focus.contactsFound + result.contactIds.length;
			const agotado =
				!result.hasMore ||
				accountsFound >= focus.maxAccounts ||
				contactsFound >= focus.maxContacts;

			await deps.updateFocus(item.tenantId, focus.id, {
				accountsFound,
				contactsFound,
				...(agotado ? { status: "agotado" as const } : {}),
			});

			// La página siguiente es otro ítem del mismo workflow: lo encola el
			// sembrador de la próxima pasada solo si el foco sigue activo.
			return {
				ok: true,
				downstream: result.contactIds.map((contactId) => ({
					subjectId: contactId,
					inputHash: contactId,
				})),
			};
		},
	};
}
