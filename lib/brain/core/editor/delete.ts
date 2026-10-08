// Borrado de páginas (spec etapa 18.1 §5). Sin Next ni Supabase: recibe sus
// dependencias, como savePage y changeAccess. El permiso se decide acá, con las
// reglas del tenant; la escritura corre con service role.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	isAdminRole,
	type Principal,
} from "../access/types.ts";
import type { PageDeleter } from "../delete-store.ts";
import { planLinkCleanup } from "../links-cleanup";
import {
	type BrainPage,
	type BrainRole,
	CANON_TAGS,
	MAX_SLUG_LENGTH,
	SLUG_PATTERN,
} from "../types";
import { WikiStoreError } from "../wiki-store.ts";

export type DeleteFailure = {
	ok: false;
	code: "not_found" | "forbidden" | "conflict" | "unsupported";
	message: string;
};

export interface DeletePreview {
	slug: string;
	title: string;
	revision: number;
	// Solo las páginas que enlazan y que la persona ve.
	linkers: Array<{ slug: string; title: string }>;
	// Las demás: se cuentan, no se nombran (A8 de la Etapa 17).
	hiddenLinkers: number;
	hasChildren: boolean;
	canonTags: string[];
}

export interface DeleteDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore;
	binding(
		tenantId: string,
	): Promise<{ id: string; provider: "wiki" | "mcp" } | null>;
	// Todas las páginas del tenant, SIN envolver con permisos: la limpieza tiene
	// que ver también las que quien borra no ve.
	pages(tenantId: string): Promise<BrainPage[]>;
	deleter: PageDeleter;
}

const fail = (code: DeleteFailure["code"], message: string): DeleteFailure => ({
	ok: false,
	code,
	message,
});
const NOT_FOUND = "No encontrado.";

function isValidSlug(slug: string): boolean {
	return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

type Authorized = {
	ok: true;
	tenantId: string;
	actorUserId: string;
	principal: Principal;
	rules: Awaited<ReturnType<AccessRulesStore["load"]>>;
	bindingId: string;
	pages: BrainPage[];
	page: BrainPage;
};

// Quién es, qué ve y si administra la página. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	slug: string,
	deps: DeleteDeps,
): Promise<Authorized | DeleteFailure> {
	if (!isValidSlug(slug)) return fail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", NOT_FOUND);

	const binding = await deps.binding(actor.tenantId);
	if (!binding) return fail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return fail(
			"unsupported",
			"Este brain es externo: las páginas se borran en su origen.",
		);
	}

	// Solo un miembro común depende de las reglas. Si no se pueden cargar, esto
	// lanza: falla cerrada.
	const rules = isAdminRole(actor.role)
		? []
		: await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, slug);
	if (level === null) return fail("not_found", NOT_FOUND);
	if (level !== "administrador") {
		return fail("forbidden", "Solo un administrador puede borrar esta página.");
	}

	const pages = await deps.pages(actor.tenantId);
	const page = pages.find((p) => p.slug === slug);
	if (!page) return fail("not_found", NOT_FOUND);

	return {
		ok: true,
		tenantId: actor.tenantId,
		actorUserId: actor.userId,
		principal,
		rules,
		bindingId: binding.id,
		pages,
		page,
	};
}

export async function previewDelete(
	tenantSlug: string,
	slug: string,
	deps: DeleteDeps,
): Promise<{ ok: true; preview: DeletePreview } | DeleteFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;

	const plan = planLinkCleanup(auth.pages, slug);
	const visible = plan.filter(
		(item) => resolveAccess(auth.rules, auth.principal, item.slug) !== null,
	);
	return {
		ok: true,
		preview: {
			slug,
			title: auth.page.title,
			revision: auth.page.revision,
			linkers: visible.map(({ slug: s, title }) => ({ slug: s, title })),
			hiddenLinkers: plan.length - visible.length,
			hasChildren: auth.pages.some((p) => p.slug.startsWith(`${slug}/`)),
			canonTags: auth.page.tags.filter((tag) =>
				(CANON_TAGS as readonly string[]).includes(tag),
			),
		},
	};
}

export async function deletePage(
	tenantSlug: string,
	slug: string,
	expectedRevision: number,
	deps: DeleteDeps,
): Promise<{ ok: true; cleaned: number } | DeleteFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;

	// El plan se arma de nuevo acá (D9): lo que se escribe no depende de lo que
	// vio o mandó el navegador.
	const plan = planLinkCleanup(auth.pages, slug);
	try {
		const outcome = await deps.deleter.delete({
			tenantId: auth.tenantId,
			slug,
			expectedRevision,
			actorUserId: auth.actorUserId,
			bindingId: auth.bindingId,
			cleanups: plan.map(({ slug: s, baseRevision, body }) => ({
				slug: s,
				baseRevision,
				body,
			})),
		});
		return { ok: true, cleaned: outcome.cleaned };
	} catch (error) {
		if (error instanceof WikiStoreError) {
			if (error.code === "BR409" || error.code === "40P01") {
				return fail(
					"conflict",
					"La página o alguna de las que la enlazan cambió. Volvé a abrir el diálogo.",
				);
			}
			if (error.code === "BR404") return fail("not_found", NOT_FOUND);
		}
		throw error;
	}
}
