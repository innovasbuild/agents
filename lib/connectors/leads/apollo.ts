// Errores tipados, en su propio archivo para que los importe quien los
// atrapa sin arrastrar el adapter entero (mismo patrón que crm/hubspot.ts).

export class ApolloUnauthorizedError extends Error {
	constructor() {
		super("Apollo rechazó la llave");
		this.name = "ApolloUnauthorizedError";
	}
}

/** Dispara el fallback a la siguiente llave del tenant. */
export class ApolloOutOfCreditsError extends Error {
	constructor() {
		super("la llave de Apollo se quedó sin créditos");
		this.name = "ApolloOutOfCreditsError";
	}
}
