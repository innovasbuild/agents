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
			{ id: "yes", label: "Sí, enviar", style: undefined },
			{ id: "no", label: "No, cambiar algo", style: undefined },
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

	it("habilita texto libre en una pregunta sin opciones aunque no lo pida", () => {
		// ask_question acepta solo prompt: sin esto la tarjeta no tendría
		// ninguna forma de responder.
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"ask_question",
					{},
					{
						kind: "question",
						requestId: "q5",
						prompt: "¿Qué asunto le pongo?",
					},
				),
			),
		);

		expect(request.options).toEqual([]);
		expect(request.allowFreeform).toBe(true);
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
			{ id: "approve", label: "Aprobar", style: "primary" },
			{ id: "cancel", label: "Rechazar", style: undefined },
		]);
		expect(request.allowFreeform).toBe(false);
	});

	it("ignora partes que no están esperando respuesta", () => {
		const done = {
			...toolPart("send_email", {}, { kind: "tool-approval", requestId: "a2" }),
			state: "output-available",
		};
		expect(pendingInputRequests(messages(done))).toEqual([]);
	});

	it("ignora partes que no son de tools", () => {
		const text = { type: "text", text: "hola", state: "approval-requested" };
		expect(pendingInputRequests(messages(text))).toEqual([]);
	});

	it("ignora tools esperando respuesta sin inputRequest de eve", () => {
		const { toolMetadata: _, ...withoutMetadata } = toolPart(
			"send_email",
			{},
			{},
		);
		expect(pendingInputRequests(messages(withoutMetadata))).toEqual([]);
	});

	it("conserva la etiqueta original de una opción de aprobación desconocida", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"send_email",
					{},
					{
						kind: "tool-approval",
						requestId: "a3",
						prompt: "Approve tool call: send_email",
						options: [
							{ id: "approve", label: "Approve" },
							{ id: "approve-always", label: "Always approve" },
						],
					},
				),
			),
		);

		expect(request.options).toEqual([
			{ id: "approve", label: "Aprobar", style: "primary" },
			{ id: "approve-always", label: "Always approve", style: undefined },
		]);
	});

	it("no traduce las etiquetas de una pregunta aunque use ids approve/cancel", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"ask_question",
					{},
					{
						kind: "question",
						requestId: "q3",
						prompt: "¿Seguimos?",
						options: [
							{ id: "approve", label: "Dale" },
							{ id: "cancel", label: "Mejor no" },
						],
					},
				),
			),
		);

		expect(request.options).toEqual([
			{ id: "approve", label: "Dale", style: undefined },
			{ id: "cancel", label: "Mejor no", style: undefined },
		]);
	});

	it("junta los pedidos de varios mensajes y partes en orden", () => {
		const question = toolPart(
			"ask_question",
			{},
			{ kind: "question", requestId: "q4", prompt: "¿A quién?" },
		);
		const approval = toolPart(
			"send_email",
			{},
			{ kind: "tool-approval", requestId: "a4", prompt: "Approve" },
		);
		const conversation = [
			{ id: "m1", role: "assistant", parts: [{ type: "text", text: "hola" }] },
			{ id: "m2", role: "assistant", parts: [question, approval] },
			{
				id: "m3",
				role: "assistant",
				parts: [{ ...approval, state: "output-available" }],
			},
		] as unknown as EveMessage[];

		expect(
			pendingInputRequests(conversation).map(({ requestId }) => requestId),
		).toEqual(["q4", "a4"]);
	});

	it("no ofrece texto libre en una aprobación, aunque venga sin opciones", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"send_email",
					{},
					{ kind: "tool-approval", requestId: "a5", prompt: "Approve" },
				),
			),
		);

		expect(request.allowFreeform).toBe(false);
	});

	it("traduce las opciones del límite de sesión y conserva su style", () => {
		const [request] = pendingInputRequests(
			messages(
				toolPart(
					"session_limit",
					{},
					{
						kind: "session-limit",
						requestId: "s1",
						prompt: "Se terminó el presupuesto",
						options: [
							{ id: "continue", label: "Approve", style: "primary" },
							{ id: "stop", label: "Stop", style: "danger" },
						],
					},
				),
			),
		);

		expect(request.options).toEqual([
			{ id: "continue", label: "Seguir con más presupuesto", style: "primary" },
			{ id: "stop", label: "Frenar acá", style: "danger" },
		]);
	});
});
