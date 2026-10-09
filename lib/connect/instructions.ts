// Pasos para conectar una URL de MCP desde cada cliente (spec etapa 19 §3.2).
// Los pasos salen de la documentación pública de cada cliente al 2026-10-09.
// `tested` dice si alguien lo probó contra esta plataforma en producción.

export const CLIENTS = [
	"claude-code",
	"claude-ai",
	"chatgpt",
	"codex",
	"cursor",
] as const;

export type ClientKey = (typeof CLIENTS)[number];

export const CLIENT_LABELS: Record<ClientKey, string> = {
	"claude-code": "Claude Code",
	"claude-ai": "claude.ai",
	chatgpt: "ChatGPT",
	codex: "Codex",
	cursor: "Cursor",
};

export interface Instructions {
	tested: boolean;
	steps: string[];
	snippet?: { language: "bash" | "json"; code: string };
}

// Dentro de comillas dobles, la shell todavía interpreta \ " $ y `.
function shellQuote(value: string): string {
	return `"${value.replace(/[\\"$`]/g, "\\$&")}"`;
}

const LOGIN =
	"Se abre el navegador: entrá con tu cuenta de la plataforma y aprobá el acceso.";

export function instructionsFor(
	client: ClientKey,
	target: { id: string; url: string },
): Instructions {
	const { id, url } = target;

	switch (client) {
		case "claude-code":
			return {
				tested: true,
				steps: [
					"Corré este comando en tu terminal.",
					`Dentro de Claude Code, escribí /mcp, elegí ${id} y autenticá.`,
					LOGIN,
				],
				snippet: {
					language: "bash",
					code: `claude mcp add --transport http ${id} ${shellQuote(url)}`,
				},
			};
		case "claude-ai":
			return {
				tested: false,
				steps: [
					"Abrí Configuración y entrá a Conectores.",
					"Elegí Agregar conector personalizado y pegá la URL de arriba.",
					"Guardá y apretá Conectar.",
					LOGIN,
					"En planes Team y Enterprise, primero lo agrega un dueño de la organización y después cada persona se conecta.",
				],
			};
		case "chatgpt":
			return {
				tested: false,
				steps: [
					"Abrí Configuración y entrá a Conectores (puede figurar como Apps).",
					"En Ajustes avanzados, activá el Modo desarrollador.",
					"Volvé a Conectores, elegí Crear y pegá la URL de arriba.",
					"En autenticación elegí OAuth, confirmá que confiás en la aplicación y creala.",
					LOGIN,
					"Hace falta un plan con Modo desarrollador. En un espacio de trabajo, lo tiene que habilitar un administrador.",
				],
			};
		case "codex":
			return {
				tested: false,
				steps: ["Corré estos dos comandos en tu terminal.", LOGIN],
				snippet: {
					language: "bash",
					code: `codex mcp add ${id} --url ${shellQuote(url)}\ncodex mcp login ${id}`,
				},
			};
		case "cursor":
			return {
				tested: false,
				steps: [
					"Agregá esto a ~/.cursor/mcp.json (o a .cursor/mcp.json del proyecto).",
					"Al primer uso, Cursor abre el navegador: entrá con tu cuenta de la plataforma y aprobá el acceso.",
					"Abrí un chat nuevo del agente para que vea las herramientas.",
				],
				snippet: {
					language: "json",
					code: JSON.stringify({ mcpServers: { [id]: { url } } }, null, 2),
				},
			};
	}
}
