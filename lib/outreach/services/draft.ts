// draft_message (spec 03 §6.4): redacta con el modelo del tenant, corre el gate
// y reintenta con las violaciones. No escribe en la base.
import {
	type Canon,
	canonMissingText,
	isCanonMissing,
	loadCanonOrMissing,
} from "../canon";
import { domainFromEmail } from "../domain";
import { isFichaVigente } from "../ficha";
import { type GateResult, type GateViolation, runGate } from "../gate";
import { buildDraftPrompt, draftOutputSchema } from "../prompt";
import { isRefusal, type Refusal, refuse } from "../result";
import type { Caller } from "../session";
import type { AccountRow, OutreachStore, QueueItemKind } from "../store";
import { attributionError, resolveExecutor } from "./executor";

export const MAX_DRAFT_ATTEMPTS = 3;

/** Cuenta y vigencia de su ficha para un email (spec 03 §6.3): la comparten
 * draftMessage y queueTouch para no duplicar la búsqueda por dominio. */
export async function findFichaVigente(
	store: OutreachStore,
	tenantId: string,
	email: string,
	now: Date,
): Promise<{ domain: string | null; account: AccountRow | null }> {
	const domain = domainFromEmail(email);
	const account = domain ? await store.findAccount(tenantId, domain) : null;
	return {
		domain,
		account:
			account && isFichaVigente(new Date(account.expiresAt), now)
				? account
				: null,
	};
}

export interface DraftDeps {
	store: OutreachStore;
	loadCanon: (executorSlug: string) => Promise<Canon>;
	generate: (
		model: string,
		system: string,
		prompt: string,
	) => Promise<{ output: unknown; usage: unknown }>;
	now: () => Date;
}

export type DraftResult =
	| (Refusal & { violations?: GateViolation[] })
	| {
			ok: true;
			subject: string;
			body: string;
			hook: string;
			vector: string;
			idioma: string;
			ancla: { hecho: string; fuente: string };
			gate: GateResult;
			attempts: number;
	  };

export async function draftMessage(
	input: { caller: Caller; contactKey: string; kind: QueueItemKind },
	deps: DraftDeps,
): Promise<DraftResult> {
	const resolved = await resolveExecutor(deps.store, input.caller, null);
	if (isRefusal(resolved)) return resolved;
	const { executor, tenant } = resolved;

	const [contact] = await deps.store.findContactsByKeys(input.caller.tenantId, [
		input.contactKey,
	]);
	if (!contact)
		return refuse(
			"contacto_inexistente",
			`no hay un contacto cargado con la clave ${input.contactKey}`,
		);
	if (!contact.email) return refuse("sin_email", "el contacto no tiene email");
	// Un follow-up cae bajo el primer mensaje: sin hilo abierto no hay dónde
	// responder, y mandarlo fuera de hilo es justo lo que la escucha evita.
	if (input.kind !== "msg1" && !contact.gmailThreadId) {
		return refuse(
			"sin_hilo",
			"este contacto no tiene un hilo abierto: el follow-up tiene que caer bajo el primer mensaje",
		);
	}

	const { domain, account } = await findFichaVigente(
		deps.store,
		input.caller.tenantId,
		contact.email,
		deps.now(),
	);
	if (!account) {
		return refuse(
			"falta_research",
			`no hay ficha vigente de ${domain ?? "la empresa de este contacto"}: corré research_account antes de redactar`,
		);
	}

	const anchorUrls = new Set(
		account.ficha.hechos
			.map((h) => h.url)
			.filter((url) => url.trim().length > 0),
	);
	if (anchorUrls.size === 0) {
		return refuse(
			"sin_ancla",
			`la ficha de ${domain ?? "la empresa de este contacto"} no tiene hechos con fuente: sin ancla no hay primer mensaje`,
		);
	}

	const canon = await loadCanonOrMissing(
		deps.loadCanon,
		executor.slug as string,
	);
	if (isCanonMissing(canon))
		return refuse(
			"canon_no_disponible",
			`${canonMissingText(canon)}: no redacto sin sus reglas`,
		);

	// Follow-ups usan el modelo más liviano del tenant: msg1 es el único que
	// necesita el modelo caro de research+redacción desde cero.
	const model =
		input.kind === "msg1"
			? tenant.config.models.draft_msg1
			: tenant.config.models.draft_followup;

	let violations: GateViolation[] = [];
	for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt++) {
		const { system, prompt } = buildDraftPrompt({
			contact,
			ficha: account.ficha,
			canon: canon.pages,
			voice: canon.voice,
			allowed: {
				hooks: tenant.values.hook,
				vectors: tenant.values.vector,
				idiomas: tenant.values.idioma,
			},
			defaultHook: contact.vector
				? (tenant.defaultHooks[contact.vector] ?? null)
				: null,
			previousViolations: violations,
		});
		const { output } = await deps.generate(model, system, prompt);
		const parsed = draftOutputSchema.safeParse(output);
		if (!parsed.success) {
			violations = [
				{
					kind: "formato",
					piece: "cuerpo",
					what: "la salida no respetó el formato pedido",
					fix: "devolver subject, body, hook, vector, idioma y ancla",
				},
			];
			continue;
		}
		const draft = parsed.data;
		const attribution = attributionError(tenant, draft);
		if (attribution) {
			violations = [
				{
					kind: "formato",
					piece: "cuerpo",
					what: attribution,
					fix: "usar solo valores de las listas",
				},
			];
			continue;
		}
		if (!anchorUrls.has(draft.ancla.fuente)) {
			violations = [
				{
					kind: "formato",
					piece: "cuerpo",
					what: "el ancla no sale de la ficha: la fuente tiene que ser una de las URLs de los hechos",
					fix: "citar como ancla uno de los hechos con URL de la ficha",
				},
			];
			continue;
		}
		const gate = runGate({
			subject: draft.subject,
			body: draft.body,
			channel: "email",
			idioma: draft.idioma,
			rules: canon.rules,
		});
		if (gate.status === "ok")
			return { ok: true, ...draft, gate, attempts: attempt };
		violations = [
			...gate.violations,
			...gate.notes.map((note) => ({
				kind: "idioma" as const,
				piece: "cuerpo" as const,
				what: note,
				fix: "escribir más texto en el idioma del destinatario",
			})),
		];
	}
	return {
		...refuse(
			"gate",
			`después de ${MAX_DRAFT_ATTEMPTS} intentos la pieza no pasa el gate: ${violations.map((v) => v.what).join("; ")}`,
		),
		violations,
	};
}
