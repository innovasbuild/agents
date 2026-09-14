// Acceso a Supabase del proveedor wiki. Sin lógica: la valida wiki.ts y la
// prueban los tests pgTAP de las funciones. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
	BrainAuthor,
	BrainPage,
	BrainPageSummary,
	BrainSearchInput,
	BrainStatus,
} from "./types.ts";

export class WikiStoreError extends Error {
	readonly code: string;
	readonly details: string;

	constructor(code: string, message: string, details: string) {
		super(message);
		this.name = "WikiStoreError";
		this.code = code;
		this.details = details;
	}
}

export interface UpsertParams {
	tenantId: string;
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	reason: string;
	baseRevision: number | null;
	authorKind: BrainAuthor["kind"];
	authorUserId: string | null;
	sessionId: string | null;
	bindingId: string;
	sourcePath: string | null;
	sourceHash: string | null;
}

export interface WikiStore {
	search(
		tenantId: string,
		input: BrainSearchInput,
	): Promise<BrainPageSummary[]>;
	read(tenantId: string, slug: string): Promise<BrainPage | null>;
	upsert(params: UpsertParams): Promise<{ slug: string; revision: number }>;
}

interface PostgrestLikeError {
	code?: string;
	message: string;
	details?: string | null;
}

function storeError(error: PostgrestLikeError): WikiStoreError {
	return new WikiStoreError(
		error.code ?? "",
		error.message,
		error.details ?? "",
	);
}

export function createSupabaseWikiStore(client: SupabaseClient): WikiStore {
	return {
		async search(tenantId, input) {
			const { data, error } = await client.rpc("brain_search_pages", {
				p_tenant_id: tenantId,
				p_query: input.query,
				p_category: input.category ?? null,
				p_tag: input.tag ?? null,
				p_include_archived: input.includeArchived ?? false,
				p_limit: input.limit ?? 8,
			});
			if (error) throw storeError(error);
			return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
				slug: String(row.slug),
				title: String(row.title),
				category: String(row.category),
				status: row.status as BrainStatus,
				tags: (row.tags as string[] | null) ?? [],
				snippet: String(row.snippet ?? ""),
				updatedAt: String(row.updated_at),
			}));
		},

		async read(tenantId, slug) {
			const { data, error } = await client
				.from("brain_pages")
				.select(
					"slug, title, category, status, tags, frontmatter, body, revision, updated_at",
				)
				.eq("tenant_id", tenantId)
				.eq("slug", slug)
				.maybeSingle();
			if (error) throw storeError(error);
			if (!data) return null;
			const row = data as Record<string, unknown>;
			return {
				slug: row.slug as string,
				title: row.title as string,
				category: row.category as string,
				status: row.status as BrainStatus,
				tags: (row.tags as string[] | null) ?? [],
				frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
				body: row.body as string,
				revision: row.revision as number,
				updatedAt: row.updated_at as string,
			};
		},

		async upsert(params) {
			const { data, error } = await client.rpc("brain_upsert_page", {
				p_tenant_id: params.tenantId,
				p_slug: params.slug,
				p_title: params.title,
				p_category: params.category,
				p_status: params.status,
				p_tags: params.tags,
				p_frontmatter: params.frontmatter,
				p_body: params.body,
				p_reason: params.reason,
				p_base_revision: params.baseRevision,
				p_author_kind: params.authorKind,
				p_author_user_id: params.authorUserId,
				p_session_id: params.sessionId,
				p_binding_id: params.bindingId,
				p_source_path: params.sourcePath,
				p_source_hash: params.sourceHash,
			});
			if (error) throw storeError(error);
			const row = (
				data as Array<{ page_slug: string; page_revision: number }>
			)[0];
			return { slug: row.page_slug, revision: row.page_revision };
		},
	};
}
