import type { EveMessage, EveMessageInputRequest } from "eve/client";

export interface PendingInputRequest {
	requestId: string;
	kind: EveMessageInputRequest["kind"];
	toolName: string;
	input: Record<string, unknown>;
	prompt: string;
	options: {
		id: string;
		label: string;
		style?: "primary" | "danger" | "default";
	}[];
	allowFreeform: boolean;
}

// Solo se traducen las etiquetas de eve: los ids son los que eve espera de
// vuelta. Las de las preguntas (ctx.ask) las escribe la tool y quedan como vienen.
const FRAMEWORK_LABELS: Partial<
	Record<EveMessageInputRequest["kind"], Record<string, string>>
> = {
	"tool-approval": { approve: "Aprobar", cancel: "Rechazar" },
	"session-limit": {
		continue: "Seguir con más presupuesto",
		stop: "Frenar acá",
	},
};

/**
 * Pedidos de input pendientes (aprobaciones de tools, preguntas de workflow
 * tools con ctx.ask, límites de sesión). La respuesta tiene que usar un `id`
 * de `options` o `text`.
 */
export function pendingInputRequests(
	messages: readonly EveMessage[],
): PendingInputRequest[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "dynamic-tool" || part.state !== "approval-requested")
				return [];
			const request = part.toolMetadata?.eve?.inputRequest;
			if (!request) return [];
			const isApproval = request.kind === "tool-approval";
			const options = (request.options ?? []).map(({ id, label, style }) => ({
				id,
				label: FRAMEWORK_LABELS[request.kind]?.[id] ?? label,
				// Las aprobaciones de eve no traen style: se destaca "approve".
				style:
					style ?? (isApproval && id === "approve" ? "primary" : undefined),
			}));
			return [
				{
					requestId: request.requestId,
					kind: request.kind,
					toolName: part.toolName,
					input: part.input as Record<string, unknown>,
					prompt: request.prompt,
					options,
					// Una pregunta sin opciones solo se responde con texto (eve la trata
					// igual en channel/resolve-text.js). Una aprobación nunca: eve toma
					// cualquier respuesta que no sea "approve" como inválida.
					allowFreeform:
						!isApproval &&
						(request.allowFreeform === true || options.length === 0),
				},
			];
		}),
	);
}

/**
 * Motivo por el que la política de aprobación de la tool rechazó la respuesta,
 * por requestId. eve deja la tarjeta pendiente y su reducer ignora el evento
 * `approval.candidate`, así que sin esto el botón parece no hacer nada. Si
 * después alguien la aprueba, `approval.settled` saca el pedido de pendientes y
 * el motivo deja de mostrarse solo.
 */
export function approvalRefusals(
	events: readonly { type: string; data?: unknown }[],
): Map<string, string> {
	const refusals = new Map<string, string>();
	for (const event of events) {
		if (event.type !== "approval.candidate") continue;
		const data = event.data as {
			outcome?: string;
			requestId?: string;
			reason?: string;
		};
		if (data.outcome === "rejected" && data.requestId) {
			refusals.set(
				data.requestId,
				data.reason ?? "No tenés permiso para aprobar esto.",
			);
		}
	}
	return refusals;
}
