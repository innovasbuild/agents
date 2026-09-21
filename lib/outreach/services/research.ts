// Research por cuenta (spec 03 §6.3): ficha vigente 90 días, todo hecho con URL.
import { normalizeDomain } from "../domain";
import { outreachEvent } from "../events";
import {
	type Ficha,
	fichaExpiresAt,
	fichaResearchSchema,
	isFichaVigente,
	sanitizeFicha,
} from "../ficha";
import { type Refusal, refuse } from "../result";
import type { OutreachStore } from "../store";
import type { WebPageResult } from "../web-page";
import {
	RESEARCH_MAX_PAGES,
	type ResearchRunDeps,
	runResearch,
} from "./research-run";

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
		"Después, los dolores: los problemas concretos de su operación, por qué le pesan más a esta empresa que a otras y qué gana si se resuelven.",
		"Cada hecho lleva la URL exacta de donde sale. Sin URL, no es un hecho: dejalo afuera.",
		`Leé la web con leer_pagina empezando por https://${domain}, y no pases de ${RESEARCH_MAX_PAGES} páginas.`,
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
	// Una ficha con hechos y sin dolores se guardó antes de que existieran: la
	// redacción escribe desde los dolores, así que se vuelve a investigar.
	const sinDolores =
		account?.ficha.hechos.length && account.ficha.dolores.length === 0;
	if (
		account &&
		!sinDolores &&
		isFichaVigente(new Date(account.expiresAt), deps.now())
	) {
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
	input: {
		tenantId: string;
		/** null cuando corre desatendido (un workflow): el evento queda sin actor. */
		userId: string | null;
		domain: string;
		raw: unknown;
	},
	deps: ResearchDeps,
): Promise<ResearchResult> {
	const parsed = fichaResearchSchema.safeParse(input.raw);
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

export interface ResearchAccountDeps extends ResearchDeps {
	readPage: (url: string) => Promise<WebPageResult>;
	generate: ResearchRunDeps["generate"];
}

/**
 * El nodo `outreach/research` entero: ficha vigente → la devuelve; si no,
 * investiga con el modelo del tenant y guarda. Una falla del modelo o de la red
 * tira: es infraestructura, y el que llama decide (la tool la convierte en
 * negativa citable, el runner la reintenta). Un resultado de negocio, como
 * `sin_ancla`, vuelve como rechazo.
 */
export async function researchAccount(
	input: {
		tenantId: string;
		userId: string | null;
		domain: string;
		name: string | null;
	},
	deps: ResearchAccountDeps,
): Promise<ResearchResult> {
	const prepared = await prepareResearch(
		{ tenantId: input.tenantId, domain: input.domain, name: input.name },
		deps,
	);
	if (prepared.kind === "done") return prepared.result;

	const tenant = await deps.store.loadTenantOutreach(input.tenantId);
	if (!tenant)
		return refuse(
			"outreach_no_habilitado",
			"este tenant no tiene el agente de outreach habilitado",
		);

	const output = await runResearch(
		{
			domain: prepared.domain,
			name: input.name,
			model: tenant.config.models.researcher,
			message: prepared.message,
		},
		deps,
	);
	return saveResearch(
		{
			tenantId: input.tenantId,
			userId: input.userId,
			domain: prepared.domain,
			raw: output,
		},
		deps,
	);
}
