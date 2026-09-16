import type { EveMessage, EveMessagePart } from "eve/client";
import { describe, expect, it } from "vitest";
import { runningToolLabel, runningToolName } from "@/lib/agents/running-tool";

type ToolPart = Extract<EveMessagePart, { type: "dynamic-tool" }>;
type ToolState = ToolPart["state"];

// Forma real de los parts de eve 0.54.2 (client/message-reducer-types.d.ts):
// `state` avanza input-streaming → input-available → approval-* → output-*.
// El state va tipado contra eve a propósito: si un upgrade renombra uno, esto
// tiene que romper en typecheck y no seguir verde mientras el indicador muere.
function toolPart(toolName: string, state: ToolState) {
	return { type: "dynamic-tool", state, toolName, toolCallId: `c-${toolName}` };
}

function textPart(text: string) {
	return { type: "text", state: "done", stepIndex: 0, text };
}

function messages(...byMessage: unknown[][]): EveMessage[] {
	return byMessage.map((parts, index) => ({
		id: `m${index}`,
		role: "assistant",
		parts,
	})) as unknown as EveMessage[];
}

describe("runningToolName", () => {
	it("devuelve el tool cuyos argumentos ya están completos", () => {
		expect(
			runningToolName(
				messages([toolPart("research_account", "input-available")]),
			),
		).toBe("research_account");
	});

	it("sigue mostrando el tool después de que se respondió su aprobación", () => {
		// Entre aprobar y el resultado hay un hueco largo: send_email sale a
		// Gmail. Sin esto el indicador se apagaría justo en la espera real.
		expect(
			runningToolName(messages([toolPart("send_email", "approval-responded")])),
		).toBe("send_email");
	});

	it("devuelve null cuando el tool ya entregó resultado", () => {
		expect(
			runningToolName(messages([toolPart("list_queue", "output-available")])),
		).toBeNull();
	});

	it("devuelve null con una aprobación pendiente: ahí manda la tarjeta", () => {
		expect(
			runningToolName(messages([toolPart("send_email", "approval-requested")])),
		).toBeNull();
	});

	it("devuelve null si el turno no tocó ningún tool", () => {
		expect(runningToolName(messages([textPart("Listo, ya está.")]))).toBeNull();
	});

	it("cruza mensajes y se queda con el último part de tool", () => {
		// El tool viejo terminó en un mensaje anterior; el que manda es el
		// último despachado, no el primero que aparece.
		expect(
			runningToolName(
				messages(
					[toolPart("list_queue", "output-available")],
					[
						textPart("Voy a buscar la cuenta."),
						toolPart("research_account", "input-available"),
					],
				),
			),
		).toBe("research_account");
	});

	it("con dos tools en el mismo mensaje, el último terminal apaga el indicador", () => {
		expect(
			runningToolName(
				messages([
					toolPart("research_account", "input-available"),
					toolPart("list_queue", "output-available"),
				]),
			),
		).toBeNull();
	});

	it("devuelve null sin mensajes", () => {
		expect(runningToolName([])).toBeNull();
	});

	it.each<ToolState>(["input-streaming", "output-error", "output-denied"])(
		"devuelve null en estado %s",
		(state) => {
			expect(
				runningToolName(messages([toolPart("send_email", state)])),
			).toBeNull();
		},
	);
});

describe("runningToolLabel", () => {
	it("traduce el tool a castellano", () => {
		expect(runningToolLabel("research_account")).toBe("Investigando la cuenta");
	});

	it("nunca deja escapar el identificador crudo", () => {
		// La UI va en rioplatense: un tool nuevo sin etiqueta cae en el genérico
		// en vez de mostrar "spike_gmail_readonly" en pantalla.
		expect(runningToolLabel("spike_gmail_readonly")).toBe("Trabajando");
	});
});
