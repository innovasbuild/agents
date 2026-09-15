// Ficha de research por cuenta (spec 03 §6.3). Todo hecho con URL.
import { z } from "zod";
import { normalizeDomain } from "./domain";

export const FICHA_TTL_DAYS = 90;

export const fichaSchema = z.object({
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
	return {
		...ficha,
		domain,
		hechos: ficha.hechos.filter((hecho) => isHttpUrl(hecho.url)),
	};
}

export function fichaExpiresAt(researchedAt: Date): Date {
	return new Date(researchedAt.getTime() + FICHA_TTL_DAYS * 86_400_000);
}

export function isFichaVigente(expiresAt: Date, now: Date): boolean {
	return expiresAt.getTime() > now.getTime();
}
