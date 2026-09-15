// Research por cuenta (spec 03 §6.3): ficha vigente 90 días, todo hecho con URL.
import { normalizeDomain } from "../domain";
import { outreachEvent } from "../events";
import {
	type Ficha,
	fichaExpiresAt,
	fichaSchema,
	isFichaVigente,
	sanitizeFicha,
} from "../ficha";
import { type Refusal, refuse } from "../result";
import type { OutreachStore } from "../store";

export type ResearchResult =
	| Refusal
	| {
			ok: true;
			cached: boolean;
			domain: string;
			name: string;
			ficha: Ficha;
			expiresAt: string;
	  };

interface ResearchDeps {
	store: OutreachStore;
	now: () => Date;
}

export function researchMessage(domain: string, name: string | null): string {
	return [
		`Investigá la empresa del dominio ${domain}${name ? ` (${name})` : ""}.`,
		"Completá la ficha: qué produce y vende, cómo gana plata, qué compra, qué se le rompe si crece, qué dice de sí misma (gap declarado) y qué podés probar con fuentes (gap demostrable).",
		"Cada hecho lleva la URL exacta de donde sale. Sin URL, no es un hecho: dejalo afuera.",
		"Usá primero la web y el LinkedIn de la empresa; las herramientas de enriquecimiento pagas solo si falta lo básico, y contá cada llamada en creditos_usados.",
	].join("\n");
}

export async function prepareResearch(
	input: { tenantId: string; domain: string; name: string | null },
	deps: ResearchDeps,
): Promise<
	| { kind: "done"; result: ResearchResult }
	| { kind: "research"; domain: string; message: string }
> {
	const domain = normalizeDomain(input.domain);
	if (!domain)
		return {
			kind: "done",
			result: refuse(
				"dominio_invalido",
				`"${input.domain}" no es un dominio válido`,
			),
		};
	const account = await deps.store.findAccount(input.tenantId, domain);
	if (account && isFichaVigente(new Date(account.expiresAt), deps.now())) {
		return {
			kind: "done",
			result: {
				ok: true,
				cached: true,
				domain,
				name: account.name,
				ficha: account.ficha,
				expiresAt: account.expiresAt,
			},
		};
	}
	return {
		kind: "research",
		domain,
		message: researchMessage(domain, input.name),
	};
}

export async function saveResearch(
	input: { tenantId: string; userId: string; domain: string; raw: unknown },
	deps: ResearchDeps,
): Promise<ResearchResult> {
	const parsed = fichaSchema.safeParse(input.raw);
	if (!parsed.success)
		return refuse(
			"ficha_invalida",
			"la investigación devolvió una ficha que no cumple el formato",
		);
	const ficha = sanitizeFicha(parsed.data);
	if (!ficha)
		return refuse("dominio_invalido", "la ficha trae un dominio inválido");
	if (ficha.hechos.length === 0) {
		return refuse(
			"sin_ancla",
			`no encontré hechos con fuente sobre ${input.domain}: sin ancla no hay primer mensaje`,
		);
	}
	const researchedAt = deps.now();
	const account = await deps.store.upsertAccount({
		tenantId: input.tenantId,
		domain: input.domain,
		name: ficha.name,
		ficha,
		researchedAt: researchedAt.toISOString(),
		expiresAt: fichaExpiresAt(researchedAt).toISOString(),
	});
	await deps.store.insertEvents([
		outreachEvent({
			tenant_id: input.tenantId,
			actor_user_id: input.userId,
			contact_key: null,
			channel: null,
			type: "investigado",
			summary: `ficha de ${input.domain}`,
			payload: {
				domain: input.domain,
				hechos: ficha.hechos.length,
				creditos_usados: ficha.creditos_usados,
			},
		}),
	]);
	return {
		ok: true,
		cached: false,
		domain: account.domain,
		name: account.name,
		ficha: account.ficha,
		expiresAt: account.expiresAt,
	};
}
