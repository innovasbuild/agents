// Modelo de permisos del brain (spec etapa 17 §3). Sin dependencias: lo usan el
// editor web, el endpoint MCP y las tools del agente. Los imports relativos
// llevan extensión .ts porque un script con Node directo recorre esta cadena.
import type { BrainRole } from "../types.ts";

export type Level = "lector" | "editor" | "administrador";
// "ninguno" solo existe en el acceso general de un nodo: lo restringe.
export type RuleLevel = Level | "ninguno";

// La raíz del brain es la ruta vacía; cualquier otra ruta cumple SLUG_PATTERN.
export const ROOT_PATH = "";

const RANK: Record<Level, number> = { lector: 1, editor: 2, administrador: 3 };

export function atLeast(level: Level | null, minimum: Level): boolean {
	return level !== null && RANK[level] >= RANK[minimum];
}

export function maxLevel(a: Level | null, b: Level | null): Level | null {
	if (a === null) return b;
	if (b === null) return a;
	return RANK[a] >= RANK[b] ? a : b;
}

export type Principal =
	| { kind: "user"; userId: string; role: BrainRole }
	| { kind: "agent"; agent: string }
	| { kind: "platform" }
	| { kind: "import" };

export interface AccessRule {
	path: string;
	principal: "user" | "members";
	userId: string | null;
	level: RuleLevel;
}

export interface AccessRulesStore {
	load(tenantId: string): Promise<AccessRule[]>;
}

// La raíz nace abierta: todos los miembros leen (spec A3).
export const DEFAULT_ROOT_RULE: AccessRule = {
	path: ROOT_PATH,
	principal: "members",
	userId: null,
	level: "lector",
};
