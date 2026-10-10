// Nodo outreach/icp-score (spec etapa 13 §7): tres preguntas a Jev en una
// request, sobre lo que la búsqueda ya devolvió gratis. Sin email, sin research.

import type { CanonLoad } from "../canon";
import { type IcpLevels, icpRevision } from "../canon-blocks";
import {
	DEFAULT_ICP_THRESHOLDS,
	decideIcp,
	type IcpJudgments,
	type IcpLane,
} from "../icp";
import { type Refusal, refuse } from "../result";
import type { OutreachStore } from "../store";
import { readNoul, readScore, type runEvaluation } from "./evaluate";

export const JEV_MODEL = "typesafe-ai/jev";

export interface IcpScoreDeps {
	store: OutreachStore;
	/** Los niveles del ICP del brain de la empresa (spec 21.3 §3.4). */
	loadIcp: (tenantId: string) => Promise<CanonLoad<IcpLevels>>;
	evaluate: (
		args: Parameters<typeof runEvaluation>[0],
	) => Promise<Awaited<ReturnType<typeof runEvaluation>>>;
	now: () => Date;
}

export type IcpScoreResult =
	| Refusal
	| { ok: true; lane: IcpLane; reason: string; judgments: IcpJudgments };

export async function scoreContact(
	input: { tenantId: string; contactId: string },
	deps: IcpScoreDeps,
): Promise<IcpScoreResult> {
	const loaded = await deps.loadIcp(input.tenantId);
	if (!loaded.ok) {
		switch (loaded.reason) {
			case "sin_brain":
				return refuse(
					"icp_sin_brain",
					"esta empresa no tiene el brain habilitado: no se puede calificar",
				);
			case "brain_caido":
				return refuse(
					"canon_no_disponible",
					"no pude leer el ICP de la empresa en el brain",
				);
			case "falta":
				return refuse(
					"icp_sin_niveles",
					"el brain no tiene un bloque icp en una página activa con el tag canon:icp: no se puede calificar",
				);
			default:
				return refuse(
					"icp_invalido",
					`el bloque icp del brain no es válido: ${loaded.errors[0] ?? "revisá la página canon:icp"}`,
				);
		}
	}
	const levels = loaded.value;

	const contact = await deps.store.findContactById(
		input.tenantId,
		input.contactId,
	);
	if (!contact) {
		return refuse(
			"contacto_inexistente",
			`no existe el contacto ${input.contactId}`,
		);
	}
	const account = contact.accountId
		? await deps.store.findAccountById(input.tenantId, contact.accountId)
		: null;

	// El estado: solo lo que vino gratis de la búsqueda. Nada de email.
	const state = {
		persona: { nombre: contact.name, cargo: contact.title },
		empresa: {
			nombre: contact.company,
			dominio: account?.domain ?? null,
			...(account?.firmographics ?? {}),
		},
	};

	const { answers, usage, providerMetadata } = await deps.evaluate({
		model: JEV_MODEL,
		state,
		questions: {
			encaje_empresa: {
				type: "score",
				instructions:
					"¿Qué tan bien entra esta empresa en el perfil de cliente ideal descrito en los niveles?",
				criteria: levels.encaje_empresa,
			},
			rol_decisor: {
				type: "score",
				instructions:
					"¿Qué tanto esta persona está parada donde se decide o se sufre este problema?",
				criteria: levels.rol_decisor,
			},
			excluir: { type: "boolean", instructions: levels.excluir },
		},
	});
	void usage;

	const judgments: IcpJudgments = {
		encaje: readScore(answers, providerMetadata, "encaje_empresa"),
		rol: readScore(answers, providerMetadata, "rol_decisor"),
		excluir: readNoul(answers, "excluir"),
	};
	const decision = decideIcp(judgments, DEFAULT_ICP_THRESHOLDS);

	await deps.store.updateContactIcp(input.tenantId, contact.id, {
		encaje_empresa: judgments.encaje,
		rol_decisor: judgments.rol,
		excluir: judgments.excluir,
		lane: decision.lane,
		reason: decision.reason,
		model: JEV_MODEL,
		revision: icpRevision(levels),
		judged_at: deps.now().toISOString(),
	});

	return { ok: true, lane: decision.lane, reason: decision.reason, judgments };
}
