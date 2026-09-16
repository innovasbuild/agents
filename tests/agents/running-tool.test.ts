import { readdirSync } from "node:fs";
import type { EveMessage, EveMessagePart } from "eve/client";
import { describe, expect, it } from "vitest";
import {
	runningToolLabel,
	runningToolName,
	TOOLS_SIN_ETIQUETA,
	thinkingLabel,
} from "@/lib/agents/running-tool";

type ToolPart = Extract<EveMessagePart, { type: "dynamic-tool" }>;
type ToolState = ToolPart["state"];

// Forma real de los parts de eve 0.54.2 (client/message-reducer-types.d.ts):
// `state` avanza input-streaming → input-available → approval-* → output-*.
// El state va tipado contra eve a propósito: si un upgrade renombra uno, esto
// tiene que romper en typecheck y no seguir verde mientras el indicador muere.
function toolPart(toolName: string, state: ToolState) {
	return { type: "dynamic-tool", state, toolName, toolCallId: `c-${toolName}` };
}

function textPart(text: string, state: "done" | "streaming" = "done") {
	return { type: "text", state, stepIndex: 0, text };
}

function messages(...byMessage: unknown[][]): EveMessage[] {
	return byMessage.map((parts, index) => ({
		id: `m${index}`,
		role: "assistant",
		parts,
	})) as unknown as EveMessage[];
}

function userMessage(text: string): EveMessage {
	return {
		id: "u1",
		role: "user",
		parts: [textPart(text)],
	} as unknown as EveMessage;
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

	it("sigue buscando hacia atrás si el último mensaje no tocó ningún tool", () => {
		// Con un follow-up del usuario el último elemento del array no tiene
		// parts de tool. El indicador no puede apagarse por eso: es justo lo
		// único que hace el loop de afuera.
		const list = [
			...messages([toolPart("send_email", "input-available")]),
			userMessage("dale"),
		];

		expect(runningToolName(list)).toBe("send_email");
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
		// en vez de mostrar "tool_que_no_existe_todavia" en pantalla.
		expect(runningToolLabel("tool_que_no_existe_todavia")).toBe("Trabajando");
	});

	it.each(["constructor", "toString", "hasOwnProperty", "valueOf"])(
		"no devuelve nada heredado del prototipo para %s",
		(key) => {
			// Con un objeto literal y `??`, TOOL_LABELS["constructor"] devuelve la
			// función Object y la pantalla mostraba "function Object() {…}…".
			expect(runningToolLabel(key)).toBe("Trabajando");
		},
	);

	it("todo tool de outreach tiene etiqueta, salvo los excluidos a propósito", () => {
		// La tabla es a mano: sin esto, un tool nuevo degradaba en silencio a
		// "Trabajando…" y nadie se enteraba hasta verlo en pantalla.
		const sinEtiqueta = readdirSync("agents/outreach/tools")
			.filter((file) => file.endsWith(".ts"))
			.map((file) => file.replace(/\.ts$/, ""))
			.filter((name) => !TOOLS_SIN_ETIQUETA.has(name))
			.filter((name) => runningToolLabel(name) === "Trabajando");

		expect(sinEtiqueta).toEqual([]);
	});
});

describe("thinkingLabel", () => {
	const base = {
		messages: [] as EveMessage[],
		status: "ready",
		isResuming: false,
		isAuthorizing: false,
		pendingRequestCount: 0,
	};

	it("calla con una tarjeta de aprobación abierta", () => {
		expect(
			thinkingLabel({ ...base, status: "streaming", isAuthorizing: true }),
		).toBeNull();
		expect(
			thinkingLabel({ ...base, status: "streaming", pendingRequestCount: 1 }),
		).toBeNull();
	});

	it("reanudar le gana al nombre del tool", () => {
		expect(
			thinkingLabel({
				...base,
				isResuming: true,
				messages: messages([toolPart("send_email", "input-available")]),
			}),
		).toBe("Reanudando el hilo…");
	});

	it("nombra en castellano el tool en curso", () => {
		expect(
			thinkingLabel({
				...base,
				status: "streaming",
				messages: messages([toolPart("research_account", "input-available")]),
			}),
		).toBe("Investigando la cuenta…");
	});

	it("dice Pensando… apenas se manda el mensaje", () => {
		expect(thinkingLabel({ ...base, status: "submitted" })).toBe("Pensando…");
	});

	it("sigue diciendo Pensando… mientras llegan los argumentos de un tool", () => {
		// input-streaming no da un toolName confiable todavía, pero en pantalla
		// no hay NADA: apagar el indicador acá se lee como que se colgó.
		expect(
			thinkingLabel({
				...base,
				status: "streaming",
				messages: messages([toolPart("draft_message", "input-streaming")]),
			}),
		).toBe("Pensando…");
	});

	it("se apaga mientras el texto se está escribiendo: el texto es el indicador", () => {
		expect(
			thinkingLabel({
				...base,
				status: "streaming",
				messages: messages([textPart("Ya te armo la lista", "streaming")]),
			}),
		).toBeNull();
	});

	it("vuelve a Pensando… en el tool que viene DESPUÉS de una frase terminada", () => {
		// Todos los pasos de un turno viven en el mismo mensaje. Mirar si el
		// texto existe apagaba el indicador en cada tool posterior a la primera
		// frase, que es la forma normal de un turno de este agente.
		expect(
			thinkingLabel({
				...base,
				status: "streaming",
				messages: messages([
					textPart("Voy a mirar la cuenta.", "done"),
					toolPart("research_account", "input-streaming"),
				]),
			}),
		).toBe("Pensando…");
	});

	it("no muestra nada con el turno terminado", () => {
		expect(
			thinkingLabel({
				...base,
				status: "ready",
				messages: messages([textPart("Listo.")]),
			}),
		).toBeNull();
	});
});
