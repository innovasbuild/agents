// "Mis cuentas" (spec 21.2 §4.4): qué cuentas le corresponden a una persona y
// en qué estado está cada una. Puro: quien llama inyecta cómo pedir el token.
// Pedir un token no modifica nada; arrancar una autorización sí (deja el grant
// anterior sin servir), y por eso NO vive acá.
export type AccountKey = "hubspot" | "gmail";
export type AccountState =
	| "autorizada"
	| "sin_autorizar"
	| "no_disponible"
	| "desconocido";

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
	hubspot: "HubSpot",
	gmail: "Gmail",
};

export const STATE_LABELS: Record<AccountState, string> = {
	autorizada: "Autorizada",
	sin_autorizar: "Sin autorizar",
	no_disponible: "No disponible: pedile a INNOV.AS que la habilite",
	desconocido: "No pude comprobarlo. Recargá la página.",
};

export function isAccountKey(value: string): value is AccountKey {
	return value === "hubspot" || value === "gmail";
}

export function accountsFor(input: {
	connections: { capability: string; provider: string; enabled: boolean }[];
	isExecutor: boolean;
}): AccountKey[] {
	const has = (capability: string, provider: string) =>
		input.connections.some(
			(c) =>
				c.enabled && c.capability === capability && c.provider === provider,
		);
	const keys: AccountKey[] = [];
	if (has("crm", "hubspot")) keys.push("hubspot");
	if (input.isExecutor && has("mail", "gmail")) keys.push("gmail");
	return keys;
}

/**
 * Un error que no es "falta el grant" ni "no está instalado" es desconocido:
 * decir "sin autorizar" ofrecería un botón que arranca una autorización sobre
 * un grant que puede estar perfecto.
 */
export async function probeAccount(
	key: AccountKey,
	deps: {
		token: (key: AccountKey) => Promise<unknown>;
		isAuthError: (error: unknown) => boolean;
		isNotInstalled: (error: unknown) => boolean;
	},
): Promise<AccountState> {
	try {
		await deps.token(key);
		return "autorizada";
	} catch (error) {
		if (deps.isNotInstalled(error)) return "no_disponible";
		if (deps.isAuthError(error)) return "sin_autorizar";
		console.error(
			`mis-cuentas: no pude comprobar ${key}:`,
			error instanceof Error ? error.message : String(error),
		);
		return "desconocido";
	}
}
