// Estado del research de carpetas en onboarding_research (spec 27 §5.2). Solo
// escribe el service role: el cliente `admin` que recibe es el de la plataforma.
// Imports relativos: lo usan módulos de eve.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FolderProposal } from "./services/propose-folders";

export type ResearchRow = {
	status: "running" | "done" | "error";
	hint: string | null;
	result: FolderProposal | null;
	error: string | null;
	updatedAt: string;
};

export interface ResearchStore {
	start(tenantId: string, hint: string | null): Promise<void>;
	finish(tenantId: string, result: FolderProposal): Promise<void>;
	fail(tenantId: string, error: string): Promise<void>;
	read(tenantId: string): Promise<ResearchRow | null>;
}

export function createResearchStore(admin: SupabaseClient): ResearchStore {
	const table = () => admin.from("onboarding_research");
	const check = (error: { message: string } | null) => {
		if (error) throw new Error(error.message);
	};
	const touch = () => new Date().toISOString();
	return {
		async start(tenantId, hint) {
			const { error } = await table().upsert({
				tenant_id: tenantId,
				status: "running",
				hint,
				result: null,
				error: null,
				updated_at: touch(),
			});
			check(error);
		},
		async finish(tenantId, result) {
			const { error } = await table()
				.update({
					status: "done",
					result: result as never,
					error: null,
					updated_at: touch(),
				})
				.eq("tenant_id", tenantId);
			check(error);
		},
		async fail(tenantId, message) {
			const { error } = await table()
				.update({ status: "error", error: message, updated_at: touch() })
				.eq("tenant_id", tenantId);
			check(error);
		},
		async read(tenantId) {
			const { data, error } = await table()
				.select("status, hint, result, error, updated_at")
				.eq("tenant_id", tenantId)
				.maybeSingle();
			check(error);
			if (!data) return null;
			return {
				status: data.status as ResearchRow["status"],
				hint: data.hint,
				result: data.result as FolderProposal | null,
				error: data.error,
				updatedAt: data.updated_at,
			};
		},
	};
}
