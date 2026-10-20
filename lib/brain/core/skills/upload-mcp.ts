// Subir una skill desde un zip por MCP (spec etapa 24.6 §3 "MCP", D8). Un
// asistente no puede pasar un binario en los argumentos: skill_upload_link da
// un link firmado para dejar el zip en un objeto de preparación y skill_import
// lo lee y usa el mismo servicio que la web (upload.ts). Puro: el staging, el
// descompresor y el registro llegan inyectados. El objeto se busca con el
// tenant y la persona del pedido, así el uploadId de otro no existe.
import {
	type AccessRule,
	atLeast,
	type Level,
	type Principal,
} from "../access/types.ts";
import { BrainError } from "../errors.ts";
import { creatableSkillFolders, DRAFT_NOTE, failure } from "./draft.ts";
import type { FilesDeps, PackageEntry } from "./files.ts";
import {
	isValidSkillFolder,
	MAX_ZIP_BYTES,
	normalizeSkillFolder,
	SKILLS_PREFIX,
} from "./package.ts";
import {
	commitSkillUpload,
	previewSkillUpload,
	type SkillImportRecord,
	type UploadTarget,
} from "./upload.ts";
import { makeUploadId, parseUploadId } from "./upload-id.ts";

export interface UploadStaging {
	issue(i: {
		tenantId: string;
		userId: string;
		uploadId: string;
	}): Promise<{ url: string; expiresIn: number }>;
	read(i: {
		tenantId: string;
		userId: string;
		uploadId: string;
	}): Promise<Uint8Array | null>;
	remove(i: {
		tenantId: string;
		userId: string;
		uploadId: string;
	}): Promise<void>;
}

export interface SkillUploadsDeps {
	tenantSlug: string;
	/** Las dependencias de files.ts ya armadas con la persona del pedido. */
	files: FilesDeps;
	levelOf(path: string): Level | null;
	/** Carpetas (relativas a skills/) que la persona administra; "" es directo bajo skills/. */
	uploadableFolders: string[];
	staging: UploadStaging;
	unzip(bytes: Uint8Array): PackageEntry[] | { error: string };
	reviewUrl(slug: string): string;
	record(entry: SkillImportRecord): Promise<void>;
}

export interface SkillUploads {
	/** Dónde puede subir skills nuevas esta persona, para decírselo al asistente. */
	uploadableFolders: string[];
	link(i: { folder: string }): Promise<Record<string, unknown>>;
	// Como propiedad y no como método: el guardia de frontera lee la forma
	// `import(` como un import dinámico.
	import: (i: {
		uploadId: string;
		confirm?: boolean;
		expectedMode?: "crear" | "reemplazar";
		expectedSlug?: string;
	}) => Promise<Record<string, unknown>>;
}

const INVALID_FOLDER =
	"La carpeta usa minúsculas, dígitos y guiones, con subniveles separados por /.";
const NO_UPLOAD =
	"No encontré ese zip. Subilo con el link de skill_upload_link o pedí uno nuevo.";
const EXPIRED = "El link venció, pedí otro con skill_upload_link.";
const ZIP_TOO_BIG = "El zip supera los 4 MB.";
const CONFIRM_HINT =
	"Esto es solo la vista previa: no se guardó nada. Mostrásela a la persona y, si está de acuerdo, llamá de nuevo a skill_import con el mismo uploadId, confirm: true, expectedMode con el mode y expectedSlug con el slug de esta vista previa: si algo cambió mientras tanto, no se guarda y hay que volver a mirar la vista previa. La skill queda en el borrador.";
const HALF_EXPECTED = "expectedMode y expectedSlug van juntos, o ninguno.";

const invalid = (message: string) => new BrainError("validation", message);
const notFound = (message: string) => new BrainError("not_found", message);

