import { revalidatePath } from "next/cache";
import { recordSkillImport } from "@/lib/brain/adapters/skill-uploads";
import { unzipOrProblem } from "@/lib/brain/adapters/skill-zip";
import { filesDeps } from "@/lib/brain/adapters/skills";
import { resolveBrainBinding } from "@/lib/brain/core/resolve";
import type { FilesDeps } from "@/lib/brain/core/skills/files";
import { isSameOrigin } from "@/lib/brain/core/skills/http";
import {
	MAX_ZIP_BYTES,
	normalizeSkillFolder,
	SKILL_CATEGORY,
} from "@/lib/brain/core/skills/package";
import type { SkillFailure } from "@/lib/brain/core/skills/publish";
import {
	commitSkillUpload,
	previewSkillUpload,
	type UploadTarget,
} from "@/lib/brain/core/skills/upload";
import { loadTenantBindings } from "@/lib/connectors/bindings";

// Subir una skill desde un zip (spec etapa 24.6 §3): "preview" arma la vista
// previa y no escribe; "confirm" vuelve a planificar y escribe en el borrador.
// No es una server action porque esas tienen tope de 2 MB. El permiso lo
// decide core/skills/upload.ts.

const TENANT = /^[a-z0-9-]{1,63}$/;
const STATUS: Record<SkillFailure["code"], number> = {
	not_found: 404,
	forbidden: 403,
	conflict: 409,
	validation: 422,
	unsupported: 422,
	name_taken: 409,
};
// El formulario multipart agrega unos bytes alrededor del archivo.
const MAX_REQUEST_BYTES = MAX_ZIP_BYTES + 65_536;
const NOT_FOUND = "No encontrado.";

function refuse(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

function failed(result: SkillFailure & { problems?: string[] }): Response {
	return Response.json(result, { status: STATUS[result.code] });
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	if (!TENANT.test(tenant)) return refuse(404, NOT_FOUND);
	// Un route handler no trae el chequeo de origen de las server actions.
	if (
		!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))
	) {
		return refuse(403, "Origen no permitido.");
	}
	// Sin Content-Length no hay cómo acotar lo que se va a leer.
	const length = request.headers.get("content-length");
	if (length === null || !/^\d+$/.test(length)) {
		return refuse(411, "Falta el tamaño del pedido.");
	}
	if (Number(length) > MAX_REQUEST_BYTES) {
		return refuse(413, "El zip supera los 4 MB.");
	}

	try {
		const deps = filesDeps();
		// Lo más barato primero: quien no es miembro no hace trabajar al servidor.
		const actor = await deps.actor(tenant);
		if (!actor) return refuse(404, NOT_FOUND);
		// Sin la categoría no puede existir una skill: responde como una ruta que
		// no existe. El servicio no lo mira (es de este adaptador). Un brain
		// externo lo contesta el servicio.
		const binding = await resolveBrainBinding(
			actor.tenantId,
			loadTenantBindings,
		);
		if (
			!binding ||
			(binding.provider === "wiki" &&
				!binding.config.categories.includes(SKILL_CATEGORY))
		) {
			return refuse(404, NOT_FOUND);
		}
		return await handleUpload(request, tenant, actor, deps);
	} catch (error) {
		// El detalle queda en el log; la persona recibe un mensaje sin internos.
		console.error("skills: falló la subida de un zip", error);
		return refuse(500, "No pude procesar el zip. Probá de nuevo.");
	}
}

async function handleUpload(
	request: Request,
	tenant: string,
	actor: { tenantId: string; userId: string },
	deps: FilesDeps,
): Promise<Response> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return refuse(400, "Pedido inválido.");
	}
	const action = form.get("action");
	const file = form.get("file");
	const folder = form.get("folder");
	const slug = form.get("slug");
	// Exactamente un destino: la carpeta (puede ser "") o la skill.
	if (
		(action !== "preview" && action !== "confirm") ||
		!(file instanceof File) ||
		(folder === null) === (slug === null) ||
		(folder !== null && typeof folder !== "string") ||
		(slug !== null && typeof slug !== "string")
	) {
		return refuse(400, "Pedido inválido.");
	}
	if (file.size > MAX_ZIP_BYTES) return refuse(413, "El zip supera los 4 MB.");

	const target: UploadTarget =
		typeof slug === "string"
			? { kind: "skill", slug }
			: { kind: "folder", folder: normalizeSkillFolder(folder as string) };

	const entries = unzipOrProblem(new Uint8Array(await file.arrayBuffer()));
	if ("error" in entries) {
		return Response.json(
			{ ok: false, code: "validation", message: entries.error },
			{ status: 422 },
		);
	}

	if (action === "preview") {
		const preview = await previewSkillUpload(tenant, target, entries, deps);
		return preview.ok ? Response.json(preview) : failed(preview);
	}

	const result = await commitSkillUpload(tenant, target, entries, deps);
	if (!result.ok) return failed(result);
	revalidatePath(`/${tenant}/brain`, "layout");
	try {
		await recordSkillImport({
			tenantId: actor.tenantId,
			userId: actor.userId,
			channel: "web",
			slug: result.slug,
			mode: result.mode,
			files: result.files,
		});
	} catch (error) {
		// Ya se escribió: el registro no cambia lo que la persona ve.
		console.error("skills: no pude registrar la subida", error);
	}
	return Response.json(result);
}
