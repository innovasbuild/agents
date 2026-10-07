// Cambios de permisos del brain (spec etapa 17 §7.4). Sin Next ni Supabase:
// recibe sus dependencias, como savePage. Las server actions solo arman las
// dependencias reales y validan la forma en el borde.
import { type BrainRole, MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";
import { explainAccess, type NodeAccessView } from "./explain.ts";
import { resolveAccess } from "./resolve-access.ts";
import {
	type AccessRule,
	type AccessRulesStore,
	type AccessRulesWriter,
	isAdminRole,
	type Level,
	type Principal,
	ROOT_PATH,
} from "./types.ts";

export type AccessChange =
	| { kind: "grant"; path: string; userId: string; level: Level }
	| { kind: "revoke"; path: string; userId: string }
	| {
			kind: "general";
			path: string;
			level: "lector" | "editor" | "ninguno" | "inherit";
	  };

export type FailureCode = "not_found" | "forbidden" | "invalid" | "lockout";
export type ChangeResult =
	| { ok: true }
	| { ok: false; code: FailureCode; message: string };

export interface ManageDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore & AccessRulesWriter;
	// Rol de esa persona en el tenant; null si no es miembro.
	memberRole(tenantId: string, userId: string): Promise<BrainRole | null>;
	// Slugs de todas las páginas del tenant: sirven para saber si una carpeta existe.
	pagePaths(tenantId: string): Promise<string[]>;
}

const fail = (code: FailureCode, message: string) =>
	({ ok: false, code, message }) as const;

function isValidPath(path: string): boolean {
	return (
		path === ROOT_PATH ||
		(path.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(path))
	);
}

// Aplica el cambio en memoria. Sirve para comprobar el resultado antes de escribir.
export function applyChange(
	rules: AccessRule[],
	change: AccessChange,
): AccessRule[] {
	if (change.kind === "general") {
		const rest = rules.filter(
			(r) => !(r.principal === "members" && r.path === change.path),
		);
		return change.level === "inherit"
			? rest
			: [
					...rest,
					{
						path: change.path,
						principal: "members",
						userId: null,
						level: change.level,
					},
				];
	}
	const rest = rules.filter(
		(r) =>
			!(
				r.principal === "user" &&
				r.userId === change.userId &&
				r.path === change.path
			),
	);
	return change.kind === "revoke"
		? rest
		: [
				...rest,
				{
					path: change.path,
					principal: "user",
					userId: change.userId,
					level: change.level,
				},
			];
}

type Authorized = {
	ok: true;
	tenantId: string;
	actor: { userId: string; role: BrainRole };
	principal: Principal;
	rules: AccessRule[];
};

// Quién es, qué ve y si administra el nodo. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	path: string,
	deps: ManageDeps,
): Promise<Authorized | Extract<ChangeResult, { ok: false }>> {
	if (!isValidPath(path)) return fail("invalid", "La ruta no es válida.");
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", "No encontrado.");

	// Si no se pueden cargar las reglas, esto lanza: falla cerrada.
	const rules = await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, path);
	if (level === null) return fail("not_found", "No encontrado.");
	if (level !== "administrador") {
		return fail(
			"forbidden",
			"Solo un administrador puede cambiar los accesos.",
		);
	}

	if (path !== ROOT_PATH) {
		const slugs = await deps.pagePaths(actor.tenantId);
		const exists =
			slugs.some((s) => s === path || s.startsWith(`${path}/`)) ||
			rules.some((r) => r.path === path || r.path.startsWith(`${path}/`));
		if (!exists) return fail("not_found", "No encontrado.");
	}

	return {
		ok: true,
		tenantId: actor.tenantId,
		actor: { userId: actor.userId, role: actor.role },
		principal,
		rules,
	};
}

export async function changeAccess(
	tenantSlug: string,
	change: AccessChange,
	deps: ManageDeps,
): Promise<ChangeResult> {
	if (
		change.kind === "general" &&
		change.path === ROOT_PATH &&
		change.level === "inherit"
	) {
		return fail("invalid", "La raíz no hereda de nadie.");
	}

	const auth = await authorize(tenantSlug, change.path, deps);
	if (!auth.ok) return auth;

	// Solo un grant puede escalar privilegios; un revoke se permite para
	// cualquier userId, así se limpian las reglas de un ex-miembro.
	if (change.kind === "grant") {
		const role = await deps.memberRole(auth.tenantId, change.userId);
		if (role === null) {
			return fail("invalid", "Esa persona no es miembro de esta empresa.");
		}
		if (isAdminRole(role)) {
			return fail("invalid", "Esa persona ya administra todo el brain.");
		}
	}

	// Un miembro que administra un nodo no se deja afuera por error: tras el
	// cambio tiene que seguir administrándolo. Los administradores del tenant
	// siempre pueden.
	if (!isAdminRole(auth.actor.role)) {
		const after = applyChange(auth.rules, change);
		if (resolveAccess(after, auth.principal, change.path) !== "administrador") {
			return fail(
				"lockout",
				"Con ese cambio dejarías de administrar este lugar. Pedile a otra persona que lo haga.",
			);
		}
	}

	if (change.kind === "grant") {
		await deps.rules.set(
			auth.tenantId,
			{
				path: change.path,
				principal: "user",
				userId: change.userId,
				level: change.level,
			},
			auth.actor.userId,
		);
	} else if (change.kind === "revoke") {
		await deps.rules.remove(
			auth.tenantId,
			{ path: change.path, principal: "user", userId: change.userId },
			auth.actor.userId,
		);
	} else if (change.level === "inherit") {
		await deps.rules.remove(
			auth.tenantId,
			{ path: change.path, principal: "members", userId: null },
			auth.actor.userId,
		);
	} else {
		await deps.rules.set(
			auth.tenantId,
			{
				path: change.path,
				principal: "members",
				userId: null,
				level: change.level,
			},
			auth.actor.userId,
		);
	}
	return { ok: true };
}

export async function loadShareView(
	tenantSlug: string,
	path: string,
	deps: ManageDeps,
): Promise<
	| { ok: true; tenantId: string; view: NodeAccessView }
	| { ok: false; code: FailureCode; message: string }
> {
	const auth = await authorize(tenantSlug, path, deps);
	if (!auth.ok) return auth;
	return {
		ok: true,
		tenantId: auth.tenantId,
		view: explainAccess(auth.rules, path),
	};
}
