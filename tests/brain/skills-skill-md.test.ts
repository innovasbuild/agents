import { describe, expect, it } from "vitest";
import { parseSkillMd } from "@/lib/brain/core/skills/files";
import {
	renderSkillMd,
	skillMdKeys,
	skillMdName,
} from "@/lib/brain/core/skills/skill-md";

describe("renderSkillMd", () => {
	it("arma frontmatter con name y description, y el cuerpo", () => {
		const md = renderSkillMd({
			name: "reporte",
			description: "Arma el reporte.",
			frontmatter: { description: "Arma el reporte.", otra: "no se exporta" },
			body: "# Pasos\n",
		});
		expect(md.startsWith("---\nname: reporte\n")).toBe(true);
		expect(md).not.toContain("otra");
		expect(parseSkillMd(md)).toEqual({
			description: "Arma el reporte.",
			compatibility: "",
			license: "",
			body: "# Pasos\n",
		});
	});

	it("incluye license y compatibility si están, y sobrevive a caracteres de YAML", () => {
		const description = 'Usar cuando: "x" o #y\nsegunda línea';
		const md = renderSkillMd({
			name: "a",
			description,
			frontmatter: { license: "MIT", compatibility: "Python 3: sí" },
			body: "cuerpo",
		});
		expect(parseSkillMd(md)).toEqual({
			description,
			compatibility: "Python 3: sí",
			license: "MIT",
			body: "cuerpo",
		});
	});
});

describe("skillMdName", () => {
	it("lee el campo name del encabezado", () => {
		expect(
			skillMdName("---\nname: reporte\ndescription: d\n---\n\ncuerpo"),
		).toBe("reporte");
	});

	it("devuelve null sin encabezado, sin name o con YAML roto", () => {
		expect(skillMdName("# Solo texto")).toBeNull();
		expect(skillMdName("---\ndescription: d\n---\n\ncuerpo")).toBeNull();
		expect(skillMdName("---\nname: [1, 2\n---\ncuerpo")).toBeNull();
		expect(skillMdName("---\n- lista\n---\ncuerpo")).toBeNull();
	});
});

describe("skillMdKeys", () => {
	it("lista las claves de primer nivel del encabezado", () => {
		expect(
			skillMdKeys(
				"---\nname: a\ndescription: d\nallowed-tools: Bash\nmetadata:\n  x: 1\n---\n\ncuerpo",
			),
		).toEqual(["name", "description", "allowed-tools", "metadata"]);
	});

	it("devuelve null sin encabezado, con YAML roto o si no es un mapa", () => {
		expect(skillMdKeys("# Solo texto")).toBeNull();
		expect(skillMdKeys("---\nname: [1, 2\n---\ncuerpo")).toBeNull();
		expect(skillMdKeys("---\n- lista\n---\ncuerpo")).toBeNull();
	});
});
