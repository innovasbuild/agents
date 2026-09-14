// Transformaciones puras de un archivo de la bóveda a una página (spec brain
// §9.3). Imports con extensión .ts: lo usa un script con Node directo.
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { BRAIN_STATUSES, type BrainStatus } from "../types.ts";

export interface VaultFile {
	path: string;
	raw: string;
}

export interface PageDraft {
	slug: string;
	sourcePath: string;
	sourceHash: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING = /^#\s+(.+)$/m;
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const COLUMN_KEYS = new Set(["title", "category", "status", "tags"]);

export function slugFromPath(relativePath: string): string {
	const withoutExtension = relativePath
		.replaceAll("\\", "/")
		.replace(/\.md$/i, "");
	const segments = withoutExtension.split("/").map((segment) =>
		segment
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, ""),
	);
	if (segments.some((segment) => segment.length === 0)) {
		throw new Error(`no se puede derivar un slug de "${relativePath}"`);
	}
	return segments.join("/");
}

export function parseDocument(raw: string): {
	data: Record<string, unknown>;
	body: string;
} {
	const match = raw.match(FRONTMATTER);
	if (!match) return { data: {}, body: raw };

	const parsed: unknown = parse(match[1]) ?? {};
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("el frontmatter no es un objeto YAML");
	}
	return {
		data: parsed as Record<string, unknown>,
		body: raw.slice(match[0].length),
	};
}

function normalizeTags(value: unknown): string[] {
	if (Array.isArray(value))
		return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") return value.split(",");
	return [];
}

export function buildDraft(file: VaultFile, extraTags: string[]): PageDraft {
	const slug = slugFromPath(file.path);
	const { data, body } = parseDocument(file.raw);
	const topFolder = slug.split("/")[0];

	const heading = body.match(HEADING)?.[1]?.trim();
	const fileName = file.path.split("/").pop()?.replace(/\.md$/i, "") ?? slug;
	const title =
		typeof data.title === "string" && data.title.trim()
			? data.title.trim()
			: (heading ?? fileName);

	const category =
		typeof data.category === "string" ? data.category : topFolder;
	if (category !== topFolder) {
		throw new Error(
			`la categoría "${category}" no coincide con la carpeta "${topFolder}"`,
		);
	}

	const status = data.status === undefined ? "activo" : data.status;
	if (
		typeof status !== "string" ||
		!BRAIN_STATUSES.includes(status as BrainStatus)
	) {
		throw new Error(`estado desconocido: "${String(status)}"`);
	}

	const tags = [
		...new Set(
			[...normalizeTags(data.tags), ...extraTags].map((tag) => tag.trim()),
		),
	].filter((tag) => tag.length > 0);

	const frontmatter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (!COLUMN_KEYS.has(key)) frontmatter[key] = value;
	}

	return {
		slug,
		sourcePath: file.path,
		sourceHash: createHash("sha256").update(file.raw).digest("hex"),
		title,
		category,
		status: status as BrainStatus,
		tags,
		frontmatter,
		body,
	};
}

export function buildSlugIndex(
	slugs: string[],
): (target: string) => string | null {
	const all = new Set(slugs);
	const byLastSegment = new Map<string, string[]>();
	for (const slug of slugs) {
		const last = slug.split("/").pop() ?? slug;
		byLastSegment.set(last, [...(byLastSegment.get(last) ?? []), slug]);
	}

	return (target) => {
		let normalized: string;
		try {
			normalized = slugFromPath(target.trim());
		} catch {
			return null;
		}
		if (all.has(normalized)) return normalized;
		const matches =
			byLastSegment.get(normalized.split("/").pop() ?? normalized) ?? [];
		return matches.length === 1 ? matches[0] : null;
	};
}

export function rewriteWikilinks(
	body: string,
	resolve: (target: string) => string | null,
): { body: string; unresolved: string[] } {
	const unresolved: string[] = [];
	const rewritten = body.replace(
		WIKILINK,
		(
			whole: string,
			target: string,
			anchor: string | undefined,
			alias: string | undefined,
		) => {
			const slug = resolve(target);
			if (!slug) {
				unresolved.push(target.trim());
				return whole;
			}
			return `[[${slug}${anchor ?? ""}|${(alias ?? target).trim()}]]`;
		},
	);
	return { body: rewritten, unresolved };
}
