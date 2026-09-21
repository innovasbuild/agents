// Import relativo: lo importan los hooks de eve (ver Global Constraints).
import { createAdminClient } from "../supabase/admin";

export interface OpenRunInput {
	tenantId: string;
	conversationId: string | null;
	agent: string;
	sessionId: string;
	turnId: string;
}

export interface CloseRunInput {
	sessionId: string;
	turnId: string;
	status: "ok" | "failed" | "cancelled";
	error?: string;
}

/**
 * Ata la sesión durable de eve a la conversación de la app. Es lo que permite
 * después validar ownership por `eve_session_id`. Si falla, tira: sin esta
 * fila nadie va a poder continuar la sesión, así que es mejor que el turno
 * falle ahora y el usuario reintente.
 */
export async function bindSessionToConversation(
	conversationId: string,
	sessionId: string,
): Promise<void> {
	if (!conversationId) {
		throw new Error(
			"session.started sin conversationId en los attributes del canal",
		);
	}

	const admin = createAdminClient();
	// Última escritura gana, a propósito: si el primer turno falló antes de
	// atar la sesión, el segundo intento crea otra sesión de eve y la
	// conversación tiene que quedar apuntando a esa, no a la muerta.
	const { data, error } = await admin
		.from("conversations")
		.update({
			eve_session_id: sessionId,
			last_message_at: new Date().toISOString(),
		})
		.eq("id", conversationId)
		.select("id")
		.maybeSingle();

	if (error || !data) {
		throw new Error(
			`No se pudo atar la sesión ${sessionId} a la conversación ${conversationId}`,
		);
	}
}

export async function openRun(input: OpenRunInput): Promise<void> {
	const admin = createAdminClient();
	const { error } = await admin.from("runs").insert({
		tenant_id: input.tenantId,
		agent: input.agent,
		trigger: "chat",
		eve_session_id: input.sessionId,
		eve_turn_id: input.turnId,
		conversation_id: input.conversationId,
		status: "running",
	});
	if (error) console.error("openRun:", error.message);
}

export async function closeRun(input: CloseRunInput): Promise<void> {
	const admin = createAdminClient();
	const { data, error } = await admin
		.from("runs")
		.update({
			status: input.status,
			error: input.error ?? null,
			finished_at: new Date().toISOString(),
		})
		.eq("eve_session_id", input.sessionId)
		.eq("eve_turn_id", input.turnId)
		.select("id")
		.maybeSingle();
	if (error) {
		console.error("closeRun:", error.message);
		return;
	}
	if (!data) return;
	// El total sale del libro de consumo (spec orquestación §7.2). Si falla, la
	// corrida queda cerrada igual y el costo se puede recalcular después.
	const { error: costError } = await admin.rpc("set_run_cost", {
		p_run: data.id,
	});
	if (costError) console.error("closeRun (costo):", costError.message);
}
