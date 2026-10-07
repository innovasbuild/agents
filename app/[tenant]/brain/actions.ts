"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveActingProvider } from "@/lib/brain/adapters/acting-provider";
import {
	type SavePageInput,
	type SavePageResult,
	savePage,
} from "@/lib/brain/core/editor/save";
import { resolveBrainBinding } from "@/lib/brain/core/resolve";
import { BRAIN_STATUSES } from "@/lib/brain/core/types";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Una server action la invoca cualquier cliente autenticado con lo que quiera:
// se valida la forma en el borde; el contenido lo valida validateWrite.
const inputSchema = z.object({
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	slug: z.string().min(1).max(200),
	title: z.string().max(300),
	category: z.string().max(41),
	status: z.enum(BRAIN_STATUSES as [string, ...string[]]),
	tags: z.array(z.string().max(60)).max(50),
	frontmatter: z.record(z.string(), z.unknown()),
	body: z.string(),
	reason: z.string().max(500),
	baseRevision: z.number().int().positive().nullable(),
});

export async function saveBrainPage(
	raw: SavePageInput,
): Promise<SavePageResult> {
	const parsed = inputSchema.safeParse(raw);
	if (!parsed.success)
		return {
			ok: false,
			code: "validation",
			fields: parsed.error.issues.map((i) => i.path.join(".")),
			message: "Datos inválidos.",
		};
	const input = parsed.data as SavePageInput;

	const result = await savePage(input, {
		async access(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			if (!tenant) return null;
			return { tenantId: tenant.id, role: tenant.role, userId: tenant.userId };
		},
		binding: (tenantId) => resolveBrainBinding(tenantId, loadTenantBindings),
		// El permiso lo decide el proveedor: un miembro con rol de editor sobre
		// esa carpeta escribe; uno sin él recibe forbidden.
		provider: (binding, actor) =>
			resolveActingProvider(binding, {
				userId: actor.userId,
				role: actor.role,
			}),
	});

	if (result.ok) {
		revalidatePath(`/${input.tenantSlug}/brain`, "layout");
	}
	return result;
}
