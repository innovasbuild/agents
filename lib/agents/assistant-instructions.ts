// Contexto de la sesión del agente Asistente (spec 22.1 §4.2). Puro: quien
// llama le pasa lo que leyó. Sin imports con "@/": lo usa agents/asistente.
export interface AssistantSessionInput {
	tenantName: string;
	tenantSlug: string;
	brainConnected: boolean;
	/** Los demás agentes de chat habilitados en la empresa. */
	otherAgents: ReadonlyArray<{ name: string; description: string }>;
}

export function assistantSessionInstructions(
	input: AssistantSessionInput,
): string {
	const lines = [
		`Trabajás para ${input.tenantName} (tenant \`${input.tenantSlug}\`). Todo lo que hagas es en nombre de esa empresa y con sus datos.`,
	];

	if (!input.brainConnected) {
		lines.push(
			"Esta empresa no tiene un brain conectado en este momento. Si te preguntan algo de la empresa, decí que no tenés de dónde leerlo y que un administrador tiene que conectar el brain.",
		);
	}

	if (input.otherAgents.length > 0) {
		lines.push(
			"En esta empresa hay otros agentes habilitados:",
			...input.otherAgents.map(
				(agent) => `- ${agent.name}: ${agent.description}`,
			),
			"Si te piden algo de esto, decí que lo hace ese agente, nombrándolo, y que abran un hilo nuevo eligiéndolo en el selector Agente. No lo intentes vos.",
		);
	} else {
		lines.push(
			"No hay otros agentes habilitados en esta empresa. Si te piden enviar mails, operar el CRM o algo fuera del brain, decí que no está disponible.",
		);
	}

	return lines.join("\n\n");
}
