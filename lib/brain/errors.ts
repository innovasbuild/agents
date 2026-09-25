// Errores tipados del brain y su forma para el modelo. Sin parameter
// properties: lo importa un script que corre con Node directo.

export type BrainErrorCode =
	| "not_found"
	| "conflict"
	| "validation"
	| "forbidden"
	| "provider_unavailable"
	| "rate_limited";

export class BrainError extends Error {
	readonly code: BrainErrorCode;

	constructor(code: BrainErrorCode, message: string) {
		super(message);
		this.name = "BrainError";
		this.code = code;
	}
}

export class BrainNotFound extends BrainError {
	readonly slug: string;
	readonly suggestions: string[];

	constructor(slug: string, suggestions: string[]) {
		super(
			"not_found",
			`No existe la página "${slug}" en el brain de este cliente.`,
		);
		this.slug = slug;
		this.suggestions = suggestions;
	}
}

export class BrainConflict extends BrainError {
	readonly slug: string;
	readonly currentRevision: number | null;

	constructor(slug: string, currentRevision: number | null) {
		super(
			"conflict",
			`La página "${slug}" cambió desde que la leíste. Volvé a leerla con brain_read antes de escribir.`,
		);
		this.slug = slug;
		this.currentRevision = currentRevision;
	}
}

export class BrainValidation extends BrainError {
	readonly fields: string[];

	constructor(fields: string[]) {
		super("validation", `Datos inválidos en: ${fields.join(", ")}.`);
		this.fields = fields;
	}
}

export class BrainForbidden extends BrainError {
	constructor(message: string) {
		super("forbidden", message);
	}
}

export class BrainProviderError extends BrainError {
	constructor(message: string) {
		super("provider_unavailable", message);
	}
}

export class BrainRateLimited extends BrainError {
	readonly retryAfterSeconds: number;

	constructor(retryAfterSeconds: number) {
		super(
			"rate_limited",
			`Pasaste el límite de llamadas por minuto. Probá de nuevo en ${retryAfterSeconds} segundos.`,
		);
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export interface BrainToolError {
	ok: false;
	error: BrainErrorCode;
	message: string;
	suggestions?: string[];
	currentRevision?: number | null;
	fields?: string[];
	retryable?: boolean;
	retryAfterSeconds?: number;
}

export function toToolError(error: unknown): BrainToolError {
	if (!(error instanceof BrainError)) throw error;

	const base: BrainToolError = {
		ok: false,
		error: error.code,
		message: error.message,
	};
	if (error instanceof BrainNotFound)
		return { ...base, suggestions: error.suggestions };
	if (error instanceof BrainConflict)
		return { ...base, currentRevision: error.currentRevision };
	if (error instanceof BrainValidation)
		return { ...base, fields: error.fields };
	if (error instanceof BrainRateLimited)
		return {
			...base,
			retryable: true,
			retryAfterSeconds: error.retryAfterSeconds,
		};
	return base;
}
