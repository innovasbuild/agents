// Subir una skill desde un zip (spec etapa 24.6 §3). Sin Next ni Supabase: el
// zip llega descomprimido y el tenant y la persona, del caller. La vista previa
// no escribe; la confirmación vuelve a planificar todo y recién ahí escribe,
// siempre en el borrador (D9).
import { atLeast, type Level } from "../access/types.ts";
import {
	BrainConflict,
	BrainForbidden,
	BrainNotFound,
	BrainValidation,
} from "../errors.ts";
import { MAX_SLUG_LENGTH } from "../types.ts";
import {
	type FilesDeps,
	importSkillPackage,
	type PackageEntry,
	type ParsedSkillMd,
	planImport,
	problemsMessage,
	skillAccess,
} from "./files.ts";
import {
	isSkillSlug,
	isValidSkillFolder,
	SKILL_CATEGORY,
	SKILLS_PREFIX,
	skillName,
} from "./package.ts";
import { type SkillActor, type SkillFailure, skillFail } from "./publish.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow } from "./store.ts";

export type UploadTarget =
	| { kind: "folder"; folder: string } // relativa a skills/, "" = directo bajo skills/
	| { kind: "skill"; slug: string };

export interface UploadPreview {
	ok: true;
	mode: "crear" | "reemplazar";
	slug: string;
	name: string;
	description: string;
	files: { path: string; size: number }[];
	totalBytes: number;
	warnings: string[];
}

export type UploadFailure = SkillFailure & { problems?: string[] };

export interface UploadResult {
	ok: true;
	mode: "crear" | "reemplazar";
	slug: string;
	name: string;
	files: number;
	revision: number;
}

// Vive en el núcleo porque lo usan la ruta web, el MCP y el adaptador del evento.
export interface SkillImportRecord {
	tenantId: string;
	userId: string;
	channel: "web" | "mcp";
	slug: string;
	mode: "crear" | "reemplazar";
	files: number;
}

const NOT_FOUND = "No encontrado.";
const CREATE_REASON = "Alta por subida de paquete";
const INVALID_FOLDER =
	"La carpeta usa minúsculas, dígitos y guiones, con subniveles separados por /.";
const SLUG_TOO_LONG = `La ruta de la skill supera los ${MAX_SLUG_LENGTH} caracteres.`;

type Planned = {
	ok: true;
	actor: SkillActor;
	mode: "crear" | "reemplazar";
	slug: string;
	name: string;
	skill: ParsedSkillMd;
	files: PackageEntry[];
	warnings: string[];
};

const notFound = () => skillFail("not_found", NOT_FOUND);

