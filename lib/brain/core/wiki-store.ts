// Acceso a Supabase del proveedor wiki. Sin lógica: la valida wiki.ts y la
// prueban los tests pgTAP de las funciones. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainFolder } from "./folders.ts";
import { isRulesSlug, type RulePage } from "./rules.ts";
import type {
	BrainAuthor,
	BrainPage,
	BrainPageLinks,
	BrainPageMeta,
	BrainPageSummary,
	BrainRevision,
	BrainSearchInput,
	BrainStatus,
} from "./types.ts";
import { RULES_LEAF } from "./types.ts";

function toPage(row: Record<string, unknown>): BrainPage {
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
}

function toRevision(row: Record<string, unknown>): BrainRevision {
	return {
		revision: row.revision as number,
		title: row.title as string,
		category: row.category as string,
		status: row.status as BrainStatus,
		tags: (row.tags as string[] | null) ?? [],
		frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
		body: row.body as string,
		authorKind: row.author_kind as BrainRevision["authorKind"],
		authorUserId: (row.author_user_id as string | null) ?? null,
		reason: row.reason as string,
		createdAt: row.created_at as string,
	};
}

const PAGE_COLUMNS =
	"slug, title, category, status, tags, frontmatter, body, revision, updated_at";
// Sin body ni frontmatter: es lo que pesa.
const META_COLUMNS =
	"slug, title, category, status, tags, revision, updated_at";

function toMeta(row: Record<string, unknown>): BrainPageMeta {
	return {
		slug: row.slug as string,
		title: row.title as string,
		category: row.category as string,
		status: row.status as BrainStatus,
		tags: (row.tags as string[] | null) ?? [],
		revision: row.revision as number,
		updatedAt: row.updated_at as string,
	};
}

// Lo que devuelve brain_page_links por cada match: los grupos crudos de
// WIKILINK_PATTERN. El recorte de espacios y el "#" del ancla se resuelven acá
// igual que en parseWikilinks.
function toLinks(row: Record<string, unknown>): BrainPageLinks {
	const raw = (row.links ?? []) as Array<{
		target: string;
		anchor: string | null;
		alias: string | null;
	}>;
	return {
		slug: row.slug as string,
		links: raw.map((link) => ({
			target: link.target.trim(),
			anchor: link.anchor ? link.anchor.slice(1).trim() || null : null,
			alias: link.alias?.trim() || null,
		})),
	};
}

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
	list(tenantId: string): Promise<BrainPage[]>;
	listMeta(tenantId: string): Promise<BrainPageMeta[]>;
	listLinks(tenantId: string): Promise<BrainPageLinks[]>;
	listRevisions(
		tenantId: string,
		slug: string,
	): Promise<BrainRevision[] | null>;
	listFolders(tenantId: string): Promise<BrainFolder[]>;
	/** Las 00-reglas del tenant, de cualquier status (spec etapa 26 §4.2). */
	listRulePages(tenantId: string): Promise<RulePage[]>;
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
				.select(PAGE_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("slug", slug)
				.maybeSingle();
			if (error) throw storeError(error);
			return data ? toPage(data as Record<string, unknown>) : null;
		},

		async list(tenantId) {
			const { data, error } = await client
				.from("brain_pages")
				.select(PAGE_COLUMNS)
				.eq("tenant_id", tenantId)
				.order("slug");
			if (error) throw storeError(error);
			return ((data ?? []) as Array<Record<string, unknown>>).map(toPage);
		},

		async listMeta(tenantId) {
			// PostgREST corta cada respuesta en max_rows (1000 en config.toml): se
			// pagina y se avanza por las filas recibidas, no por 1000, así sigue
			// completo si el servidor corta más abajo. Corta en la respuesta vacía.
			const metas: BrainPageMeta[] = [];
			for (let from = 0; ; ) {
				const { data, error } = await client
					.from("brain_pages")
					.select(META_COLUMNS)
					.eq("tenant_id", tenantId)
					.order("slug")
					.range(from, from + 999);
				if (error) throw storeError(error);
				const rows = (data ?? []) as Array<Record<string, unknown>>;
				if (rows.length === 0) return metas;
				for (const row of rows) metas.push(toMeta(row));
				from += rows.length;
			}
		},

		async listLinks(tenantId) {
			// Una fila por página con links (no por link): PostgREST corta en 1000
			// filas y un brain tiene más links que páginas.
			const { data, error } = await client.rpc("brain_page_links", {
				p_tenant_id: tenantId,
			});
			if (error) throw storeError(error);
			return ((data ?? []) as Array<Record<string, unknown>>).map(toLinks);
		},

		async listRevisions(tenantId, slug) {
			const { data: page, error: pageError } = await client
				.from("brain_pages")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("slug", slug)
				.maybeSingle();
			if (pageError) throw storeError(pageError);
			if (!page) return null;

			const { data, error } = await client
				.from("brain_revisions")
				.select(
					"revision, title, category, status, tags, frontmatter, body, author_kind, author_user_id, reason, created_at",
				)
				.eq("tenant_id", tenantId)
				.eq("page_id", (page as { id: string }).id)
				.order("revision", { ascending: false });
			if (error) throw storeError(error);

			return ((data ?? []) as Array<Record<string, unknown>>).map(toRevision);
		},

		async listFolders(tenantId) {
			const { data, error } = await client
				.from("brain_folders")
				.select("path, description")
				.eq("tenant_id", tenantId)
				.order("path");
			if (error) throw storeError(error);
			return ((data ?? []) as Array<{ path: string; description: string }>).map(
				(row) => ({ path: row.path, description: row.description }),
			);
		},

		async listRulePages(tenantId) {
			// PostgREST corta en 1000 filas: se pagina aunque un brain tenga pocas.
			// El like trae también x/a00-reglas; el filtro de abajo deja solo las hojas.
			const pages: RulePage[] = [];
			for (let from = 0; ; from += 1000) {
				const { data, error } = await client
					.from("brain_pages")
					.select("slug, status, revision, body")
					.eq("tenant_id", tenantId)
					.like("slug", `%${RULES_LEAF}`)
					.order("slug")
					.range(from, from + 999);
				if (error) throw storeError(error);
				const rows = (data ?? []) as Array<Record<string, unknown>>;
				for (const row of rows) {
					if (!isRulesSlug(String(row.slug))) continue;
					pages.push({
						slug: String(row.slug),
						status: row.status as BrainStatus,
						revision: row.revision as number,
						body: String(row.body),
					});
				}
				if (rows.length < 1000) return pages;
			}
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
