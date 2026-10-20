// @vitest-environment happy-dom
// Value: protects=la subida de una skill muestra la vista previa antes de escribir, manda el mismo zip dos veces y no deja confirmar un paquete con problemas; fails_when=un zip de más de 4 MB llega al servidor, se confirma sin vista previa o los problemas se muestran de a uno; seam=none; no_claim=la ruta real (fetch simulado, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadTarget } from "@/lib/brain/core/skills/upload";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { UploadDialog } = await import(
	"@/components/brain/skills/upload-dialog"
);

const fetchMock = vi.fn();
let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	fetchMock.mockReset();
	refresh.mockReset();
	onClose.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

const reply = (body: unknown, status = 200) =>
	Promise.resolve(new Response(JSON.stringify(body), { status }));

const preview = (over: Record<string, unknown> = {}) => ({
	ok: true,
	mode: "crear",
	slug: "skills/ventas/cotizar",
	name: "cotizar",
	description: "Arma cotizaciones.",
	files: [
		{ path: "SKILL.md", size: 1200 },
		{ path: "scripts/calc.py", size: 2048 },
	],
	totalBytes: 3248,
	warnings: [],
	...over,
});

function open(target: UploadTarget) {
	act(() => {
		root.render(
			createElement(UploadDialog, {
				tenantSlug: "acme",
				target,
				onClose,
			}),
		);
	});
}

