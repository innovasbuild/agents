// Ficha de research por cuenta (spec 03 §6.3). Todo hecho con URL. Guarda qué
// es la empresa y, desde los dolores, qué le podemos resolver: eso es lo que
// usa la redacción.
import { z } from "zod";
import { normalizeDomain } from "./domain";

export const FICHA_TTL_DAYS = 90;

export const dolorSchema = z.object({
	dolor: z.string().trim().min(1).max(300),
	por_que_a_ellos: z.string().trim().min(1).max(400),
	beneficio: z.string().trim().min(1).max(300),
	evidencia: z.string().trim().nullable(),
});

export type Dolor = z.infer<typeof dolorSchema>;

const MAX_DOLORES = 6;

const fichaBase = z.object({
	name: z.string().trim().min(1).max(300),
	domain: z.string().trim().min(3).max(300),
	produce: z.string().nullable(),
	gana: z.string().nullable(),
	compra: z.string().nullable(),
	rompe_si_crece: z.string().nullable(),
	gap_declarado: z.string().nullable(),
	gap_demostrable: z.string().nullable(),
	hechos: z
		.array(
			z.object({
				hecho: z.string().trim().min(1).max(500),
				url: z.string().trim(),
				fecha: z.string().nullable(),
			}),
		)
		.max(30),
	creditos_usados: z.number().int().min(0),
});

/** Lo que devuelve el modelo: `dolores` obligatorio (con default, el JSON schema de entrada lo volvería opcional). */
export const fichaResearchSchema = fichaBase.extend({
	dolores: z.array(dolorSchema).max(MAX_DOLORES),
});

/** Lo guardado: las fichas de antes de los dolores se leen con `dolores` vacío. */
export const fichaSchema = fichaBase.extend({
	dolores: z.array(dolorSchema).max(MAX_DOLORES).default([]),
});

export type Ficha = z.infer<typeof fichaSchema>;

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function sanitizeFicha(ficha: Ficha): Ficha | null {
	const domain = normalizeDomain(ficha.domain);
	if (!domain) return null;
	const hechos = ficha.hechos.filter((hecho) => isHttpUrl(hecho.url));
	const urls = new Set(hechos.map((hecho) => hecho.url));
	return {
		...ficha,
		domain,
		hechos,
		dolores: ficha.dolores.map((dolor) => ({
			...dolor,
			evidencia:
				dolor.evidencia && urls.has(dolor.evidencia) ? dolor.evidencia : null,
		})),
	};
}

export function fichaExpiresAt(researchedAt: Date): Date {
	return new Date(researchedAt.getTime() + FICHA_TTL_DAYS * 86_400_000);
}

export function isFichaVigente(expiresAt: Date, now: Date): boolean {
	return expiresAt.getTime() > now.getTime();
}
