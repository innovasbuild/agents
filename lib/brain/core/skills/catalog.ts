// Skills publicadas para un asistente (spec etapa 24.2a §3 y §4). Puro: se
// arma una vez por request. Solo conoce la copia publicada: nunca la página
// del brain ni los archivos del borrador. Una skill que la persona no ve
// responde igual que una que no existe.
import type { Level } from "../access/types.ts";
import { BrainError } from "../errors.ts";
import { looksLikeText } from "./http.ts";
import { skillName } from "./package.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow, SkillSnapshot } from "./store.ts";

export const MAX_LISTED_SKILLS = 30;
export const MAX_LISTED_DESCRIPTION = 300;
export const MAX_READABLE_BYTES = 262_144;

export interface SkillSummary {
	name: string;
	description: string;
	version: number;
	publishedAt: string;
}

export interface LoadedSkill extends SkillSummary {
	digest: string;
	instructions: string;
	compatibility?: string;
	files: { path: string; size: number; readable: boolean }[];
}

export interface SkillFileContent {
	name: string;
	version: number;
	path: string;
	size: number;
	content: string;
}

export interface SkillLoadRecord {
	slug: string;
	name: string;
	version: number;
	digest: string;
}

export interface SkillCatalogDeps {
	overview(): Promise<SkillOverviewRow[]>;
	levelOf(slug: string): Level | null;
	blob(sha256: string): Promise<Uint8Array | null>;
	record(entry: SkillLoadRecord): Promise<void>;
}

export interface SkillCatalog {
	list(): SkillSummary[];
	load(name: string): Promise<LoadedSkill>;
	file(name: string, path: string): Promise<SkillFileContent>;
}

const IN_PACKAGE =
	"Está en la descarga del paquete, desde la página de la skill en la plataforma.";

function notFound(name: string): BrainError {
	return new BrainError(
		"not_found",
		`No existe la skill "${name}" entre las que podés usar.`,
	);
}

function summarize(name: string, snapshot: SkillSnapshot): SkillSummary {
	return {
		name,
		description: snapshot.description,
		version: snapshot.version,
		publishedAt: snapshot.publishedAt,
	};
}

export function describeSkills(skills: SkillSummary[]): string {
	const lines = skills.slice(0, MAX_LISTED_SKILLS).map((skill) => {
		const flat = skill.description.replace(/\s+/g, " ").trim();
		const short =
			flat.length > MAX_LISTED_DESCRIPTION
				? `${flat.slice(0, MAX_LISTED_DESCRIPTION - 1)}…`
				: flat;
		return `- ${skill.name}: ${short}`;
	});
	const rest = skills.length - MAX_LISTED_SKILLS;
	if (rest > 0) lines.push(`Hay ${rest} más: se ven con skill_list.`);
	return lines.join("\n");
}

export async function loadSkillCatalog(
	deps: SkillCatalogDeps,
): Promise<SkillCatalog | null> {
	const visible = new Map<string, { slug: string; snapshot: SkillSnapshot }>();
	for (const row of await deps.overview()) {
		const snapshot = publishedSnapshot(row);
		if (!snapshot || deps.levelOf(row.slug) === null) continue;
		// El nombre es único por empresa entre las publicadas (brain_publish_skill).
		visible.set(skillName(row.slug), { slug: row.slug, snapshot });
	}
	if (visible.size === 0) return null;

	const find = (name: string) => {
		const found = visible.get(name);
		if (!found) throw notFound(name);
		return found;
	};

	return {
		list() {
			return [...visible.entries()]
				.map(([name, { snapshot }]) => summarize(name, snapshot))
				.sort((a, b) => (a.name < b.name ? -1 : 1));
		},

		async load(name) {
			const { slug, snapshot } = find(name);
			try {
				await deps.record({
					slug,
					name,
					version: snapshot.version,
					digest: snapshot.digest,
				});
			} catch (error) {
				// El registro no puede tirar una carga.
				console.error("skills: no pude registrar la carga", error);
			}
			const compatibility = snapshot.frontmatter.compatibility;
			return {
				...summarize(name, snapshot),
				digest: snapshot.digest,
				instructions: snapshot.body,
				...(typeof compatibility === "string" && compatibility.trim()
					? { compatibility: compatibility.trim() }
					: {}),
				files: snapshot.manifest.map((file) => ({
					path: file.path,
					size: file.size,
					readable: file.size <= MAX_READABLE_BYTES,
				})),
			};
		},

		async file(name, path) {
			const { snapshot } = find(name);
			const entry = snapshot.manifest.find((file) => file.path === path);
			if (!entry) {
				throw new BrainError(
					"not_found",
					`La skill "${name}" no tiene el archivo "${path}" en la versión ${snapshot.version}.`,
				);
			}
			if (entry.size > MAX_READABLE_BYTES) {
				throw new BrainError(
					"validation",
					`"${path}" pesa más de 256 KB y no se lee desde acá. ${IN_PACKAGE}`,
				);
			}
			const bytes = await deps.blob(entry.sha256);
			if (!bytes) throw new Error(`skills: falta el contenido de ${path}`);
			if (!looksLikeText(bytes)) {
				throw new BrainError(
					"validation",
					`"${path}" no es un archivo de texto y no se lee desde acá. ${IN_PACKAGE}`,
				);
			}
			return {
				name,
				version: snapshot.version,
				path,
				size: entry.size,
				content: new TextDecoder().decode(bytes),
			};
		},
	};
}
