// @vitest-environment happy-dom
// Value: protects=mientras sube un lote de archivos sueltos no se puede reemplazar con un zip ni publicar, y con el diálogo del zip abierto no se suben sueltos; fails_when=el botón del zip, publicar, retirar o republicar quedan habilitados durante el lote, o los sueltos durante el zip; seam=none; no_claim=las rutas reales (fetch simulado, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillPanelProps } from "@/components/brain/skills/skill-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/app/[tenant]/brain/skill-actions", () => ({
	getPublishPreview: vi.fn(),
	publishSkillAction: vi.fn(),
	republishSkillAction: vi.fn(),
	removeSkillFileAction: vi.fn(),
	withdrawSkillAction: vi.fn(),
}));

const { SkillPanel } = await import("@/components/brain/skills/skill-panel");

const props: SkillPanelProps = {
	tenantSlug: "acme",
	slug: "skills/facturacion",
	state: { kind: "publicada", version: 2, dirty: true },
	files: [],
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

const fetchMock = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => root.render(createElement(SkillPanel, props)));
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

const button = (label: string) => {
	const found = [...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(label),
	);
	if (!found) throw new Error(`falta el botón ${label}`);
	return found;
};

describe("SkillPanel · una subida a la vez", () => {
	it("con el lote de sueltos en curso, el zip y publicar quedan deshabilitados", async () => {
		// El pedido del primer archivo no vuelve: el lote sigue en curso.
		fetchMock.mockReturnValue(new Promise(() => {}));
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="Elegir archivos"]',
		);
		if (!input) throw new Error("falta el campo de archivos");
		Object.defineProperty(input, "files", {
			value: [new File(["x"], "calc.py")],
			configurable: true,
		});
		await act(async () => {
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(document.body.textContent).toContain("Subiendo…");
		expect(button("Subir paquete (zip)…").disabled).toBe(true);
		expect(button("Revisar y publicar").disabled).toBe(true);
		expect(button("Retirar").disabled).toBe(true);
		expect(button("Republicar").disabled).toBe(true);
	});

	it("con el diálogo del zip abierto, los sueltos quedan deshabilitados", async () => {
		expect(button("Elegir archivos…").disabled).toBe(false);
		await act(async () => {
			button("Subir paquete (zip)…").click();
		});
		expect(button("Elegir archivos…").disabled).toBe(true);
		expect(button("Elegir carpeta…").disabled).toBe(true);
	});

	it("los tres botones de subida tienen un blanco táctil de 44 px en el teléfono", () => {
		for (const label of [
			"Elegir archivos…",
			"Elegir carpeta…",
			"Subir paquete (zip)…",
		]) {
			const classes = button(label).classList;
			expect(classes.contains("min-h-11")).toBe(true);
			expect(classes.contains("lg:min-h-0")).toBe(true);
		}
	});

	it("salir de la zona hacia un hijo no apaga el resaltado; salir afuera sí", async () => {
		const zone = button("Elegir archivos…").closest("div.border-dashed");
		if (!(zone instanceof HTMLElement)) throw new Error("falta la zona");
		const fire = (type: string, relatedTarget: EventTarget | null = null) =>
			act(async () => {
				zone.dispatchEvent(
					new MouseEvent(type, {
						bubbles: true,
						cancelable: true,
						relatedTarget,
					}),
				);
			});
		await fire("dragover");
		expect(zone.className).toContain("border-foreground");
		await fire("dragleave", button("Elegir archivos…"));
		expect(zone.className).toContain("border-foreground");
		await fire("dragleave", document.body);
		expect(zone.className).not.toContain("border-foreground");
	});
});
