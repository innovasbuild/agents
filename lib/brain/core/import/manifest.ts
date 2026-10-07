// Qué entra al import y con qué tags de canon (spec brain §9.2).
import { matchesGlob } from "node:path";

export interface TagRule {
	match: string;
	tags: string[];
}

export interface ImportManifest {
	include: string[];
	exclude: string[];
	tags: TagRule[];
}

function isStringList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" && item.length > 0)
	);
}

export function parseManifest(value: unknown): ImportManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("el manifiesto tiene que ser un objeto JSON");
	}
	const raw = value as Record<string, unknown>;

	if (!isStringList(raw.include) || raw.include.length === 0) {
		throw new Error("include tiene que ser una lista no vacía de globs");
	}
	const exclude = raw.exclude ?? [];
	if (!isStringList(exclude))
		throw new Error("exclude tiene que ser una lista de globs");

	const tags = raw.tags ?? [];
	if (
		!Array.isArray(tags) ||
		!tags.every(
			(rule) =>
				typeof rule === "object" &&
				rule !== null &&
				typeof (rule as TagRule).match === "string" &&
				isStringList((rule as TagRule).tags),
		)
	) {
		throw new Error("tags tiene que ser una lista de { match, tags }");
	}

	return { include: raw.include, exclude, tags: tags as TagRule[] };
}

export function isIncluded(manifest: ImportManifest, path: string): boolean {
	return (
		manifest.include.some((glob) => matchesGlob(path, glob)) &&
		!manifest.exclude.some((glob) => matchesGlob(path, glob))
	);
}

export function tagsFor(manifest: ImportManifest, path: string): string[] {
	const tags = manifest.tags
		.filter((rule) => matchesGlob(path, rule.match))
		.flatMap((rule) => rule.tags);
	return [...new Set(tags)];
}
