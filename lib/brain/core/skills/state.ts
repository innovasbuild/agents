// Estado de publicación de una skill (spec etapa 24.1 §8.1). Puro.
import type { SkillOverviewRow, SkillSnapshot } from "./store.ts";

export type SkillState =
	| { kind: "sin_publicar" }
	| { kind: "publicada"; version: number; dirty: boolean }
	| { kind: "retirada"; version: number };

export function skillState(row: SkillOverviewRow): SkillState {
	const current = row.current;
	if (!current) return { kind: "sin_publicar" };
	if (current.action === "retirar")
		return { kind: "retirada", version: current.version };
	return {
		kind: "publicada",
		version: current.version,
		// Tras republicar una versión anterior, la revisión congelada es la de
		// aquella versión: el borrador queda "con cambios", que es lo correcto.
		dirty:
			row.revision !== current.pageRevision ||
			row.draftFilesDigest !== current.filesDigest,
	};
}

// La copia que se distribuye: el último acto, solo si es una publicación.
export function publishedSnapshot(
	row: SkillOverviewRow | undefined,
): SkillSnapshot | null {
	return row?.current?.action === "publicar" ? row.current : null;
}

export function skillStateLabel(state: SkillState): string {
	if (state.kind === "sin_publicar") return "Sin publicar";
	if (state.kind === "retirada") return `Retirada (era la v${state.version})`;
	return state.dirty
		? `Publicada v${state.version}, con cambios sin publicar`
		: `Publicada v${state.version}`;
}
