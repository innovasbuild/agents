// Decide qué hace el import con cada archivo (spec brain §9.3 a §9.5). Puro:
// no lee disco ni base.
import type { WikiConfig } from "../config.ts";
import { BrainValidation } from "../errors.ts";
import { validateWrite } from "../wiki.ts";
import {
	buildDraft,
	buildSlugIndex,
	type PageDraft,
	rewriteWikilinks,
	type VaultFile,
} from "./document.ts";
import { type ImportManifest, isIncluded, tagsFor } from "./manifest.ts";

export type ImportAction =
	| "crear"
	| "actualizar"
	| "sin cambios"
	| "salteada"
	| "error";

export interface ExistingPage {
	slug: string;
	revision: number;
	sourceHash: string | null;
	sourceRevision: number | null;
}

export interface ImportEntry {
	action: ImportAction;
	sourcePath: string;
	slug: string | null;
	tags: string[];
	detail: string | null;
	draft: PageDraft | null;
	baseRevision: number | null;
}

export interface ImportPlan {
	entries: ImportEntry[];
	excluded: string[];
	unresolvedLinks: Array<{ sourcePath: string; target: string }>;
	blocking: boolean;
}

export interface BuildImportPlanInput {
	files: VaultFile[];
	manifest: ImportManifest;
	config: WikiConfig;
	existing: ExistingPage[];
	force: string[];
	today: string;
}

function errorEntry(
	sourcePath: string,
	slug: string | null,
	detail: string,
): ImportEntry {
	return {
		action: "error",
		sourcePath,
		slug,
		tags: [],
		detail,
		draft: null,
		baseRevision: null,
	};
}

function decide(
	page: PageDraft,
	existing: ExistingPage | undefined,
	force: string[],
): ImportEntry {
	const base = {
		sourcePath: page.sourcePath,
		slug: page.slug,
		tags: page.tags,
	};
	if (!existing)
		return {
			...base,
			action: "crear",
			detail: null,
			draft: page,
			baseRevision: null,
		};
	if (existing.sourceHash === page.sourceHash) {
		return {
			...base,
			action: "sin cambios",
			detail: null,
			draft: null,
			baseRevision: null,
		};
	}
	if (existing.sourceRevision === existing.revision) {
		return {
			...base,
			action: "actualizar",
			detail: null,
			draft: page,
			baseRevision: existing.revision,
		};
	}
	if (force.includes(page.slug)) {
		return {
			...base,
			action: "actualizar",
			detail: "--force: pisa ediciones hechas en la plataforma",
			draft: page,
			baseRevision: existing.revision,
		};
	}
	return {
		...base,
		action: "salteada",
		detail: "editada en la plataforma desde el último import",
		draft: null,
		baseRevision: null,
	};
}

export function buildImportPlan(input: BuildImportPlanInput): ImportPlan {
	const excluded: string[] = [];
	const entries: ImportEntry[] = [];
	const drafts: PageDraft[] = [];

	for (const file of [...input.files].sort((a, b) =>
		a.path.localeCompare(b.path),
	)) {
		if (
			!file.path.toLowerCase().endsWith(".md") ||
			!isIncluded(input.manifest, file.path)
		) {
			excluded.push(file.path);
			continue;
		}
		try {
			drafts.push(buildDraft(file, tagsFor(input.manifest, file.path)));
		} catch (error) {
			entries.push(
				errorEntry(
					file.path,
					null,
					error instanceof Error ? error.message : String(error),
				),
			);
		}
	}

	const bySlug = new Map<string, PageDraft[]>();
	for (const draft of drafts)
		bySlug.set(draft.slug, [...(bySlug.get(draft.slug) ?? []), draft]);

	const unique: PageDraft[] = [];
	for (const [slug, group] of bySlug) {
		if (group.length === 1) {
			unique.push(group[0]);
			continue;
		}
		for (const draft of group) {
			const others = group
				.filter((other) => other !== draft)
				.map((other) => other.sourcePath);
			entries.push(
				errorEntry(
					draft.sourcePath,
					slug,
					`el slug ${slug} también lo genera: ${others.join(", ")}`,
				),
			);
		}
	}

	const resolve = buildSlugIndex(unique.map((draft) => draft.slug));
	const existingBySlug = new Map(
		input.existing.map((page) => [page.slug, page]),
	);
	const unresolvedLinks: ImportPlan["unresolvedLinks"] = [];

	for (const draft of unique) {
		const rewritten = rewriteWikilinks(draft.body, resolve);
		for (const target of rewritten.unresolved)
			unresolvedLinks.push({ sourcePath: draft.sourcePath, target });
		const page: PageDraft = { ...draft, body: rewritten.body };

		try {
			validateWrite(
				{
					slug: page.slug,
					title: page.title,
					category: page.category,
					status: page.status,
					tags: page.tags,
					frontmatter: page.frontmatter,
					body: page.body,
					reason: `import desde ${page.sourcePath}`,
				},
				input.config,
				input.today,
			);
		} catch (error) {
			if (!(error instanceof BrainValidation)) throw error;
			entries.push(
				errorEntry(
					page.sourcePath,
					page.slug,
					`campos inválidos: ${error.fields.join(", ")}`,
				),
			);
			continue;
		}

		entries.push(decide(page, existingBySlug.get(page.slug), input.force));
	}

	entries.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
	return {
		entries,
		excluded,
		unresolvedLinks,
		blocking: entries.some((entry) => entry.action === "error"),
	};
}

export function formatImportReport(plan: ImportPlan): string {
	const lines: string[] = [];

	for (const entry of plan.entries) {
		const tags = entry.tags.length > 0 ? `  [${entry.tags.join(", ")}]` : "";
		const detail = entry.detail ? `  (${entry.detail})` : "";
		lines.push(
			`${entry.action.padEnd(12)} ${entry.slug ?? "-"}  <- ${entry.sourcePath}${tags}${detail}`,
		);
	}

	const counts = new Map<ImportAction, number>();
	for (const entry of plan.entries)
		counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
	lines.push("");
	lines.push(
		`resumen: ${[...counts].map(([action, count]) => `${count} ${action}`).join(", ") || "sin páginas"}`,
	);
	lines.push(`excluidos: ${plan.excluded.length}`);

	if (plan.unresolvedLinks.length > 0) {
		lines.push("");
		lines.push("wikilinks sin resolver:");
		for (const link of plan.unresolvedLinks)
			lines.push(`  ${link.sourcePath}: [[${link.target}]]`);
	}

	if (plan.blocking) {
		lines.push("");
		lines.push(
			"Hay errores bloqueantes: --apply no va a escribir nada hasta corregirlos.",
		);
	}

	return lines.join("\n");
}
