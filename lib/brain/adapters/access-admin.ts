// Cablea la gestión de permisos con la plataforma: sesión, cliente admin y el
// directorio de personas. El permiso lo decide manage.ts.
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPeople } from "@/lib/tenants/people";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import type { NodeAccessView } from "../core/access/explain";
import { loadShareView, type ManageDeps } from "../core/access/manage";
import type { BrainRole } from "../core/types";
import { accessRulesStore, accessRulesWriter } from "./access-rules";

export interface ShareState {
	view: NodeAccessView;
	people: Record<string, { name: string; email: string | null }>;
	// Administradores del tenant (fijos en el diálogo) y miembros comunes que
	// se pueden agregar. Son user_id; los datos están en `people`.
	admins: string[];
	candidates: string[];
}

export function manageDeps(): ManageDeps {
	const rules = accessRulesStore();
	const writer = accessRulesWriter();
	return {
		async actor(tenantSlug) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		rules: { load: rules.load, set: writer.set, remove: writer.remove },
		async memberRole(tenantId, userId) {
			const { data, error } = await createAdminClient()
				.from("memberships")
				.select("role")
				.eq("tenant_id", tenantId)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw new Error(`No pude leer la membresía: ${error.message}`);
			return (data?.role as BrainRole | undefined) ?? null;
		},
		async pagePaths(tenantId) {
			const { data, error } = await createAdminClient()
				.from("brain_pages")
				.select("slug")
				.eq("tenant_id", tenantId);
			if (error) throw new Error(`No pude leer las páginas: ${error.message}`);
			return (data ?? []).map((row) => row.slug as string);
		},
	};
}

// Tope de miembros que se resuelven por nodo: cada uno es una llamada a la API
// de administración de Auth (como en el historial del editor).
const MAX_PEOPLE = 100;

export async function loadShareState(
	tenantSlug: string,
	path: string,
): Promise<
	({ ok: true } & ShareState) | { ok: false; code: string; message: string }
> {
	const deps = manageDeps();
	const result = await loadShareView(tenantSlug, path, deps);
	if (!result.ok) return result;

	const { data, error } = await createAdminClient()
		.from("memberships")
		.select("user_id, role")
		.eq("tenant_id", result.tenantId);
	if (error) throw new Error(`No pude leer las membresías: ${error.message}`);
	const memberships = (data ?? []) as Array<{ user_id: string; role: string }>;
	if (memberships.length > MAX_PEOPLE) {
		console.warn(
			`brain share: ${memberships.length} miembros; solo se resuelven ${MAX_PEOPLE}`,
		);
	}
	const shown = memberships.slice(0, MAX_PEOPLE);

	const directory = await loadPeople(shown.map((m) => m.user_id));
	const people: ShareState["people"] = {};
	for (const [id, person] of directory) {
		people[id] = { name: person.name, email: person.email ?? null };
	}

	return {
		ok: true,
		view: result.view,
		people,
		admins: shown
			.filter((m) => m.role === "tenant_admin")
			.map((m) => m.user_id),
		candidates: shown
			.filter((m) => m.role === "tenant_member")
			.map((m) => m.user_id),
	};
}
