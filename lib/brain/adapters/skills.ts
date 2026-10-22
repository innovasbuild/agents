// Cablea las skills con la plataforma (spec etapa 24.1 §9): sesión, binding,
// reglas, cliente admin y Storage. Los permisos los deciden core/skills/
// publish.ts y files.ts.

import { loadTenantBindings } from "@/lib/connectors/bindings";
import { canPublishSkill, limitMessage } from "@/lib/plans/limits";
import { createPlanStore } from "@/lib/plans/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { resolveAccess } from "../core/access/resolve-access";
import { isAdminRole, type Principal } from "../core/access/types";
import { BrainNotFound } from "../core/errors";
import { resolveBrainBinding } from "../core/resolve";
import { visibleSkills } from "../core/skills/catalog";
import type { BlobStore, FilesDeps } from "../core/skills/files";
import type { PublishDeps } from "../core/skills/publish";
import {
	createSupabaseSkillStore,
	type SkillStore,
} from "../core/skills/store";
import type { BrainRole } from "../core/types";
import { accessRulesStore } from "./access-rules";
import { resolveActingProvider } from "./acting-provider";
import { getBrainProvider } from "./provider";

import { blobStore, skillStore } from "./skill-storage.ts";

export { blobStore, skillStore };

async function wikiBinding(tenantId: string) {
	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	return binding && binding.provider === "wiki" ? binding : null;
}

function shared() {
	return {
		async actor(tenantSlug: string) {
			const tenant = await resolveTenantAccess(tenantSlug);
			return tenant
				? { tenantId: tenant.id, userId: tenant.userId, role: tenant.role }
				: null;
		},
		async binding(tenantId: string) {
			const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
			return binding ? { provider: binding.provider } : null;
		},
		// El borrador real: proveedor sin envolver con permisos ni con la vista
		// de skills. El permiso ya lo decidió quien llama.
		async page(tenantId: string, slug: string) {
			const binding = await wikiBinding(tenantId);
			if (!binding) return null;
			try {
				return await getBrainProvider(binding).read(slug, {
					suggestions: false,
				});
			} catch (error) {
				if (error instanceof BrainNotFound) return null;
				throw error;
			}
		},
		store: skillStore(),
	};
}

export function publishDeps(): PublishDeps {
	return {
		...shared(),
		async skillLimit(tenantId, publishedSkills) {
			const plan = await createPlanStore(createAdminClient()).tenantPlan(
				tenantId,
			);
			if (!plan) return null;
			const reason = canPublishSkill(plan, {
				users: 0,
				pendingInvitations: 0,
				publishedSkills,
			});
			return reason ? { reason, message: limitMessage(reason).title } : null;
		},
		async revisions(tenantId, slug) {
			const binding = await wikiBinding(tenantId);
			if (!binding) return [];
			return (await getBrainProvider(binding).history(slug)) ?? [];
		},
	};
}

export function filesDeps(): FilesDeps {
	return {
		...shared(),
		rules: accessRulesStore(),
		blobs: blobStore(),
		// Por el mismo camino que el guardado del editor: withAccess decide.
		async save(actor, write) {
			const binding = await wikiBinding(actor.tenantId);
			if (!binding) throw new BrainNotFound(write.slug, []);
			const provider = await resolveActingProvider(binding, {
				userId: actor.userId,
				role: actor.role,
			});
			return provider.upsert(write, { kind: "user", userId: actor.userId });
		},
	};
}

export interface MemberSkill {
	slug: string;
	name: string;
	description: string;
	version: number;
}

// Las skills que una persona ve en /conectar (spec etapa 24.2b §8): las
// mismas que skill_list le daría por MCP. Con un brain externo no hay skills.
export async function memberSkills(member: {
	tenantId: string;
	userId: string;
	role: BrainRole;
}): Promise<MemberSkill[]> {
	if (!(await wikiBinding(member.tenantId))) return [];
	// Como en el handler MCP: un administrador no depende de reglas, y si no se
	// pueden cargar, esto lanza (falla cerrada).
	const rules = isAdminRole(member.role)
		? []
		: await accessRulesStore().load(member.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: member.userId,
		role: member.role,
	};
	const rows = await skillStore().overview(member.tenantId);
	return visibleSkills(rows, (slug) =>
		resolveAccess(rules, principal, slug),
	).map(({ slug, name, snapshot }) => ({
		slug,
		name,
		description: snapshot.description,
		version: snapshot.version,
	}));
}
