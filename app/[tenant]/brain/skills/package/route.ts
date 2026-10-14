import { packageLinkDeps } from "@/lib/brain/adapters/skill-packages";
import { filesDeps } from "@/lib/brain/adapters/skills";
import { publishedSkillFor } from "@/lib/brain/core/skills/files";
import { issuePackageLink } from "@/lib/brain/core/skills/package-link";

// Descarga del paquete publicado de una skill (spec etapa 24.2b §6). Siempre
// la versión vigente. El permiso lo decide core/skills/files.ts; lo que no se
// ve responde igual que lo que no existe. El zip no pasa por la función:
// redirige a un link firmado de 60 segundos, así no hay tope de respuesta.

const TENANT = /^[a-z0-9-]{1,63}$/;

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

	try {
		const skill = await publishedSkillFor(tenant, slug, filesDeps());
		if (!skill.ok) return notFound();
		const link = await issuePackageLink(
			{
				tenantId: skill.tenantId,
				userId: skill.userId,
				channel: "web",
				slug: skill.slug,
				snapshot: skill.snapshot,
			},
			packageLinkDeps(),
		);
		return new Response(null, {
			status: 302,
			headers: { location: link.url, "cache-control": "no-store" },
		});
	} catch (error) {
		console.error("skills: falló la descarga del paquete", error);
		return new Response("No pude armar el paquete. Probá de nuevo.", {
			status: 500,
		});
	}
}
