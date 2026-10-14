import { describe, expect, it } from "vitest";
import { parseSkillMd } from "@/lib/brain/core/skills/files";
import { renderSkillMd } from "@/lib/brain/core/skills/skill-md";

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
