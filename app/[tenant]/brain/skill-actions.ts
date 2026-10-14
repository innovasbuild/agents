"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { filesDeps, publishDeps } from "@/lib/brain/adapters/skills";
import { removeSkillFile } from "@/lib/brain/core/skills/files";
import {
	previewPublish,
	publishSkill,
	republishSkill,
	withdrawSkill,
} from "@/lib/brain/core/skills/publish";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
};
const note = z.string().max(500);

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

function refresh(tenantSlug: string) {
	revalidatePath(`/${tenantSlug}/brain`, "layout");
}

export async function getPublishPreview(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return previewPublish(
		parsed.data.tenantSlug,
		parsed.data.slug,
		publishDeps(),
	);
}

export async function publishSkillAction(raw: unknown) {
	const parsed = z
		.object({
			...base,
			expectedRevision: z.number().int().positive(),
			expectedFilesDigest: z.string().regex(/^[0-9a-f]{64}$/),
			note,
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await publishSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function republishSkillAction(raw: unknown) {
	const parsed = z
		.object({ ...base, fromVersion: z.number().int().positive(), note })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await republishSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function withdrawSkillAction(raw: unknown) {
	const parsed = z.object({ ...base, note }).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, ...input } = parsed.data;
	const result = await withdrawSkill(tenantSlug, slug, input, publishDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}

export async function removeSkillFileAction(raw: unknown) {
	const parsed = z
		.object({ ...base, path: z.string().min(1).max(200) })
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, slug, path } = parsed.data;
	const result = await removeSkillFile(tenantSlug, slug, path, filesDeps());
	if (result.ok) refresh(tenantSlug);
	return result;
}
