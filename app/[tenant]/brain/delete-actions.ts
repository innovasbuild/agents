"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteDeps } from "@/lib/brain/adapters/delete-page";
import { deletePage, previewDelete } from "@/lib/brain/core/editor/delete";

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
	const result = await deletePage(
		tenantSlug,
		slug,
		expectedRevision,
		deleteDeps(),
	);
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}
