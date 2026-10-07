// El punto único de control (spec etapa 17 §5): envuelve un BrainProvider con
// los permisos de quien pregunta. Lo invisible responde not_found, igual que lo
// que no existe; forbidden es solo para lo visible sin permiso de escritura.
import { BrainForbidden, BrainNotFound } from "../errors.ts";
import type { BrainProvider } from "../types.ts";
import { resolveAccess } from "./resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	isAdministrator,
	type Principal,
} from "./types.ts";

// Tope de brain_search_pages. Se pide de más para no quedarse corto después de
// descartar lo oculto; no se pagina: una persona muy restringida puede recibir
// menos resultados de los que existen (límite conocido de esta etapa).
const PROVIDER_MAX_LIMIT = 20;
const SEARCH_OVERFETCH = 4;
const DEFAULT_SEARCH_LIMIT = 8;

export function withAccess(
	provider: BrainProvider,
	principal: Principal,
	rules: AccessRule[],
): BrainProvider {
	// Solo un miembro común depende de las reglas: para los demás el envoltorio
	// no filtra nada y se evita pagarlo.
	if (principal.kind !== "user" || isAdministrator(principal)) {
		return provider;
	}

	const levelOf = (slug: string) => resolveAccess(rules, principal, slug);
	const isVisible = (slug: string) => levelOf(slug) !== null;

	return {
		async search(input) {
			const wanted = input.limit ?? DEFAULT_SEARCH_LIMIT;
			const found = await provider.search({
				...input,
				limit: Math.min(PROVIDER_MAX_LIMIT, wanted * SEARCH_OVERFETCH),
			});
			return found.filter((result) => isVisible(result.slug)).slice(0, wanted);
		},

		async read(slug, options) {
			// Sin sugerencias en ningún caso: con ellas, lo oculto (que nunca las
			// tendría) se distinguiría de lo que no existe.
			if (!isVisible(slug)) throw new BrainNotFound(slug, []);
			try {
				return await provider.read(slug, { ...options, suggestions: false });
			} catch (error) {
				if (error instanceof BrainNotFound) {
					throw new BrainNotFound(error.slug, []);
				}
				throw error;
			}
		},

		async list() {
			return (await provider.list()).filter((page) => isVisible(page.slug));
		},

		async history(slug) {
			return isVisible(slug) ? provider.history(slug) : null;
		},

		async upsert(write, author) {
			const level = levelOf(write.slug);
			// Actualizar algo que no se ve es como actualizar algo que no existe.
			if (write.baseRevision !== undefined && level === null) {
				throw new BrainNotFound(write.slug, []);
			}
			// Crear exige editor sobre el propio slug (que incluye su carpeta): si
			// no, ni siquiera un conflicto puede confirmar que un slug oculto existe.
			if (!atLeast(level, "editor")) {
				throw new BrainForbidden(
					"No tenés permiso para escribir en esta parte del brain.",
				);
			}
			return provider.upsert(write, author);
		},
	};
}