// Acceso, plan del paquete, destino, modo, permiso y avisos. No escribe nada.
// Quien no puede crear o reemplazar recibe not_found, igual que ante algo que
// no existe: el canal no revela nombres (spec §4).
async function planUpload(
	tenantSlug: string,
	target: UploadTarget,
	entries: PackageEntry[],
	deps: FilesDeps,
): Promise<Planned | UploadFailure> {
	const access = await skillAccess(tenantSlug, deps);
	if (!access.ok) return access;
	const { actor, levelOf } = access;
	const rows = await deps.store.overview(actor.tenantId);

	// Desde el panel de una skill el destino ya está dado: se resuelve antes de
	// mirar el paquete, así una skill ajena no se distingue por el zip.
	if (target.kind === "skill") {
		const visible =
			isSkillSlug(target.slug) &&
			rows.some((row) => row.slug === target.slug) &&
			atLeast(levelOf(target.slug), "editor");
		if (!visible) return notFound();
	} else if (!isValidSkillFolder(target.folder)) {
		return skillFail("validation", INVALID_FOLDER);
	}

	const plan = planImport(entries);
	if (!plan.ok) {
		return {
			...skillFail("validation", problemsMessage(plan.problems)),
			problems: plan.problems,
		};
	}

	const slug =
		target.kind === "skill"
			? target.slug
			: `${SKILLS_PREFIX}${target.folder ? `${target.folder}/` : ""}${plan.skill.name}`;
	if (slug.length > MAX_SLUG_LENGTH)
		return skillFail("validation", SLUG_TOO_LONG);
	const name = skillName(slug);

	const mode = rows.some((row) => row.slug === slug) ? "reemplazar" : "crear";
	// Crear pide administrar la carpeta destino; reemplazar, editar la skill.
	const [path, needed]: [string, Level] =
		mode === "crear"
			? [slug.slice(0, slug.lastIndexOf("/")), "administrador"]
			: [slug, "editor"];
	if (!atLeast(levelOf(path), needed)) return notFound();

	const warnings: string[] = [];
	if (plan.skill.name !== name) {
		warnings.push(
			`El name del SKILL.md es «${plan.skill.name}» y la skill se llama «${name}»: se sube igual, pero la skill no se renombra.`,
		);
	}
	// Solo lo que la persona ve: un borrador lo ve quien lo edita; quien lee,
	// solo lo publicado. Lo demás no se nombra.
	const sees = (row: SkillOverviewRow) => {
		const level = levelOf(row.slug);
		return (
			atLeast(level, "editor") ||
			(level !== null && publishedSnapshot(row) !== null)
		);
	};
	for (const row of rows) {
		if (
			row.slug !== slug &&
			isSkillSlug(row.slug) &&
			skillName(row.slug) === name &&
			sees(row)
		) {
			warnings.push(
				`Ya hay otra skill llamada «${name}» en ${row.slug}: mientras una de las dos esté publicada, la otra no se va a poder publicar.`,
			);
		}
	}

	return {
		ok: true,
		actor,
		mode,
		slug,
		name,
		skill: plan.skill,
		files: plan.files,
		warnings,
	};
}

export async function previewSkillUpload(
	tenantSlug: string,
	target: UploadTarget,
	entries: PackageEntry[],
	deps: FilesDeps,
): Promise<UploadPreview | UploadFailure> {
	const planned = await planUpload(tenantSlug, target, entries, deps);
	if (!planned.ok) return planned;
	const files = planned.files.map((file) => ({
		path: file.path,
		size: file.bytes.length,
	}));
	return {
		ok: true,
		mode: planned.mode,
		slug: planned.slug,
		name: planned.name,
		description: planned.skill.description,
		files,
		totalBytes: files.reduce((total, file) => total + file.size, 0),
		warnings: planned.warnings,
	};
}

function createFailure(error: unknown, slug: string): SkillFailure {
	if (error instanceof BrainConflict) {
		return skillFail(
			"conflict",
			`Ya hay una página en ${slug}: alguien la creó mientras subías. Volvé a abrir la vista previa.`,
		);
	}
	if (error instanceof BrainForbidden || error instanceof BrainNotFound)
		return notFound();
	if (error instanceof BrainValidation)
		return skillFail("validation", error.message);
	throw error;
}

export async function commitSkillUpload(
	tenantSlug: string,
	target: UploadTarget,
	entries: PackageEntry[],
	deps: FilesDeps,
): Promise<UploadResult | UploadFailure> {
	const planned = await planUpload(tenantSlug, target, entries, deps);
	if (!planned.ok) return planned;
	const { actor, mode, slug, name, skill } = planned;

	if (mode === "crear") {
		try {
			await deps.save(actor, {
				slug,
				title: name,
				category: SKILL_CATEGORY,
				status: "activo",
				tags: [],
				frontmatter: { description: skill.description },
				body: skill.body,
				reason: CREATE_REASON,
			});
		} catch (error) {
			return createFailure(error, slug);
		}
	}

	// El texto completo y los archivos los escribe la importación de siempre.
	const imported = await importSkillPackage(tenantSlug, slug, entries, deps);
	if (!imported.ok)
		return imported.code === "forbidden" ? notFound() : imported;
	return {
		ok: true,
		mode,
		slug,
		name,
		files: imported.files,
		revision: imported.revision,
	};
}
