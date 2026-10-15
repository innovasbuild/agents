// lib/brain/core/rules-source.ts
// De dónde salen las reglas de un brain y cómo se exigen (spec etapa 26 §4.2,
// §4.3). requireRules corre en las superficies que escriben por un modelo (MCP
// y tools del agente): el editor web, el import y los seeds no la llaman.
import { type AccessRule, type Level, ROOT_PATH } from "./access/types.ts";
import {
	BrainForbidden,
	BrainNotFound,
	BrainRulesRequired,
	BrainValidation,
} from "./errors.ts";
import type { BrainFolder } from "./folders.ts";
import { type RuleEntry, type RulesCascade, rulesFor } from "./rules.ts";
import { type BrainWrite, MAX_SLUG_LENGTH, SLUG_PATTERN } from "./types.ts";
import type { WikiStore } from "./wiki-store.ts";

export interface BrainSessionContext {
	/** La 00-reglas activa de la raíz, o null. */
	root: RuleEntry | null;
	/** Carpetas de primer nivel, sin skills. */
	folders: BrainFolder[];
}

export interface RulesSource {
	cascade(slug: string): Promise<RulesCascade>;
	session(): Promise<BrainSessionContext>;
}

export function emptyCascade(): RulesCascade {
	return { revision: "", chain: [], fields: [], template: null };
}

// Un brain externo por MCP no tiene reglas propias (spec etapa 26 D15).
export const EMPTY_RULES: RulesSource = {
	cascade: async () => emptyCascade(),
	session: async () => ({ root: null, folders: [] }),
};

function checkPath(slug: string): void {
	if (
		slug !== ROOT_PATH &&
		(slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug))
	)
		throw new BrainValidation(["path"]);
}

export function createWikiRules(options: {
	tenantId: string;
	store: Pick<WikiStore, "listRulePages" | "listFolders">;
}): RulesSource {
	const { tenantId, store } = options;
	return {
		async cascade(slug) {
			checkPath(slug);
			return rulesFor(slug, await store.listRulePages(tenantId));
		},
		async session() {
			const [pages, folders] = await Promise.all([
				store.listRulePages(tenantId),
				store.listFolders(tenantId),
			]);
			return {
				root: rulesFor(ROOT_PATH, pages).chain[0] ?? null,
				folders: folders.filter(
					(folder) => !folder.path.includes("/") && folder.path !== "skills",
				),
			};
		},
	};
}

// Las reglas se filtran por la ruta pedida, no por la 00-reglas: una que la
// persona no puede leer igual le llega si gobierna lo que ve (spec §4.2).
export function withRulesAccess(
	source: RulesSource,
	levelOf: (path: string) => Level | null,
): RulesSource {
	return {
		async cascade(slug) {
			if (levelOf(slug) === null) throw new BrainNotFound(slug, []);
			return source.cascade(slug);
		},
		async session() {
			const context = await source.session();
			return {
				root: context.root,
				folders: context.folders.filter(
					(folder) => levelOf(folder.path) !== null,
				),
			};
		},
	};
}

// Las instrucciones de la raíz gobiernan todo el brain: le llegan a quien ve
// alguna parte de él. Una ruta solo es visible si lo es la raíz o la ruta de
// alguna regla (la que da el permiso), así que alcanza con mirar esas.
export function seesBrain(
	rules: Pick<AccessRule, "path">[],
	levelOf: (path: string) => Level | null,
): boolean {
	return [ROOT_PATH, ...rules.map((rule) => rule.path)].some(
		(path) => levelOf(path) !== null,
	);
}

export async function requireRules(
	source: RulesSource,
	write: BrainWrite,
): Promise<BrainWrite> {
	const { rulesRevision, ...rest } = write;
	let cascade: RulesCascade;
	try {
		cascade = await source.cascade(write.slug);
	} catch (error) {
		// Lo que no se ve se rechaza como en withAccess, sin confirmar que existe.
		if (error instanceof BrainNotFound)
			throw write.baseRevision === undefined
				? new BrainForbidden(
						"No tenés permiso para escribir en esta parte del brain.",
					)
				: new BrainNotFound(write.slug, []);
		throw error;
	}
	// Sin cadena la ruta no tiene reglas: un valor espurio no frena nada.
	if (cascade.revision !== "" && rulesRevision !== cascade.revision)
		throw new BrainRulesRequired(
			write.slug,
			cascade,
			rulesRevision !== undefined,
		);
	return rest;
}
