import { notFound, permanentRedirect } from "next/navigation";
import { pageHref, slugFromParams } from "@/lib/brain/core/editor/slug";

// La página ya abre en modo edición para quien puede editar (spec 18.2 V1): los
// links viejos a /editar siguen andando.
export default async function EditRedirect({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant, slug: segments } = await params;
	const slug = slugFromParams(segments);
	if (!slug) notFound();
	permanentRedirect(pageHref(tenant, slug));
}