// Subir un zip crea una skill: pide administrar la carpeta (spec 24.6 D4).
export function uploadableSkillFolders(
	rules: AccessRule[],
	principal: Principal,
): string[] {
	return creatableSkillFolders(rules, principal, "administrador");
}

export function createSkillUploads(deps: SkillUploadsDeps): SkillUploads {
	const { files, tenantSlug, staging } = deps;

	// El tenant y la persona salen del pedido, nunca de los argumentos.
	async function owner() {
		const actor = await files.actor(tenantSlug);
		return actor ? { tenantId: actor.tenantId, userId: actor.userId } : null;
	}

	return {
		uploadableFolders: deps.uploadableFolders,

		async link({ folder: raw }) {
			const folder = normalizeSkillFolder(raw);
			if (!isValidSkillFolder(folder)) throw invalid(INVALID_FOLDER);
			const path = folder ? `${SKILLS_PREFIX}${folder}` : "skills";
			const who = await owner();
			// Quien no la administra recibe lo mismo que ante una carpeta que no existe.
			if (!who || !atLeast(deps.levelOf(path), "administrador")) {
				throw notFound(
					`No existe la carpeta "${path}" entre las que podés administrar.`,
				);
			}
			const uploadId = makeUploadId(folder, Date.now(), crypto.randomUUID());
			const { url, expiresIn } = await staging.issue({ ...who, uploadId });
			return {
				ok: true,
				uploadId,
				url,
				method: "PUT",
				contentType: "application/zip",
				maxBytes: MAX_ZIP_BYTES,
				expiresIn,
				message: `Subí el zip con un PUT a url, con Content-Type: application/zip y hasta 4 MB, antes de que venza (${expiresIn} segundos). Después llamá a skill_import con este uploadId para ver la vista previa.`,
			};
		},

		import: async ({ uploadId, confirm, expectedMode, expectedSlug }) => {
			if ((expectedMode === undefined) !== (expectedSlug === undefined))
				throw invalid(HALF_EXPECTED);
			const parsed = parseUploadId(uploadId, Date.now());
			if (parsed === null) throw notFound(NO_UPLOAD);
			if (parsed === "expired") throw invalid(EXPIRED);
			const who = await owner();
			if (!who) throw notFound(NO_UPLOAD);
			const key = { ...who, uploadId };
			const zip = await staging.read(key);
			if (!zip) throw notFound(NO_UPLOAD);
			// El tamaño real, antes de descomprimir: no se confía en lo declarado.
			if (zip.length > MAX_ZIP_BYTES) throw invalid(ZIP_TOO_BIG);
			const entries = deps.unzip(zip);
			if ("error" in entries) throw invalid(entries.error);
			const target: UploadTarget = { kind: "folder", folder: parsed.folder };

			if (!confirm) {
				const preview = await previewSkillUpload(
					tenantSlug,
					target,
					entries,
					files,
				);
				if (!preview.ok) failure(preview);
				return { ...preview, uploadId, confirmHint: CONFIRM_HINT };
			}

			// La confirmación vuelve a planificar todo, permiso incluido.
			const result = await commitSkillUpload(
				tenantSlug,
				target,
				entries,
				files,
				expectedMode && expectedSlug !== undefined
					? { mode: expectedMode, slug: expectedSlug }
					: undefined,
			);
			if (!result.ok) failure(result);
			// Ya se escribió: ni el borrado ni el registro cambian el resultado. Un
			// objeto que queda lo limpia la expiración del staging.
			try {
				await staging.remove(key);
			} catch (error) {
				console.error("skills: no pude borrar el zip subido por MCP", error);
			}
			try {
				await deps.record({
					...who,
					channel: "mcp",
					slug: result.slug,
					mode: result.mode,
					files: result.files,
				});
			} catch (error) {
				console.error("skills: no pude registrar la subida por MCP", error);
			}
			return {
				...result,
				reviewUrl: deps.reviewUrl(result.slug),
				message: DRAFT_NOTE,
			};
		},
	};
}
