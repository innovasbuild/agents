// Subidas de skills desde un zip (spec etapa 24.6): el evento de la importación
// y el objeto de preparación de la subida por MCP.
// El canal MCP de eve carga este archivo: nada de next/* ni de @/lib/tenants.
import { createAdminClient } from "../../supabase/admin.ts";
import type { SkillImportRecord } from "../core/skills/upload.ts";
import { UPLOAD_LINK_SECONDS } from "../core/skills/upload-id.ts";
import type { UploadStaging } from "../core/skills/upload-mcp.ts";

export function skillImportEvent(
	entry: SkillImportRecord,
): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: entry.channel,
		type: "brain.skill_imported",
		summary: entry.slug,
		payload: { mode: entry.mode, files: entry.files },
	};
}

export async function recordSkillImport(
	entry: SkillImportRecord,
): Promise<void> {
	// events es append-only: solo insert. Se tira solo el mensaje de la base.
	const { error } = await createAdminClient()
		.from("events")
		.insert(skillImportEvent(entry));
	if (error) throw new Error(error.message);
}

const BUCKET = "skill-packages";
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9._~-]{1,300}$/;

// La clave lleva el uploadId ENTERO: la carpeta y la hora que viajan dentro no
// van firmadas, así que indexar solo por la parte aleatoria dejaría redirigir
// el zip a otra carpeta o esquivar el vencimiento. La ruta sale solo de los
// argumentos, y un id con "/" o ".." se rechaza antes de tocar Storage.
function stagingPrefix(tenantId: string, userId: string): string {
	return `imports/${tenantId}/${userId}/`;
}

function stagingPath(i: {
	tenantId: string;
	userId: string;
	uploadId: string;
}): string {
	if (!UPLOAD_ID_PATTERN.test(i.uploadId) || i.uploadId.includes("..")) {
		throw new Error("skills: el id de la subida no es válido.");
	}
	return `${stagingPrefix(i.tenantId, i.userId)}${i.uploadId}.zip`;
}

// Limpieza best-effort de lo que esa persona dejó sin importar. Nunca frena la
// emisión del link: se loguea solo el mensaje.
async function sweepOldUploads(
	bucket: ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>,
	tenantId: string,
	userId: string,
): Promise<void> {
	try {
		const prefix = stagingPrefix(tenantId, userId);
		const { data, error } = await bucket.list(prefix.slice(0, -1), {
			limit: 1000,
		});
		if (error) throw new Error(error.message);
		const limit = Date.now() - SWEEP_AFTER_MS;
		const stale = (data ?? [])
			.filter((object) => {
				const stamp = object.created_at ?? object.updated_at;
				const at = stamp ? Date.parse(stamp) : Number.NaN;
				return Number.isFinite(at) && at < limit;
			})
			.map((object) => `${prefix}${object.name}`);
		if (stale.length === 0) return;
		const removed = await bucket.remove(stale);
		if (removed.error) throw new Error(removed.error.message);
	} catch (e) {
		console.error(
			"skills: no pude limpiar las subidas viejas:",
			e instanceof Error ? e.message : "error desconocido",
		);
	}
}

export function uploadStaging(): UploadStaging {
	const bucket = () => createAdminClient().storage.from(BUCKET);
	return {
		async issue(i) {
			const path = stagingPath(i);
			await sweepOldUploads(bucket(), i.tenantId, i.userId);
			// El vencimiento real lo impone parseUploadId con la hora del id: la
			// URL firmada de Supabase dura más y no se puede acortar.
			const { data, error } = await bucket().createSignedUploadUrl(path, {
				upsert: true,
			});
			if (error || !data) {
				throw new Error(
					`skills: no pude firmar la subida: ${error?.message ?? "sin datos"}`,
				);
			}
			return { url: data.signedUrl, expiresIn: UPLOAD_LINK_SECONDS };
		},
		async read(i) {
			const path = stagingPath(i);
			const { data, error } = await bucket().download(path);
			if (error || !data) {
				// Un objeto que no está es el caso normal (id ajeno, ya importado,
				// nunca subido): null. Cualquier otra falla se propaga.
				const { data: exists } = await bucket().exists(path);
				if (exists === false) return null;
				throw new Error(
					`skills: no pude leer la subida: ${error?.message ?? "sin datos"}`,
				);
			}
			return new Uint8Array(await data.arrayBuffer());
		},
		async remove(i) {
			const { error } = await bucket().remove([stagingPath(i)]);
			if (error) {
				throw new Error(`skills: no pude borrar la subida: ${error.message}`);
			}
		},
	};
}
