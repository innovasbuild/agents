// Qué puede conectar una persona a su cliente MCP (spec etapa 19 §3.1).
// Función pura: la página le pasa lo que leyó de la base.

export type Connectable =
	| {
			kind: "brain";
			id: string;
			name: string;
			description: string;
			url: string;
	  }
	| {
			kind: "agent";
			agent: string;
			id: string;
			name: string;
			description: string;
			url: string;
	  }
	| { kind: "tools"; name: string; description: string; soon: true };

// Provisorio hasta el catálogo de agentes de la Etapa 22 (spec C5).
const AGENT_COPY: Record<string, { name: string; description: string }> = {
	outreach: {
		name: "Agente de outreach",
		description:
			"Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa.",
	},
};

// Identificador para comandos de terminal y claves de JSON: sin espacios,
// comillas ni mayúsculas, venga lo que venga de tenant_agents.agent.
function commandId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function buildConnectables(input: {
	slug: string;
	publicUrl: string;
	hasBrain: boolean;
	enabledAgents: string[];
}): Connectable[] {
	const origin = input.publicUrl.replace(/\/+$/, "");
	const slug = encodeURIComponent(input.slug);
	const list: Connectable[] = [];

	if (input.hasBrain) {
		list.push({
			kind: "brain",
			id: `brain-${commandId(input.slug)}`,
			name: "Brain",
			description:
				"El conocimiento de tu empresa: buscar, leer y escribir páginas según tus permisos.",
			url: `${origin}/brain/${slug}/mcp`,
		});
	}

	for (const agent of input.enabledAgents) {
		const copy = AGENT_COPY[agent] ?? {
			name: agent,
			description: "Agente de tu empresa.",
		};
		list.push({
			kind: "agent",
			agent,
			id: `${commandId(agent)}-${commandId(input.slug)}`,
			name: copy.name,
			description: copy.description,
			url: `${origin}/eve/${encodeURIComponent(agent)}/v1/mcp?tenant=${slug}`,
		});
	}

	list.push({
		kind: "tools",
		name: "Herramientas de tu empresa",
		description:
			"Próximamente: las herramientas de tu empresa (CRM, búsqueda de contactos) desde tu propio Claude o ChatGPT.",
		soon: true,
	});

	return list;
}
