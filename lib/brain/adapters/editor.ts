// Lecturas del editor (spec editor §4.3 y §6; etapa 17 §5.2). Todo se lee por
// el proveedor del brain, ahora envuelto con los permisos de la persona: el
// editor deja de tocar brain_pages y brain_revisions con el cliente de sesión.
// El tenant sale de resolveTenantAccess, que ya verificó la membresía.
import { cache } from "react";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import { resolveAccess } from "../core/access/resolve-access";
import { type TreeNode, visibleTree } from "../core/access/tree";
import { isAdminRole, type Level, type Principal } from "../core/access/types";
import { withAccess } from "../core/access/with-access";
import { resolveBrainBinding } from "../core/resolve";
import type { BrainPage, BrainProvider, BrainRevision } from "../core/types";
import { accessRulesStore } from "./access-rules";
import { getBrainProvider } from "./provider";

export type EditorContext =
	| {
			kind: "ok";
			tenant: TenantAccess;
			categories: string[];
			provider: BrainProvider;
			access: (path: string) => Level | null;
	  }
	| { kind: "no-brain"; tenant: TenantAccess }
	| { kind: "external"; tenant: TenantAccess };

export type OkEditorContext = Extract<EditorContext, { kind: "ok" }>;

export const loadEditorContext = cache(
	async (tenantSlug: string): Promise<EditorContext | null> => {
		const tenant = await resolveTenantAccess(tenantSlug);
		if (!tenant) return null;
		const binding = await resolveBrainBinding(tenant.id, loadTenantBindings);
		if (!binding) return { kind: "no-brain", tenant };
		if (binding.provider !== "wiki") return { kind: "external", tenant };

		const principal: Principal = {
			kind: "user",
			userId: tenant.userId,
			role: tenant.role,
		};
		// Solo un miembro común depende de las reglas; si no se pueden cargar la
		// excepción corta la página: se falla cerrado.
		const rules = isAdminRole(tenant.role)
			? []
			: await accessRulesStore().load(tenant.id);
		const access = (path: string) => resolveAccess(rules, principal, path);

		return {
			kind: "ok",
			tenant,
			categories: binding.config.categories,
			provider: withAccess(getBrainProvider(binding), principal, rules),
			access,
		};
	},
);

// cache() compara por identidad: loadEditorContext devuelve el mismo objeto
// durante todo el request, así que la lista se lee una sola vez.
export const loadBrainPages = cache(
	async (ctx: OkEditorContext): Promise<BrainPage[]> => ctx.provider.list(),
);

// El árbol sale de lo que el proveedor envuelto ya dejó ver, filtrado otra vez
// por ctx.access: lo oculto no llega ni a la pantalla.
export const loadBrainTree = cache(
	async (ctx: OkEditorContext): Promise<TreeNode> =>
		visibleTree(await loadBrainPages(ctx), ctx.access),
);

export interface RevisionRow extends Omit<BrainRevision, "authorUserId"> {
	authorEmail: string | null;
}

export async function loadRevisions(
	ctx: OkEditorContext,
	slug: string,
): Promise<RevisionRow[] | null> {
	const revisions = await ctx.provider.history(slug);
	if (!revisions) return null;

	const emails = await memberEmails(ctx.tenant.id, [
		...new Set(
			revisions
				.map((r) => r.authorUserId)
				.filter((id): id is string => id !== null),
		),
	]);

	return revisions.map(({ authorUserId, ...revision }) => ({
		...revision,
		authorEmail: authorUserId ? (emails.get(authorUserId) ?? null) : null,
	}));
}

// Tope de autores distintos por vista de historial: cada uno es una llamada a
// la API de administración de Auth. Los que pasen el tope salen sin email.
const MAX_AUTHOR_LOOKUPS = 50;

// Solo usuarios con membership en este tenant: un email de otra empresa no se
// muestra aunque haya quedado como autor.
async function memberEmails(
	tenantId: string,
	userIds: string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (userIds.length === 0) return result;
	const admin = createAdminClient();
	const { data: members, error } = await admin
		.from("memberships")
		.select("user_id")
		.eq("tenant_id", tenantId)
		.in("user_id", userIds);
	if (error) {
		console.error(
			`brain editor: no pude leer las membresías de los autores: ${error.message}`,
		);
		return result;
	}
	const authors = ((members ?? []) as Array<{ user_id: string }>).map(
		(member) => member.user_id,
	);
	if (authors.length > MAX_AUTHOR_LOOKUPS) {
		console.warn(
			`brain editor: ${authors.length} autores; solo se resuelven ${MAX_AUTHOR_LOOKUPS} emails`,
		);
	}
	await Promise.all(
		authors.slice(0, MAX_AUTHOR_LOOKUPS).map(async (userId) => {
			try {
				const { data, error: lookupError } =
					await admin.auth.admin.getUserById(userId);
				if (lookupError) {
					console.error(
						`brain editor: no pude leer un autor: ${lookupError.message}`,
					);
					return;
				}
				if (data.user?.email) result.set(userId, data.user.email);
			} catch (caught) {
				console.error("brain editor: falló la consulta de un autor", caught);
			}
		}),
	);
	return result;
}
