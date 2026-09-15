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
// vuelta. Las de ask_question las escribe el modelo y quedan como vienen.
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
