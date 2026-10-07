// Vista de un nodo para el diálogo de compartir (spec etapa 17 §7.3): reglas
// propias, heredadas con su origen y acceso general efectivo. Pura.
import { parentPath } from "./resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	type Level,
	type RuleLevel,
} from "./types.ts";

export interface PersonRule {
	userId: string;
	level: Level;
}

export interface InheritedPersonRule extends PersonRule {
	from: string; // ruta del ancestro donde se dio
}

export interface GeneralAccessView {
	own: RuleLevel | null; // null = hereda
	// Lo que hereda: from es la ruta del ancestro, o null si no hay ninguna
	// fila (el valor por defecto es lector).
	inherited: { level: RuleLevel; from: string | null };
	effective: RuleLevel;
}

export interface NodeAccessView {
	path: string;
	own: PersonRule[];
	inherited: InheritedPersonRule[];
	general: GeneralAccessView;
}

function strictAncestors(path: string): string[] {
	const found: string[] = [];
	for (let n = parentPath(path); n !== null; n = parentPath(n)) found.push(n);
	return found; // del más cercano al más lejano (la raíz queda última)
}

export function explainAccess(
	rules: AccessRule[],
	path: string,
): NodeAccessView {
	const userRules = rules.filter(
		(r): r is AccessRule & { userId: string; level: Level } =>
			r.principal === "user" && r.userId !== null && r.level !== "ninguno",
	);

	const own = userRules
		.filter((r) => r.path === path)
		.map(({ userId, level }) => ({ userId, level }));

	// Por persona, la regla más alta de los ancestros; si empatan, la más cercana.
	const ancestors = strictAncestors(path);
	const best = new Map<string, InheritedPersonRule>();
	for (const from of [...ancestors].reverse()) {
		for (const r of userRules.filter((x) => x.path === from)) {
			const current = best.get(r.userId);
			if (!current || !atLeast(current.level, r.level)) {
				best.set(r.userId, { userId: r.userId, level: r.level, from });
			} else if (current.level === r.level) {
				best.set(r.userId, { userId: r.userId, level: r.level, from });
			}
		}
	}

	const ownGeneral =
		rules.find((r) => r.principal === "members" && r.path === path)?.level ??
		null;
	let inherited: GeneralAccessView["inherited"] = {
		level: "lector",
		from: null,
	};
	// De la raíz hacia abajo: el ancestro más cercano con regla pisa a los demás.
	for (const from of [...ancestors].reverse()) {
		const rule = rules.find(
			(r) => r.principal === "members" && r.path === from,
		);
		if (rule) inherited = { level: rule.level, from };
	}

	return {
		path,
		own,
		inherited: [...best.values()],
		general: {
			own: ownGeneral,
			inherited,
			effective: ownGeneral ?? inherited.level,
		},
	};
}
