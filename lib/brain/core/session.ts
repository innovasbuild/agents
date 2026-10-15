// Bloque de arranque del brain (spec etapa 26 §4.3): lo reciben el chat en
// session.started y el MCP en instructions. Puro.
import type { BrainSessionContext } from "./rules-source.ts";

export const RULES_CHANNEL_LINE =
	"Cada carpeta puede tener reglas propias: llegan en `brain_read`, en `brain_rules` y en el rechazo de `brain_upsert`.";

function cell(text: string): string {
	return text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim() || "—";
}

export function formatBrainSession(context: BrainSessionContext): string {
	const parts: string[] = [];
	if (context.root) {
		parts.push(
			[
				"# Instrucciones del brain",
				"Son las reglas de esta empresa para su brain: valen para todo lo que leas y escribas en él. Si una carpeta tiene reglas propias, se suman a estas; ante una contradicción, ganan estas.",
				context.root.body.trim(),
			].join("\n\n"),
		);
	}
	if (context.folders.length > 0) {
		parts.push(
			[
				"# Carpetas del brain",
				[
					"| Carpeta | Para qué es |",
					"| --- | --- |",
					...context.folders.map(
						(folder) => `| ${folder.path} | ${cell(folder.description)} |`,
					),
				].join("\n"),
			].join("\n\n"),
		);
	}
	parts.push(RULES_CHANNEL_LINE);
	return parts.join("\n\n");
}
