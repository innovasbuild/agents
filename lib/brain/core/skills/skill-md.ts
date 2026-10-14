// Arma el SKILL.md de una copia publicada (spec etapa 24.2a §5). Puro. Del
// frontmatter del brain solo salen los campos del formato Agent Skills.
import { stringify } from "yaml";

export function renderSkillMd(input: {
	name: string;
	description: string;
	frontmatter: Record<string, unknown>;
	body: string;
}): string {
	const fields: Record<string, string> = {
		name: input.name,
		description: input.description,
	};
	for (const key of ["license", "compatibility"] as const) {
		const value = input.frontmatter[key];
		if (typeof value === "string" && value.trim()) fields[key] = value.trim();
	}
	// lineWidth 0: una descripción larga no se parte en varias líneas.
	return `---\n${stringify(fields, { lineWidth: 0 })}---\n\n${input.body}`;
}
