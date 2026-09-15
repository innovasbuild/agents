import type { EveMessage } from "eve/client";
import { describe, expect, it } from "vitest";
import { pendingInputRequests } from "@/lib/agents/input-requests";

// Forma real de los pedidos de eve 0.54.2: approval-input-requests.js arma
// las opciones approve/cancel; ask_question trae las que eligió el modelo.
function toolPart(
	toolName: string,
	input: unknown,
	inputRequest: Record<string, unknown>,
) {
	return {
		type: "dynamic-tool",
		state: "approval-requested",
		toolName,
		toolCallId: `call-${toolName}`,
		input,
		toolMetadata: { eve: { kind: "tool-call", name: toolName, inputRequest } },
	};
}

function messages(...parts: unknown[]): EveMessage[] {
	return [{ id: "m1", role: "assistant", parts }] as unknown as EveMessage[];
}

describe("pendingInputRequests", () => {
	it("responde un ask_question con los ids de sus opciones, no con approve", () => {
		// Caso de producción del 2026-09-15: el chat mandaba optionId
		// "approve" a esta pregunta y eve se lo pasaba tal cual al modelo.
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"ask_question",
					{},
					{
						kind: "question",
						requestId: "q1",
						prompt: "¿Confirmás el envío del mail?",
						options: [
							{ id: "yes", label: "Sí, enviar" },
							{ id: "no", label: "No, cambiar algo" },
						],
					},
				),
			),
		);

		expect(request).toMatchObject({
			kind: "question",
			requestId: "q1",
			prompt: "¿Confirmás el envío del mail?",
			allowFreeform: false,
		});
		expect(request.options).toEqual([
			{ id: "yes", label: "Sí, enviar" },
			{ id: "no", label: "No, cambiar algo" },
		]);
	});

	it("respeta allowFreeform de la pregunta", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"ask_question",
					{},
					{
						kind: "question",
						requestId: "q2",
						prompt: "¿A quién se lo mando?",
						allowFreeform: true,
					},
				),
			),
		);

		expect(request.allowFreeform).toBe(true);
		expect(request.options).toEqual([]);
	});

	it("traduce las opciones de una aprobación de tool y conserva sus ids", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"send_email",
					{ to: "it@innov.as", subject: "Prueba", body: "hola" },
					{
						kind: "tool-approval",
						requestId: "a1",
						prompt: "Approve tool call: send_email",
						options: [
							{ id: "approve", label: "Approve" },
							{ id: "cancel", label: "Cancel" },
						],
					},
				),
			),
		);

		expect(request).toMatchObject({
			kind: "tool-approval",
			toolName: "send_email",
			input: { to: "it@innov.as", subject: "Prueba", body: "hola" },
		});
		expect(request.options).toEqual([
			{ id: "approve", label: "Aprobar" },
			{ id: "cancel", label: "Rechazar" },
		]);
	});

	it("ignora partes que no están esperando respuesta", () => {
		const done = {
			...toolPart("send_email", {}, { kind: "tool-approval", requestId: "a2" }),
			state: "output-available",
		};
		expect(pendingInputRequests(messages(done))).toEqual([]);
	});
});
