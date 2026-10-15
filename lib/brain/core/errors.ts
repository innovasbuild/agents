// Errores tipados del brain y su forma para el modelo. Sin parameter
// properties: lo importa un script que corre con Node directo.

import type { RulesCascade } from "./rules.ts";

export type BrainErrorCode =
	| "not_found"
	| "conflict"
	| "validation"
	| "forbidden"
	| "provider_unavailable"
	| "rate_limited"
	| "rules_required"
	| "reserved_slug";

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

	constructor(fields: string[], message?: string) {
		super("validation", message ?? `Datos inválidos en: ${fields.join(", ")}.`);
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

// Escritura en una ruta con reglas sin rulesRevision o con uno viejo (spec
// etapa 26 D9). Trae la cascada completa: quien reintenta no necesita otra lectura.
export class BrainRulesRequired extends BrainError {
	readonly rules: RulesCascade;

	constructor(slug: string, rules: RulesCascade, stale: boolean) {
		super(
			"rules_required",
			`${stale ? `Las reglas que aplican a ${slug} cambiaron desde que las leíste.` : `${slug} tiene reglas que tenés que leer antes de escribir.`} Vienen en rules: leelas, ajustá la página si hace falta y reintentá brain_upsert con rulesRevision "${rules.revision}".`,
		);
		this.rules = rules;
	}
}

// 00-reglas y 00-plantilla las escribe quien administra su carpeta (spec etapa
// 26 D10, §4.1).
export class BrainReservedSlug extends BrainError {
	constructor(message: string) {
		super("reserved_slug", message);
	}
}

export function agentReservedSlug(slug: string): BrainReservedSlug {
	return new BrainReservedSlug(
		`${slug} es una página reservada: las instrucciones y reglas del brain (00-reglas) y las plantillas (00-plantilla) las escribe una persona que administra esa carpeta. No la escribas vos: proponé el cambio en la conversación, con el texto completo.`,
	);
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
	rules?: RulesCascade;
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
	if (error instanceof BrainRulesRequired)
		return { ...base, rules: error.rules };
	return base;
}
