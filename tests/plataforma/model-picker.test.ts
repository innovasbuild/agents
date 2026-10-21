// @vitest-environment happy-dom
// Value: protects=los modelos de la empresa quedan a la vista y marcados, el resto del catálogo del gateway plegado, y lo que se envía es exactamente lo marcado; fails_when=el catálogo aparece desplegado, un modelo marcado desde "Ver más" no viaja en el form o desmarcar lo hace desaparecer
// Value: why_new=tenant-form.test.ts cubre el parseo del form, nada ejerce el selector; seam=none; no_claim=estilos y la carga real del catálogo
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelPicker } from "@/app/plataforma/[slug]/model-picker";
import type { GatewayModel } from "@/lib/tenants/gateway-models";

const model = (id: string, input = 3, output = 15): GatewayModel => ({
	id,
	name: id,
	vendor: id.split("/")[0],
	inputPerMillion: input,
	outputPerMillion: output,
});

const CATALOG = [
	model("anthropic/claude-sonnet-5"),
	model("anthropic/claude-haiku-5.5", 0.1, 0.5),
	model("openai/gpt-5", 1.25, 10),
	model("google/gemini-3-pro", 2, 12),
];
const INITIAL = ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-5.5"];

function Harness({ catalog }: { catalog: GatewayModel[] }) {
	const [selected, setSelected] = useState(INITIAL);
	return createElement(
		"form",
		null,
		createElement(ModelPicker, {
			catalog,
			initial: INITIAL,
			selected,
			onChange: setSelected,
		}),
	);
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

const mount = (catalog = CATALOG) =>
	act(() => root.render(createElement(Harness, { catalog })));

const sent = () =>
	new FormData(host.querySelector("form") as HTMLFormElement).getAll(
		"allowed_models",
	);

const checkbox = (id: string) =>
	[...host.querySelectorAll("label")]
		.find((l) => l.textContent?.includes(id))
		?.querySelector("input") as HTMLInputElement | undefined;

const button = (text: string) =>
	[...host.querySelectorAll("button")].find((b) =>
		b.textContent?.startsWith(text),
	) as HTMLButtonElement;

describe("selector de modelos", () => {
	it("muestra marcados los de la empresa con su precio y pliega el resto", () => {
		mount();
		expect(host.textContent).toContain("US$ 0.10 entrada · US$ 0.50 salida");
		expect(host.textContent).toContain("Ver más modelos (2)");
		expect(host.textContent).not.toContain("openai/gpt-5");
		expect(sent()).toEqual(INITIAL);
	});

	it("al marcar uno del catálogo, sube a la vista y viaja en el form", () => {
		mount();
		act(() => button("Ver más").click());
		expect(host.textContent).toContain("openai");
		act(() => checkbox("openai/gpt-5")?.click());
		act(() => button("Ocultar").click());
		expect(checkbox("openai/gpt-5")?.checked).toBe(true);
		expect(sent()).toEqual([...INITIAL, "openai/gpt-5"]);
	});

	it("desmarcar no lo esconde ni lo envía", () => {
		mount();
		act(() => checkbox("anthropic/claude-haiku-5.5")?.click());
		expect(checkbox("anthropic/claude-haiku-5.5")?.checked).toBe(false);
		expect(sent()).toEqual(["anthropic/claude-sonnet-5"]);
	});

	it("sin catálogo deja los actuales y avisa", () => {
		mount([]);
		expect(host.textContent).toContain("anthropic/claude-sonnet-5");
		expect(host.textContent).toContain("No pude traer el catálogo");
		expect(host.textContent).not.toContain("Ver más");
	});
});
