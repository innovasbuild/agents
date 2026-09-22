// Nodo leads/reveal-email (spec etapa 13 §5.2 y §6.3): revela el email y en
// la MISMA operación promueve la clave del contacto a em:<email>. No hay
// transacción explícita porque no hace falta: promoteContactKey es un solo
// UPDATE atómico, y si algo falla después (nada falla después) no queda a
// medio camino.
import { contactKey, normalizeEmail } from "../contact-key";
import type { LeadsAdapter } from "../../connectors/leads/adapter";
import { type Refusal, refuse } from "../result";
import type { OutreachStore } from "../store";

export interface RevealEmailDeps {
	store: OutreachStore;
	leads: LeadsAdapter;
}

export type RevealEmailResult =
	| Refusal
	| { ok: true; email: string; creditsUsed: number };

export async function revealContactEmail(
	input: { tenantId: string; contactId: string },
	deps: RevealEmailDeps,
): Promise<RevealEmailResult> {
	const contact = await deps.store.findContactById(input.tenantId, input.contactId);
	if (!contact) {
		return refuse("contacto_inexistente", `no existe el contacto ${input.contactId}`);
	}
	const apolloId = (contact.externalIds as { apollo?: string } | undefined)?.apollo;
	if (!apolloId) {
		return refuse(
			"sin_origen_apollo",
			"este contacto no vino de Apollo: no hay a quién pedirle el email",
		);
	}
	if (await deps.store.hasContactBeenTouched(input.tenantId, contact.contactKey)) {
		return refuse(
			"contacto_ya_tocado",
			"este contacto ya tiene eventos o piezas: su clave ya está congelada",
		);
	}

	const revealed = await deps.leads.revealEmail(apolloId);
	if (!revealed.email) {
		return refuse("sin_email", "Apollo no tiene (o no revela) el email de esta persona");
	}
	const email = normalizeEmail(revealed.email);
	if (!email) {
		return refuse("email_invalido", `Apollo devolvió un email con forma inválida`);
	}
	const newKey = contactKey({ email });

	const promoted = await deps.store.promoteContactKey(input.tenantId, contact.id, {
		oldKey: contact.contactKey,
		newKey,
		email,
	});
	if (promoted === "duplicado") {
		return refuse(
			"duplicado",
			`ya existe un contacto con la clave ${newKey}: esta persona ya estaba en la base`,
		);
	}
	if (promoted === "carrera_perdida") {
		// Otro proceso ya promovió esta clave entre el read y el write: no hay
		// nada más para hacer, el contacto ya tiene su email.
		return refuse(
			"ya_promovido",
			"la clave de este contacto ya se promovió en otra corrida",
		);
	}

	return { ok: true, email, creditsUsed: revealed.creditsUsed };
}
