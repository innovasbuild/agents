// Verificación de conectores antes de asociarlos (spec 21.1 §4). Pura: recibe
// quién consulta a Vercel. En Vercel es obligatoria; en local no hay OIDC y
// la fila queda "sin verificar".
export type ConnectorCheck =
	| { ok: true; names: Record<string, string> }
	// missing: Vercel dijo que no existe o no está adjunto. indeterminate: la
	// consulta falló (red, OIDC); no hay veredicto y no se escribe nada.
	| { ok: false; kind: "missing" | "indeterminate"; message: string };

export async function checkConnectors(
	uids: string[],
	deps: {
		inVercel: boolean;
		describe: (
			uid: string,
		) => Promise<{ name: string; service: string } | null>;
	},
): Promise<ConnectorCheck> {
	if (!deps.inVercel || uids.length === 0) return { ok: true, names: {} };

	const names: Record<string, string> = {};
	for (const uid of uids) {
		let found: { name: string; service: string } | null;
		try {
			found = await deps.describe(uid);
		} catch (error) {
			console.error("No pude consultar el conector en Vercel:", error);
			return {
				ok: false,
				kind: "indeterminate",
				message: "No pude verificar el conector en Vercel. Probá de nuevo.",
			};
		}
		if (!found) {
			return {
				ok: false,
				kind: "missing",
				message: `El conector \`${uid}\` no existe o no está adjunto a este proyecto en Vercel.`,
			};
		}
		names[uid] = found.name;
	}
	return { ok: true, names };
}

/** Nombre guardado en la base: los de todos los identificadores, en orden. */
export function verifiedNameFor(
	uids: string[],
	names: Record<string, string>,
): string | null {
	const found = uids.map((uid) => names[uid]).filter(Boolean);
	return found.length === uids.length && found.length > 0
		? found.join(", ")
		: null;
}
