import type { EveMessage, EveMessageInputRequest } from "eve/client";

export interface PendingInputRequest {
	requestId: string;
	kind: EveMessageInputRequest["kind"];
	toolName: string;
	input: Record<string, unknown>;
	prompt: string;
	options: { id: string; label: string }[];
	allowFreeform: boolean;
}

// Solo se traducen las etiquetas: los ids son los que eve espera de vuelta.
const APPROVAL_LABELS: Record<string, string> = {
	approve: "Aprobar",
	cancel: "Rechazar",
};

/**
 * Pedidos de input pendientes (aprobaciones de tools, ask_question, límites
 * de sesión). La respuesta tiene que usar un `id` de `options` o `text`: eve
 * no valida la respuesta de una pregunta contra sus opciones y se la pasa tal
 * cual al modelo (harness/hitl/question-input-requests.js).
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
			const options = (request.options ?? []).map(({ id, label }) => ({
				id,
				label: (isApproval && APPROVAL_LABELS[id]) || label,
			}));
			return [
				{
					requestId: request.requestId,
					kind: request.kind,
					toolName: part.toolName,
					input: part.input as Record<string, unknown>,
					prompt: request.prompt,
					options,
					// Sin opciones, el texto es la única forma de responder.
					allowFreeform: request.allowFreeform === true || options.length === 0,
				},
			];
		}),
	);
}
