import { zipPackage } from "@/lib/brain/adapters/skill-zip";
import { filesDeps } from "@/lib/brain/adapters/skills";
import { exportSkillPackage } from "@/lib/brain/core/skills/files";

// Descarga del paquete publicado de una skill (spec etapa 24.2a §5). Siempre
// la versión vigente. El permiso lo decide core/skills/files.ts; lo que no se
// ve responde igual que lo que no existe.

const TENANT = /^[a-z0-9-]{1,63}$/;
const CHUNK = 65_536;

function notFound(): Response {
	return new Response("No encontrado", { status: 404 });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const slug = new URL(request.url).searchParams.get("slug");
	if (!TENANT.test(tenant) || !slug) return notFound();

	let zip: Uint8Array;
	let filename: string;
	try {
		const result = await exportSkillPackage(tenant, slug, filesDeps());
		if (!result.ok) return notFound();
		zip = zipPackage(result.entries);
		// El nombre sale del slug ya validado: minúsculas, números y guiones.
		filename = `${result.name}-v${result.version}.zip`;
	} catch (error) {
		console.error("skills: falló la descarga del paquete", error);
		return new Response("No pude armar el paquete. Probá de nuevo.", {
			status: 500,
		});
	}

	// Por partes: una respuesta en streaming no queda sujeta al tope de cuerpo
	// de las funciones de Vercel (a verificar en preview, ver plan §cierre).
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let at = 0; at < zip.length; at += CHUNK) {
				controller.enqueue(zip.subarray(at, at + CHUNK));
			}
			controller.close();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "application/zip",
			"content-disposition": `attachment; filename="${filename}"`,
			"x-content-type-options": "nosniff",
			"cache-control": "no-store",
		},
	});
}
