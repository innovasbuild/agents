// Escritor de carpetas (spec etapa 26 §3.1). Aparte del BrainProvider: agente y
// MCP no crean ni borran carpetas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "./wiki-store.ts";

export interface FolderParams {
	tenantId: string;
	actorUserId: string;
	path: string;
	description: string;
}

export interface FolderWriter {
	create(params: FolderParams): Promise<void>;
	describe(params: FolderParams): Promise<void>;
	remove(params: Omit<FolderParams, "description">): Promise<void>;
}

export function createSupabaseFolderWriter(
	client: SupabaseClient,
): FolderWriter {
	const rpc = async (fn: string, args: Record<string, unknown>) => {
		const { error } = await client.rpc(fn, args);
		if (error)
			throw new WikiStoreError(
				error.code ?? "",
				error.message,
				error.details ?? "",
			);
	};
	return {
		create: (p) =>
			rpc("brain_create_folder", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
				p_description: p.description,
			}),
		describe: (p) =>
			rpc("brain_set_folder_description", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
				p_description: p.description,
			}),
		remove: (p) =>
			rpc("brain_delete_folder", {
				p_tenant: p.tenantId,
				p_actor: p.actorUserId,
				p_path: p.path,
			}),
	};
}
