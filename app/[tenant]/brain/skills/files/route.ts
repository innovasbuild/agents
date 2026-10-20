import { revalidatePath } from "next/cache";
import { filesDeps } from "@/lib/brain/adapters/skills";
import {
	authorizeSkillEdit,
	type FilesDeps,
	putSkillFile,
	readSkillFile,
} from "@/lib/brain/core/skills/files";
import {
	checkRequestGuards,
	fileHeaders,
	isTenantSlug,
	statusFor,
} from "@/lib/brain/core/skills/http";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";
import type { SkillFailure } from "@/lib/brain/core/skills/publish";

// Subida y lectura de los archivos de una skill (spec etapa 24.1
// §6). No es una server action porque esas tienen tope de 2 MB. El permiso lo
// decide core/skills/files.ts.

function refuse(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

function failed(result: SkillFailure): Response {
	return Response.json(result, { status: statusFor(result.code) });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const query = new URL(request.url).searchParams;
	const slug = query.get("slug");
	const path = query.get("path");
	const rawVersion = query.get("version");
	const version = rawVersion === null ? undefined : Number(rawVersion);
	if (
		!isTenantSlug(tenant) ||
		!slug ||
		!path ||
		(version !== undefined && (!Number.isInteger(version) || version < 1))
	) {
		return new Response("No encontrado", { status: 404 });
	}

	const result = await readSkillFile(
		tenant,
		slug,
		{ path, ...(version === undefined ? {} : { version }) },
		filesDeps(),
	);
	// Sin distinguir motivos: lo que no se ve responde igual que lo que no existe.
	if (!result.ok) return new Response("No encontrado", { status: 404 });
	return new Response(new Uint8Array(result.bytes), {
		headers: fileHeaders(result.path, result.bytes),
	});
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const refused = checkRequestGuards(
		request,
		tenant,
		MAX_FILE_BYTES,
		"El archivo supera los 4 MB.",
	);
	if (refused) return refused;

	const deps = filesDeps();
	// Lo más barato primero: quien no es miembro no hace trabajar al servidor.
	if (!(await deps.actor(tenant))) return refuse(404, "No encontrado.");

	try {
		return await handleUpload(request, tenant, deps);
	} catch (error) {
		// El detalle queda en el log; la persona recibe un mensaje sin internos.
		console.error("skills: falló la subida de un archivo", error);
		return refuse(500, "No pude guardar el archivo. Probá de nuevo.");
	}
}

async function handleUpload(
	request: Request,
	tenant: string,
	deps: FilesDeps,
): Promise<Response> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return refuse(400, "Pedido inválido.");
	}
	const slug = form.get("slug");
	const file = form.get("file");
	const path = form.get("path");
	if (typeof slug !== "string" || !(file instanceof File)) {
		return refuse(400, "Pedido inválido.");
	}
	if (file.size > MAX_FILE_BYTES) {
		return refuse(413, "El archivo supera los 4 MB.");
	}
	// Antes de leer o descomprimir nada: ¿puede editar esta skill?
	const allowed = await authorizeSkillEdit(tenant, slug, deps);
	if (!allowed.ok) return failed(allowed);
	const bytes = new Uint8Array(await file.arrayBuffer());

	if (typeof path !== "string") return refuse(400, "Falta la ruta.");
	const result = await putSkillFile(tenant, slug, { path, bytes }, deps);
	if (!result.ok) return failed(result);
	revalidatePath(`/${tenant}/brain`, "layout");
	return Response.json(result);
}
