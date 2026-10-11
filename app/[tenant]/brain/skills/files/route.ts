import { revalidatePath } from "next/cache";
import { unzipPackage, ZipRejected } from "@/lib/brain/adapters/skill-zip";
import { filesDeps } from "@/lib/brain/adapters/skills";
import {
	importSkillPackage,
	putSkillFile,
	readSkillFile,
} from "@/lib/brain/core/skills/files";
import { fileHeaders, isSameOrigin } from "@/lib/brain/core/skills/http";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";
import type { SkillFailure } from "@/lib/brain/core/skills/publish";

// Subida, importación y lectura de los archivos de una skill (spec etapa 24.1
// §6). No es una server action porque esas tienen tope de 2 MB. El permiso lo
// decide core/skills/files.ts.

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
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 65_536;

function refuse(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

function failed(result: SkillFailure): Response {
	return Response.json(result, { status: STATUS[result.code] });
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
		!TENANT.test(tenant) ||
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
	if (!TENANT.test(tenant)) return refuse(404, "No encontrado.");
	// Un route handler no trae el chequeo de origen de las server actions.
	if (
		!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))
	) {
		return refuse(403, "Origen no permitido.");
	}
	if (
		Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES
	) {
		return refuse(413, "El archivo supera los 4 MB.");
	}

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
	const bytes = new Uint8Array(await file.arrayBuffer());

	if (form.get("kind") === "zip") {
		let entries: ReturnType<typeof unzipPackage>;
		try {
			entries = unzipPackage(bytes);
		} catch (error) {
			if (error instanceof ZipRejected) return refuse(422, error.message);
			throw error;
		}
		const result = await importSkillPackage(tenant, slug, entries, filesDeps());
		if (!result.ok) return failed(result);
		revalidatePath(`/${tenant}/brain`, "layout");
		return Response.json(result);
	}

	if (typeof path !== "string") return refuse(400, "Falta la ruta.");
	const result = await putSkillFile(tenant, slug, { path, bytes }, filesDeps());
	if (!result.ok) return failed(result);
	revalidatePath(`/${tenant}/brain`, "layout");
	return Response.json(result);
}
