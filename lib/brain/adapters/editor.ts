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
import {
	atLeast,
	isAdminRole,
	type Level,
	type Principal,
} from "../core/access/types";
import { withAccess } from "../core/access/with-access";
import {
	editorRules,
	loadFolderRulesPanel,
	loadRulesPanel,
	type RulesPanelView,
} from "../core/editor/rules-panel";
import type { BrainFolder } from "../core/folders";
import { buildLinkIndexFromLinks, type LinkIndex } from "../core/links";
import { resolveBrainBinding } from "../core/resolve";
import type { RulesSource } from "../core/rules-source";
import { SKILL_CATEGORY } from "../core/skills/package";
import { skillState } from "../core/skills/state";
import type { SkillOverviewRow } from "../core/skills/store";
import { withSkillView } from "../core/skills/view";
import type {
	BrainPageMeta,
	BrainProvider,
	BrainRevision,
} from "../core/types";
import { createSupabaseWikiStore } from "../core/wiki-store";
import { accessRulesStore } from "./access-rules";
import { getBrainProvider } from "./provider";
import { getBrainRules } from "./rules";
import { skillStore } from "./skills";

export type EditorContext =
	| {
			kind: "ok";
			tenant: TenantAccess;
			categories: string[];
			provider: BrainProvider;
			access: (path: string) => Level | null;
			// Resumen de las skills del tenant; vacío si el brain no las habilita.
			skills: () => Promise<SkillOverviewRow[]>;
			// Carpetas guardadas del tenant (pueden estar vacías); visibleTree las filtra.
			folders: () => Promise<BrainFolder[]>;
			// Reglas que gobiernan cada ruta (spec etapa 26 §4.3), ya filtradas por
			// lo que ve la persona y sin skills/: la misma garantía que el MCP.
			rules: RulesSource;
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

		// Sin la categoría no puede existir una página de skill: no se consulta.
		const skillsEnabled = binding.config.categories.includes(SKILL_CATEGORY);
		let overview: Promise<SkillOverviewRow[]> | null = null;
		const skills = () => {
			overview ??= skillsEnabled
				? skillStore().overview(tenant.id)
				: Promise.resolve([]);
			return overview;
		};
		// Las carpetas se leen sin envolver: visibleTree las filtra con ctx.access.
		let folderList: Promise<BrainFolder[]> | null = null;
		const folders = () => {
			folderList ??= createSupabaseWikiStore(createAdminClient()).listFolders(
				tenant.id,
			);
			return folderList;
		};
		const guarded = withAccess(getBrainProvider(binding), principal, rules);

		return {
			kind: "ok",
			tenant,
			categories: binding.config.categories,
			// Quien solo lee una skill ve su versión publicada (spec 24.1 §7).
			provider: skillsEnabled
				? withSkillView(guarded, { levelOf: access, overview: skills })
				: guarded,
			access,
			skills,
			folders,
			rules: editorRules(getBrainRules(binding), access),
		};
	},
);

// cache() compara por identidad: loadEditorContext devuelve el mismo objeto
// durante todo el request, así que la lista se lee una sola vez.
// Sin el cuerpo de las páginas: el árbol, el índice y el mapa no lo usan y es lo
// que pesa. El cuerpo de una página se lee con ctx.provider.read.
export const loadBrainMeta = cache(
	async (ctx: OkEditorContext): Promise<BrainPageMeta[]> =>
		ctx.provider.listMeta(),
);

// Conexiones entre las páginas visibles. Los links salen de la base ya
// extraídos; con el mismo filtro de permisos que las páginas.
export const loadBrainLinkIndex = cache(
	async (ctx: OkEditorContext): Promise<LinkIndex> => {
		const [pages, links] = await Promise.all([
			loadBrainMeta(ctx),
			ctx.provider.listLinks(),
		]);
		return buildLinkIndexFromLinks(pages, links);
	},
);

// El árbol sale de lo que el proveedor envuelto ya dejó ver, filtrado otra vez
// por ctx.access: lo oculto no llega ni a la pantalla.
export const loadBrainTree = cache(
	async (ctx: OkEditorContext): Promise<TreeNode> => {
		const pages = await loadBrainMeta(ctx);
		// La marca es decoración: si la consulta falla, el árbol sigue sin ella.
		// Las lecturas de skills (withSkillView) no se tocan: esas fallan cerradas.
		let rows: SkillOverviewRow[] = [];
		try {
			rows = await ctx.skills();
		} catch (error) {
			console.error(
				`brain editor: no pude leer las skills de ${ctx.tenant.slug}`,
				error,
			);
		}
		const pending = new Set(
			rows
				.filter((row) => {
					const state = skillState(row);
					return (
						state.kind === "sin_publicar" ||
						(state.kind === "publicada" && state.dirty)
					);
				})
				.map((row) => row.slug),
		);
		return visibleTree(
			pages.map((page) => ({
				slug: page.slug,
				title: page.title,
				status: page.status,
				...(pending.has(page.slug) && atLeast(ctx.access(page.slug), "editor")
					? { pending: true }
					: {}),
			})),
			ctx.access,
			await ctx.folders(),
		);
	},
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

function logRulesError(ctx: OkEditorContext) {
	return (error: unknown) =>
		console.error(
			`brain editor: no pude leer las reglas de ${ctx.tenant.slug}`,
			error,
		);
}

// Panel "Reglas que aplican" de una página (spec etapa 26 §4.3).
export function loadPageRulesPanel(
	ctx: OkEditorContext,
	slug: string,
): Promise<RulesPanelView | null> {
	return loadRulesPanel(ctx.rules, slug, ctx.access, logRulesError(ctx));
}

// El de una página nueva en una carpeta: la página todavía no existe.
export function loadNewPageRulesPanel(
	ctx: OkEditorContext,
	folder: string,
): Promise<RulesPanelView | null> {
	return loadFolderRulesPanel(
		ctx.rules,
		folder,
		ctx.access,
		logRulesError(ctx),
	);
}
