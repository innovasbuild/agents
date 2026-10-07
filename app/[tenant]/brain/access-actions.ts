"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadShareState, manageDeps } from "@/lib/brain/adapters/access-admin";
import {
	type ChangeResult,
	changeAccess,
} from "@/lib/brain/core/access/manage";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el permiso lo decide changeAccess.
const base = {
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	path: z.string().max(200),
};
const userId = z.string().uuid();

const invalid = {
	ok: false,
	code: "invalid",
	message: "Datos inválidos.",
} as const;

async function run(
	tenantSlug: string,
	change: Parameters<typeof changeAccess>[1],
): Promise<ChangeResult> {
	const result = await changeAccess(tenantSlug, change, manageDeps());
	if (result.ok) revalidatePath(`/${tenantSlug}/brain`, "layout");
	return result;
}

export async function grantAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z
		.object({
			...base,
			userId,
			level: z.enum(["lector", "editor", "administrador"]),
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "grant", ...change });
}

export async function revokeAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z.object({ ...base, userId }).safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "revoke", ...change });
}

export async function setGeneralAccess(raw: unknown): Promise<ChangeResult> {
	const parsed = z
		.object({
			...base,
			level: z.enum(["lector", "editor", "ninguno", "inherit"]),
		})
		.safeParse(raw);
	if (!parsed.success) return invalid;
	const { tenantSlug, ...change } = parsed.data;
	return run(tenantSlug, { kind: "general", ...change });
}

export async function getShareState(raw: unknown) {
	const parsed = z.object(base).safeParse(raw);
	if (!parsed.success) return invalid;
	return loadShareState(parsed.data.tenantSlug, parsed.data.path);
}
