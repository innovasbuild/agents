"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { folderDeps } from "@/lib/brain/adapters/folders";
import {
	createFolder,
	deleteFolder,
	describeFolder,
} from "@/lib/brain/core/editor/folders";

// La forma se valida en el borde; el permiso lo decide el núcleo.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	path: z.string().min(1).max(200),
};
const withDescription = { ...base, description: z.string().max(2000) };
const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

function done<T extends { ok: boolean }>(tenantSlug: string, result: T): T {
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}

export async function createBrainFolder(raw: unknown) {
	const parsed = z.object(withDescription).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path, description } = parsed.data;
	return done(
		tenantSlug,
		await createFolder(tenantSlug, path, description, folderDeps()),
	);
}

export async function describeBrainFolder(raw: unknown) {
	const parsed = z.object(withDescription).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path, description } = parsed.data;
	return done(
		tenantSlug,
		await describeFolder(tenantSlug, path, description, folderDeps()),
	);
}

export async function deleteBrainFolder(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, path } = parsed.data;
	return done(tenantSlug, await deleteFolder(tenantSlug, path, folderDeps()));
}
