import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublishedFiles } from "@/components/brain/skills/published-files";
import {
	SkillPanel,
	type SkillPanelProps,
} from "@/components/brain/skills/skill-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/app/[tenant]/brain/skill-actions", () => ({
	getPublishPreview: vi.fn(),
	publishSkillAction: vi.fn(),
	republishSkillAction: vi.fn(),
	removeSkillFileAction: vi.fn(),
	withdrawSkillAction: vi.fn(),
}));

describe("PublishedFiles", () => {
	it("lista los archivos de la versión vigente con su link", () => {
		const html = renderToStaticMarkup(
			createElement(PublishedFiles, {
				tenantSlug: "acme",
				slug: "skills/facturacion",
				files: [
					{ path: "scripts/calc.py", sha256: "a", size: 2048 },
					{ path: "assets/logo.png", sha256: "b", size: 10 },
				],
			}),
		);
		expect(html).toContain("scripts/calc.py");
		expect(html).toContain("2 KB");
		expect(html).toContain(
			"/acme/brain/skills/files?slug=skills%2Ffacturacion&amp;path=scripts%2Fcalc.py",
		);
	});

	it("sin archivos no muestra nada", () => {
		expect(
			renderToStaticMarkup(
				createElement(PublishedFiles, {
					tenantSlug: "acme",
					slug: "skills/x",
					files: [],
				}),
			),
		).toBe("");
	});
});

describe("SkillPanel", () => {
	const props: SkillPanelProps = {
		tenantSlug: "acme",
		slug: "skills/facturacion",
		state: { kind: "publicada", version: 2, dirty: true },
		files: [{ path: "scripts/calc.py", sha256: "a", size: 10 }],
		versions: [
			{
				id: 2,
				action: "publicar",
				version: 2,
				note: "Ajuste de IVA",
				createdAt: "2026-10-01T10:00:00Z",
				republishedFrom: null,
			},
		],
		canPublish: true,
	};
	const render = (over: Partial<SkillPanelProps>) =>
		renderToStaticMarkup(createElement(SkillPanel, { ...props, ...over }));

	it("un administrador ve publicar, retirar y republicar", () => {
		const html = render({});
		expect(html).toContain("Publicada v2, con cambios sin publicar");
		expect(html).toContain("Revisar y publicar");
		expect(html).toContain("Retirar");
		expect(html).toContain("Republicar");
		expect(html).toContain("Ajuste de IVA");
	});

	it("un editor no ve controles de publicación ni republicar", () => {
		const html = render({ canPublish: false });
		expect(html).not.toContain("Revisar y publicar");
		expect(html).not.toContain(">Retirar<");
		expect(html).not.toContain("Republicar");
		expect(html).toContain("La publica un administrador");
		expect(html).toContain("Subir archivo");
	});

	it("publicada sin cambios no ofrece publicar de nuevo", () => {
		const html = render({
			state: { kind: "publicada", version: 2, dirty: false },
		});
		expect(html).not.toContain("Revisar y publicar");
		expect(html).toContain(">Retirar<");
	});

	it("retirada se puede volver a publicar y no se retira", () => {
		const html = render({ state: { kind: "retirada", version: 2 } });
		expect(html).toContain("Revisar y publicar");
		expect(html).not.toContain(">Retirar<");
	});
});
