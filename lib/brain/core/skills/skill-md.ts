// Arma el SKILL.md de una copia publicada (spec etapa 24.2a §5). Puro. Del
// frontmatter del brain solo salen los campos del formato Agent Skills.
import { parse, stringify } from "yaml";

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

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---/;

// El campo name del encabezado de un SKILL.md, o null si no hay o no se lee.
export function skillMdName(text: string): string | null {
	const match = HEADER.exec(text);
	if (!match) return null;
	try {
		const data: unknown = parse(match[1]);
		if (typeof data !== "object" || data === null || Array.isArray(data))
			return null;
		const name = (data as Record<string, unknown>).name;
		return typeof name === "string" ? name.trim() : null;
	} catch {
		return null;
	}
}

// Las claves de primer nivel del encabezado de un SKILL.md, o null si no hay
// encabezado o no se lee como un mapa YAML.
export function skillMdKeys(text: string): string[] | null {
	const match = HEADER.exec(text);
	if (!match) return null;
	try {
		const data: unknown = parse(match[1]);
		if (typeof data !== "object" || data === null || Array.isArray(data))
			return null;
		return Object.keys(data);
	} catch {
		return null;
	}
}
