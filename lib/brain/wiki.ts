// Proveedor wiki (spec brain §4.3): valida contra la configuración del binding,
// arma el autor y traduce los errores de la base. Todo filtrado por el tenant
// del binding, que viene de la sesión.
import type { WikiConfig } from "./config.ts";
import { BrainConflict, BrainNotFound, BrainValidation } from "./errors.ts";
import {
	BRAIN_STATUSES,
	type BrainPageSummary,
	type BrainProvider,
	type BrainWrite,
	MAX_BODY_BYTES,
	MAX_SLUG_LENGTH,
	SLUG_PATTERN,
} from "./types.ts";
import { type WikiStore, WikiStoreError } from "./wiki-store.ts";

export interface WikiProviderOptions {
	tenantId: string;
	bindingId: string;
	config: WikiConfig;
	store: WikiStore;
	today?: () => string;
}

const COLUMN_KEYS = new Set(["title", "category", "status", "tags"]);
const MAX_SEARCH_LIMIT = 20;

function isValidSlug(slug: string): boolean {
	return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

function isoToday(): string {
	return new Date().toISOString().slice(0, 10);
}

export function validateWrite(
	write: BrainWrite,
	config: WikiConfig,
	today: string,
): Record<string, unknown> {
	const fields: string[] = [];

	if (!isValidSlug(write.slug)) fields.push("slug");
	if (write.title.trim().length === 0 || write.title.length > 300)
		fields.push("title");
	if (!config.categories.includes(write.category)) fields.push("category");
	if (!BRAIN_STATUSES.includes(write.status)) fields.push("status");
	if (!write.tags.every((tag) => tag.trim().length > 0 && tag.length <= 60))
		fields.push("tags");
	if (new TextEncoder().encode(write.body).length > MAX_BODY_BYTES)
		fields.push("body");
	if (write.reason.trim().length === 0) fields.push("reason");
	if (
		write.baseRevision !== undefined &&
		(!Number.isInteger(write.baseRevision) || write.baseRevision < 1)
	) {
		fields.push("baseRevision");
	}

	const frontmatter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(write.frontmatter ?? {})) {
		if (!COLUMN_KEYS.has(key)) frontmatter[key] = value;
	}
	if (frontmatter.updated === undefined) frontmatter.updated = today;

	for (const key of config.requiredFrontmatter) {
		if (COLUMN_KEYS.has(key)) continue;
		const value = frontmatter[key];
		if (value === undefined || value === null || value === "")
			fields.push(`frontmatter.${key}`);
	}

	if (fields.length > 0) throw new BrainValidation(fields);
	return frontmatter;
}

function translateStoreError(error: unknown, slug: string): unknown {
	if (!(error instanceof WikiStoreError)) return error;
	switch (error.code) {
		case "BR409": {
			const current = Number.parseInt(error.details, 10);
			return new BrainConflict(slug, Number.isNaN(current) ? null : current);
		}
		case "23505":
			return new BrainConflict(slug, null);
		case "BR404":
			return new BrainNotFound(slug, []);
		case "BR422":
			return new BrainValidation([error.details || "desconocido"]);
		default:
			return error;
	}
}

export function createWikiProvider(
	options: WikiProviderOptions,
): BrainProvider {
	const { tenantId, bindingId, config, store } = options;
	const today = options.today ?? isoToday;

	async function suggestions(slug: string): Promise<string[]> {
		const lastSegment = slug.split("/").pop() ?? slug;
		try {
			const results: BrainPageSummary[] = await store.search(tenantId, {
				query: lastSegment.replaceAll("-", " "),
				includeArchived: true,
				limit: 3,
			});
			return results.map((result) => result.slug);
		} catch {
			return [];
		}
	}

	return {
		async search(input) {
			const limit =
				input.limit === undefined
					? undefined
					: Math.min(Math.max(input.limit, 1), MAX_SEARCH_LIMIT);
			return store.search(tenantId, {
				...input,
				...(limit === undefined ? {} : { limit }),
			});
		},

		async read(slug) {
			if (!isValidSlug(slug)) throw new BrainValidation(["slug"]);
			const page = await store.read(tenantId, slug);
			if (!page) throw new BrainNotFound(slug, await suggestions(slug));
			return page;
		},

		async upsert(write, author) {
			const frontmatter = validateWrite(write, config, today());
			try {
				return await store.upsert({
					tenantId,
					slug: write.slug,
					title: write.title,
					category: write.category,
					status: write.status,
					tags: write.tags,
					frontmatter,
					body: write.body,
					reason: write.reason,
					baseRevision: write.baseRevision ?? null,
					authorKind: author.kind,
					authorUserId: author.userId,
					sessionId: author.kind === "agent" ? author.sessionId : null,
					bindingId,
					sourcePath: author.kind === "import" ? author.sourcePath : null,
					sourceHash: author.kind === "import" ? author.sourceHash : null,
				});
			} catch (error) {
				throw translateStoreError(error, write.slug);
			}
		},
	};
}
