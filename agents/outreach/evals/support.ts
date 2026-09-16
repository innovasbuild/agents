// Estado conocido del tenant de eval antes de cada caso. Solo local: el runner
// ya se negó si la base no lo es.
import { createAdminClient } from "../../../lib/supabase/admin";

export const EVAL_TENANT_ID = "e7a1e7a1-0000-0000-0000-0000000000aa";
export const EVAL_USER_ID = "e7a1e7a1-0000-0000-0000-000000000001";
export const OTHER_USER_ID = "e7a1e7a1-0000-0000-0000-000000000002";

export async function resetEvalTenant(): Promise<void> {
	const admin = createAdminClient();
	const steps = [
		admin.from("queue_items").delete().eq("tenant_id", EVAL_TENANT_ID),
		admin
			.from("contacts")
			.delete()
			.eq("tenant_id", EVAL_TENANT_ID)
			.not(
				"contact_key",
				"in",
				'("em:laura@acme-eval.test","em:beto@acme-eval.test")',
			),
		admin
			.from("contacts")
			.update({
				owner_user_id: null,
				stage: "a_contactar",
				touches: 0,
				first_touch_at: null,
				last_touch_at: null,
				next_step_at: null,
				crm_id: null,
			})
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("contact_key", "em:laura@acme-eval.test"),
	];
	for (const step of steps) {
		const { error } = await step;
		if (error)
			throw new Error(`no pude resetear el tenant de eval: ${error.message}`);
	}
}

const PASSING_BODY = [
	"Hola,",
	"",
	"Vi que Acme abrió una segunda planta en Rafaela este año. Cuando la operación crece así, el costo de coordinar crece más rápido que la facturación.",
	"",
	"Armamos con equipos como el tuyo un tablero que ordena pedidos y compras sin sumar gente al back office.",
	"",
	"Si te sirve, te cuento en 30 minutos cómo lo aplicamos en una empresa del rubro. Tenés un rato el jueves?",
].join("\n");

export async function ensureContact(
	contactKey: string,
	email: string,
	name: string,
): Promise<string> {
	const admin = createAdminClient();
	const { data, error } = await admin
		.from("contacts")
		.upsert(
			{
				tenant_id: EVAL_TENANT_ID,
				contact_key: contactKey,
				email,
				name,
				company: "Acme Eval",
				account_id: "e7a1e7a1-0000-0000-0000-0000000000a1",
				segment: "mid_market_ar",
				vector: "v1_eval",
				source: "csv",
			},
			{ onConflict: "tenant_id,contact_key" },
		)
		.select("id")
		.single();
	if (error || !data)
		throw new Error(`no pude sembrar el contacto: ${error?.message}`);
	return data.id;
}

export async function seedPendingPiece(
	contactKey: string,
	overrides: { subject?: string; body?: string } = {},
): Promise<string> {
	const admin = createAdminClient();
	const { data: contact } = await admin
		.from("contacts")
		.select("id, email")
		.eq("tenant_id", EVAL_TENANT_ID)
		.eq("contact_key", contactKey)
		.single();
	if (!contact) throw new Error(`no existe el contacto ${contactKey}`);
	const subject = overrides.subject ?? "Crecer sin sumar gente";
	const body = overrides.body ?? PASSING_BODY;
	const { data, error } = await admin
		.from("queue_items")
		.insert({
			tenant_id: EVAL_TENANT_ID,
			contact_id: contact.id,
			contact_key: contactKey,
			executor_user_id: EVAL_USER_ID,
			kind: "msg1",
			to_email: contact.email,
			subject,
			body,
			hook: "h_eval",
			vector: "v1_eval",
			idioma: "es_ar",
			ancla: {
				hecho: "Abrió una segunda planta en Rafaela",
				fuente: "https://acme-eval.test/noticias/rafaela",
			},
			draft_original: { subject, body },
			gate_result: { status: "ok", violations: [], warnings: [], notes: [] },
		})
		.select("id")
		.single();
	if (error || !data)
		throw new Error(`no pude sembrar la pieza: ${error?.message}`);
	await admin
		.from("contacts")
		.update({ owner_user_id: EVAL_USER_ID })
		.eq("id", contact.id);
	return data.id;
}

// Binding mail/gmail del tenant de eval, para que send_email pase el chequeo de
// sin_gmail y llegue al pedido de token. Sin grant de Connect para el usuario
// de eval, ahí eve pide autorización.
export async function enableEvalGmailBinding(): Promise<void> {
	const { error } = await createAdminClient().from("tenant_connections").upsert(
		{
			tenant_id: EVAL_TENANT_ID,
			capability: "mail",
			provider: "gmail",
			config: {},
			enabled: true,
		},
		{ onConflict: "tenant_id,capability,provider" },
	);
	if (error)
		throw new Error(
			`no pude habilitar Gmail en el tenant de eval: ${error.message}`,
		);
}

export async function disableEvalGmailBinding(): Promise<void> {
	const { error } = await createAdminClient()
		.from("tenant_connections")
		.delete()
		.eq("tenant_id", EVAL_TENANT_ID)
		.eq("capability", "mail")
		.eq("provider", "gmail");
	if (error)
		throw new Error(`no pude sacar Gmail del tenant de eval: ${error.message}`);
}
