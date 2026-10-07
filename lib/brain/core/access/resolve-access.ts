// Resolución de permisos (spec etapa 17 §3.3). Pura: recibe las reglas del
// tenant, quién pregunta y la ruta, y devuelve el nivel o null si no lo ve.
import {
	type AccessRule,
	type Level,
	maxLevel,
	type Principal,
	ROOT_PATH,
} from "./types.ts";

export function parentPath(path: string): string | null {
	if (path === ROOT_PATH) return null;
	const cut = path.lastIndexOf("/");
	return cut === -1 ? ROOT_PATH : path.slice(0, cut);
}

// Raíz primero: "a/b/c" → ["", "a", "a/b", "a/b/c"].
export function ancestorChain(path: string): string[] {
	const chain: string[] = [];
	for (let node: string | null = path; node !== null; node = parentPath(node)) {
		chain.unshift(node);
	}
	return chain;
}

export function resolveAccess(
	rules: AccessRule[],
	principal: Principal,
	path: string,
): Level | null {
	// Solo un miembro común depende de las reglas (spec A9): administradores,
	// agente, plataforma e import administran todo.
	if (principal.kind !== "user" || principal.role !== "tenant_member") {
		return "administrador";
	}

	const chain = ancestorChain(path);

	// Por persona: se acumula el mayor nivel de la ruta y de sus ancestros, y lo
	// dado arriba no se quita abajo (A7).
	let own: Level | null = null;
	for (const rule of rules) {
		if (rule.principal !== "user" || rule.userId !== principal.userId) continue;
		if (rule.level === "ninguno" || !chain.includes(rule.path)) continue;
		own = maxLevel(own, rule.level);
	}

	// Acceso general: manda la regla del nodo más profundo que tenga una. Sin
	// ninguna, lector: un tenant sin la fila de la raíz no pierde su brain.
	let general: Level | null = "lector";
	for (const node of chain) {
		const rule = rules.find(
			(r) => r.principal === "members" && r.path === node,
		);
		if (rule) general = rule.level === "ninguno" ? null : rule.level;
	}

	return maxLevel(own, general);
}
