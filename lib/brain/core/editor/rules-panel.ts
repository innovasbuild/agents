// lib/brain/core/editor/rules-panel.ts
// Panel "Reglas que aplican" del editor web (spec etapa 26 §4.3). Informativo:
// no exige nada. Lleva al navegador el cuerpo de cada 00-reglas que gobierna la
// ruta, filtrado por la ruta pedida, igual que el MCP (§4.2). Usa rules.ts (y
// node:crypto): el cliente importa de acá solo tipos.
import { type Level, ROOT_PATH } from "../access/types.ts";
import { BrainNotFound, BrainValidation } from "../errors.ts";
import {
	type RulesSource,
	withoutSkillRules,
	withRulesAccess,
} from "../rules-source.ts";
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types.ts";
import { RULES_LOAD_ERROR, rulesTitle } from "./reserved.ts";

export interface RulesPanelEntry {
	path: string;
	slug: string;
	title: string;
	body: string;
	/** La persona puede abrir la 00-reglas; si no, se muestra sin link. */
	visible: boolean;
}

export type RulesPanelView =
	| { kind: "rules"; entries: RulesPanelEntry[] }
	| { kind: "error"; message: string };

// Hoja de sondeo para la cascada de una página que todavía no existe: la
// cascada depende solo de la carpeta.
export const PROBE_LEAF = "nueva-pagina";

export function probeSlugFor(folder: string): string {
	return folder === ROOT_PATH ? PROBE_LEAF : `${folder}/${PROBE_LEAF}`;
}

// Misma garantía que el MCP: por la ruta pedida, y skills/ afuera.
export function editorRules(
	source: RulesSource,
	levelOf: (path: string) => Level | null,
): RulesSource {
	return withoutSkillRules(withRulesAccess(source, levelOf));
}

// null: sin panel (la ruta no tiene reglas, no se ve, es de skills o no es
// válida). Un error de lectura no rompe el editor: se avisa y se registra.
export async function loadRulesPanel(
	source: RulesSource,
	slug: string,
	levelOf: (path: string) => Level | null,
	onError: (error: unknown) => void,
): Promise<RulesPanelView | null> {
	try {
		const cascade = await source.cascade(slug);
		if (cascade.chain.length === 0) return null;
		return {
			kind: "rules",
			entries: cascade.chain.map((entry) => ({
				path: entry.path,
				slug: entry.slug,
				title: rulesTitle(entry.path),
				body: entry.body,
				visible: levelOf(entry.slug) !== null,
			})),
		};
	} catch (error) {
		if (error instanceof BrainNotFound || error instanceof BrainValidation)
			return null;
		onError(error);
		return { kind: "error", message: RULES_LOAD_ERROR };
	}
}

// "Nueva página": la carpeta tiene que verse, además de la hoja de sondeo.
export async function loadFolderRulesPanel(
	source: RulesSource,
	folder: string,
	levelOf: (path: string) => Level | null,
	onError: (error: unknown) => void,
): Promise<RulesPanelView | null> {
	if (
		folder !== ROOT_PATH &&
		(folder.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(folder))
	)
		return null;
	if (levelOf(folder) === null) return null;
	return loadRulesPanel(source, probeSlugFor(folder), levelOf, onError);
}
