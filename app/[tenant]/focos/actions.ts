// app/[tenant]/focos/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseFocusForm } from "@/lib/outreach/focus-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { webStoreDeps } from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";
import { createSupabaseWorkflowStore } from "@/lib/workflows/store";
import { enqueue } from "@/lib/workflows/enqueue";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);
const idSchema = z.uuid();
const reasonSchema = z.string().trim().min(1).max(500);

export type FocoResult = { ok: true } | { ok: false; message: string };

export async function createFocus(
	slug: string,
	form: unknown,
): Promise<FocoResult> {
	if (!slugSchema.safeParse(slug).success)
		return { ok: false, message: "Cliente inválido." };
	const session = await webSession(slug);
	if (!session) return { ok: false, message: "Volvé a entrar: no hay sesión." };

	let parsed: ReturnType<typeof parseFocusForm>;
	try {
		parsed = parseFocusForm(form);
	} catch {
		return { ok: false, message: "Revisá los campos del foco." };
	}

	const executor = await webStoreDeps().store.loadExecutor(
		session.caller.tenantId,
		session.caller.userId,
	);
	if (!executor?.slug) {
		return { ok: false, message: "No sos ejecutor de outreach en este cliente." };
	}

	await webStoreDeps().store.insertFocus({
		tenantId: session.caller.tenantId,
		createdBy: session.caller.userId,
		...parsed,
	});
	revalidatePath(`/${slug}/focos`);
	return { ok: true };
}

/** Calificar a mano un contacto "para revisar": encola el enrichment
 * directo (spec §9.2 — no vuelve a pasar por icp-scoring, ese ítem ya
 * quedó `done`; el humano ya decidió el carril).
 *
 * enqueue() escribe en work_items, que no tiene policy de insert para
 * authenticated (revoke insert, update, delete ... from authenticated, anon
 * en supabase/migrations/20260921100000_work_items.sql: solo service_role
 * inserta, vía claim_work_items o directo). Por eso acá va el cliente admin,
 * no el de sesión del usuario. */
export async function qualifyContact(
	slug: string,
	contactId: string,
): Promise<FocoResult> {
	if (!slugSchema.safeParse(slug).success || !idSchema.safeParse(contactId).success) {
		return { ok: false, message: "Pedido inválido." };
	}
	const session = await webSession(slug);
	if (!session) return { ok: false, message: "Volvé a entrar: no hay sesión." };

	const result = await enqueue(
		{
			tenantId: session.caller.tenantId,
			workflow: "contact-enrichment",
			subjectType: "contact",
			subjectId: contactId,
			inputHash: contactId,
		},
		{ store: createSupabaseWorkflowStore(createAdminClient()) },
	);
	if (!result.enqueued && result.reason !== "ya_visto") {
		return { ok: false, message: "No se pudo encolar el enrichment." };
	}
	revalidatePath(`/${slug}/focos`);
	return { ok: true };
}

export async function discardContact(
	slug: string,
	contactId: string,
	reason: string,
): Promise<FocoResult> {
	if (!slugSchema.safeParse(slug).success || !idSchema.safeParse(contactId).success) {
		return { ok: false, message: "Pedido inválido." };
	}
	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success)
		return { ok: false, message: "Escribí por qué lo descartás." };
	const session = await webSession(slug);
	if (!session) return { ok: false, message: "Volvé a entrar: no hay sesión." };

	const contact = await webStoreDeps().store.findContactById(
		session.caller.tenantId,
		contactId,
	);
	if (!contact) return { ok: false, message: "No encuentro ese contacto." };
	await webStoreDeps().store.updateContactIcp(session.caller.tenantId, contactId, {
		...(contact.icp ?? {
			encaje_empresa: null,
			rol_decisor: null,
			excluir: null,
			model: "",
			revision: "",
		}),
		lane: "descartado",
		reason: `manual: ${parsedReason.data}`,
		judged_at: new Date().toISOString(),
	});
	revalidatePath(`/${slug}/focos`);
	return { ok: true };
}
