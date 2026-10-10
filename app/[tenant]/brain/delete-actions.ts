"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteDeps } from "@/lib/brain/adapters/delete-page";
import { deletePage, previewDelete } from "@/lib/brain/core/editor/delete";
import { reflectMarcoForTenant } from "@/lib/outreach/marco-reflect";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
};

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

export async function getDeletePreview(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return previewDelete(parsed.data.tenantSlug, parsed.data.slug, deleteDeps());
}

export async function deleteBrainPage(raw: unknown) {
	const parsed = z
		.object({ ...base, expectedRevision: z.number().int().positive() })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, expectedRevision } = parsed.data;
	// Los tags hay que leerlos antes de borrar: después la página no existe.
	const preview = await previewDelete(tenantSlug, slug, deleteDeps());
	const wasMarco =
		preview.ok && preview.preview.canonTags.includes("canon:hooks");
	const result = await deletePage(
		tenantSlug,
		slug,
		expectedRevision,
		deleteDeps(),
	);
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	if (result.ok && wasMarco) {
		try {
			const tenant = await resolveTenantAccess(tenantSlug);
			if (tenant) await reflectMarcoForTenant(tenant.id);
		} catch (error) {
			console.error("brain: el reflejo del marco falló al borrar:", error);
		}
	}
	return result;
}