// Como el navegador: elegir la misma ruta otra vez no dispara `change` salvo
// que el campo se haya vaciado (value = "").
async function pick(file: File) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("falta el campo del archivo");
	if (!Object.hasOwn(input, "selectedPath")) {
		let path = "";
		Object.defineProperty(input, "selectedPath", { value: true });
		Object.defineProperty(input, "value", {
			get: () => path,
			set: (next: string) => {
				path = String(next);
			},
			configurable: true,
		});
	}
	if (input.value === file.name) return;
	input.value = file.name;
	Object.defineProperty(input, "files", { value: [file], configurable: true });
	await act(async () => {
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

const button = (label: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(label),
	);
const text = () => document.body.textContent ?? "";
const zip = (name = "cotizar.zip", size = 10) =>
	new File([new Uint8Array(size)], name);

async function click(label: string) {
	const target = button(label);
	if (!target) throw new Error(`falta el botón ${label}`);
	await act(async () => {
		target.click();
	});
}

describe("UploadDialog", () => {
	it("rechaza en el cliente un zip de más de 4 MB, sin hacer el pedido", async () => {
		open({ kind: "folder", folder: "ventas" });
		await pick(zip("grande.zip", 4_194_305));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"El zip supera los 4 MB.",
		);
	});

	it("Cancelar cierra sin pedir nada", async () => {
		open({ kind: "folder", folder: "ventas" });
		await click("Cancelar");
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rechaza un archivo que no es .zip, sin hacer el pedido", async () => {
		open({ kind: "folder", folder: "ventas" });
		await pick(zip("notas.txt"));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"Elegí un archivo .zip.",
		);
	});

	it("muestra la vista previa y recién al confirmar escribe, con el mismo zip", async () => {
		fetchMock.mockReturnValueOnce(reply(preview())).mockReturnValueOnce(
			reply({
				ok: true,
				mode: "crear",
				slug: "skills/ventas/cotizar",
				name: "cotizar",
				files: 2,
				revision: 1,
			}),
		);
		open({ kind: "folder", folder: "ventas" });
		const file = zip();
		await pick(file);

		expect(text()).toContain("cotizar");
		expect(text()).toContain("Arma cotizaciones.");
		expect(text()).toContain("2 archivos · 3 KB");
		expect(text()).toContain("Crea una skill nueva");
		// El campo se vacía al elegir: el nombre y el peso dicen qué zip es.
		expect(text()).toContain("cotizar.zip · 10 B");
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await click("Crear la skill");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [first, second] = fetchMock.mock.calls.map(
			([url, init]) => [url, init.body as FormData] as const,
		);
		expect(first[0]).toBe("/acme/brain/skills/upload");
		expect(first[1].get("action")).toBe("preview");
		expect(second[1].get("action")).toBe("confirm");
		expect(first[1].get("file")).toBe(second[1].get("file"));
		expect(second[1].get("folder")).toBe("ventas");
		expect(second[1].has("slug")).toBe(false);
		// Lo que mostró la vista previa: si cambió, el servidor no escribe.
		expect(first[1].has("expectedMode")).toBe(false);
		expect(second[1].get("expectedMode")).toBe("crear");
		expect(second[1].get("expectedSlug")).toBe("skills/ventas/cotizar");
		expect(refresh).toHaveBeenCalled();
		expect(text()).toContain("Quedó en borrador");
		expect(
			document.querySelector("a[href='/acme/brain/p/skills/ventas/cotizar']")
				?.textContent,
		).toBe("Abrir la skill");
	});

	it("directo bajo skills/ manda la carpeta vacía", async () => {
		fetchMock.mockReturnValueOnce(reply(preview()));
		open({ kind: "folder", folder: "" });
		await pick(zip());
		const body = fetchMock.mock.calls[0][1].body as FormData;
		expect(body.get("folder")).toBe("");
		expect(body.has("slug")).toBe(false);
	});

	it("desde el panel manda la skill y avisa que reemplaza el borrador", async () => {
		fetchMock.mockReturnValueOnce(
			reply(
				preview({
					mode: "reemplazar",
					slug: "skills/ventas/cotizar",
					warnings: ["El name del SKILL.md es «otra»."],
				}),
			),
		);
		open({ kind: "skill", slug: "skills/ventas/cotizar" });
		await pick(zip());
		const body = fetchMock.mock.calls[0][1].body as FormData;
		expect(body.get("slug")).toBe("skills/ventas/cotizar");
		expect(body.has("folder")).toBe(false);
		expect(text()).toContain("Reemplaza el borrador de skills/ventas/cotizar");
		expect(text()).toContain("cambia el texto y los archivos del borrador");
		expect(text()).toContain("El name del SKILL.md es «otra».");
		expect(button("Reemplazar el borrador")?.disabled).toBe(false);
	});

	it("con problemas los lista todos y no deja confirmar", async () => {
		fetchMock.mockReturnValueOnce(
			reply(
				{
					ok: false,
					code: "validation",
					message: "Falta el name. Sobra un archivo.",
					problems: ["Falta el name.", "Sobra un archivo."],
				},
				422,
			),
		);
		open({ kind: "folder", folder: "ventas" });
		await pick(zip());
		const items = [...document.querySelectorAll('[role="alert"] li')].map(
			(li) => li.textContent,
		);
		expect(items).toEqual(["Falta el name.", "Sobra un archivo."]);
		expect(text()).toContain("cotizar.zip · 10 B");
		// Sin vista previa no hay nada que confirmar: solo Cancelar.
		expect(button("Crear la skill")).toBeUndefined();
		expect(button("Cancelar")?.disabled).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("elegir el mismo zip otra vez, corregido, vuelve a pedir la vista previa", async () => {
		fetchMock
			.mockReturnValueOnce(
				reply(
					{
						ok: false,
						code: "validation",
						message: "Falta el name.",
						problems: ["Falta el name."],
					},
					422,
				),
			)
			.mockReturnValueOnce(reply(preview()));
		open({ kind: "folder", folder: "ventas" });
		await pick(zip("cotizar.zip"));
		expect(text()).toContain("Falta el name.");

		await pick(zip("cotizar.zip"));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(text()).toContain("Crea una skill nueva");
		expect(text()).not.toContain("Falta el name.");
	});

	it("mientras confirma muestra qué zip sube", async () => {
		fetchMock
			.mockReturnValueOnce(reply(preview()))
			.mockReturnValueOnce(new Promise(() => {}));
		open({ kind: "folder", folder: "ventas" });
		await pick(zip("cotizar.zip", 2048));
		await click("Crear la skill");
		expect(button("Subiendo…")?.disabled).toBe(true);
		expect(text()).toContain("cotizar.zip · 2 KB");
	});

	it("un conflicto al confirmar se muestra y no refresca ni dice que quedó en borrador", async () => {
		const message =
			"Cambió desde la vista previa (ahora «reemplazar»). Volvé a abrir la vista previa.";
		fetchMock
			.mockReturnValueOnce(reply(preview()))
			.mockReturnValueOnce(
				reply({ ok: false, code: "conflict", message }, 409),
			);
		open({ kind: "folder", folder: "ventas" });
		await pick(zip());
		await click("Crear la skill");
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
		expect(refresh).not.toHaveBeenCalled();
		expect(text()).not.toContain("Quedó en borrador");
		expect(button("Crear la skill")).toBeUndefined();
	});

	it("una confirmación 200 sin revisión avisa con el mensaje de red", async () => {
		fetchMock
			.mockReturnValueOnce(reply(preview()))
			.mockReturnValueOnce(reply({ ok: true }));
		open({ kind: "folder", folder: "ventas" });
		await pick(zip());
		await click("Crear la skill");
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"No se pudo subir. Probá de nuevo.",
		);
		expect(refresh).not.toHaveBeenCalled();
		expect(text()).not.toContain("Quedó en borrador");
	});

	it("si el servidor no contesta JSON, avisa sin romper", async () => {
		fetchMock.mockReturnValueOnce(
			Promise.resolve(new Response("<html>", { status: 502 })),
		);
		open({ kind: "folder", folder: "ventas" });
		await pick(zip());
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			"No se pudo subir. Probá de nuevo.",
		);
	});
});
