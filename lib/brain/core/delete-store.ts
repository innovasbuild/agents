// Escritor del borrado de páginas (spec etapa 18.1 §5.1). Aparte del
// BrainProvider a propósito: el contrato que comparten el agente y el MCP no
// gana ninguna operación de borrado. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "./wiki-store.ts";

export interface DeleteParams {
	tenantId: string;
	slug: string;
	expectedRevision: number;
	actorUserId: string;
	bindingId: string;
	cleanups: Array<{ slug: string; baseRevision: number; body: string }>;
}

export interface DeleteOutcome {
	deletedRevisions: number;
	cleaned: number;
	rulesRemoved: number;
}

export interface PageDeleter {
	delete(params: DeleteParams): Promise<DeleteOutcome>;
}

export function createSupabasePageDeleter(client: SupabaseClient): PageDeleter {
	return {
		async delete(params) {
			// Orden estable por slug: dos borrados concurrentes toman los locks de
			// las páginas a limpiar en el mismo orden y no se traban entre sí.
			const cleanups = [...params.cleanups].sort((a, b) =>
				a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
			);
			const { data, error } = await client.rpc("brain_delete_page", {
				p_tenant_id: params.tenantId,
				p_slug: params.slug,
				p_expected_revision: params.expectedRevision,
				p_actor: params.actorUserId,
				p_binding_id: params.bindingId,
				p_cleanups: cleanups.map((item) => ({
					slug: item.slug,
					base_revision: item.baseRevision,
					body: item.body,
				})),
			});
			if (error) {
				throw new WikiStoreError(
					error.code ?? "",
					error.message,
					error.details ?? "",
				);
			}
			const row = (
				data as Array<{
					deleted_revisions: number;
					cleaned: number;
					rules_removed: number;
				}> | null
			)?.[0];
			if (!row) {
				throw new Error("La base no confirmó el borrado de la página.");
			}
			return {
				deletedRevisions: row.deleted_revisions,
				cleaned: row.cleaned,
				rulesRemoved: row.rules_removed,
			};
		},
	};
}
