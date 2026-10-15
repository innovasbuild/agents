// tests/brain/rules-panel-hook.test.ts
// @vitest-environment happy-dom
// Value: protects=en "Nueva página" el panel sigue a la última carpeta escrita; fails_when=una respuesta vieja pisa a la nueva o se pide en cada tecla; seam=none; no_claim=la Server Action real (loadNewPageRules simulada, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
	input: { tenantSlug: string; folder: string };
	resolve: (view: unknown) => void;
	reject: (error: unknown) => void;
};
const state = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("@/app/[tenant]/brain/rules-actions", () => ({
	loadNewPageRules: (input: Call["input"]) =>
		new Promise((resolve, reject) => {
			state.calls.push({ input, resolve, reject });
		}),
}));
vi.mock("next/link", () => ({
	default: (props: Record<string, unknown>) => createElement("a", props),
}));

const { useFolderRules, RULES_DEBOUNCE_MS } = await import(
	"@/components/brain/rules-panel"
);

const INITIAL = { kind: "rules", entries: [{ slug: "inicial" }] };
const view = (slug: string) => ({ kind: "rules", entries: [{ slug }] });

function Probe({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
	const current = useFolderRules({
		enabled,
		tenantSlug: "acme",
		slug,
		initial: INITIAL as never,
	});
	return createElement("pre", null, JSON.stringify(current));
}

let host: HTMLDivElement;
let root: Root;
const shown = () => host.textContent ?? "";
const show = async (slug: string, enabled = true) => {
	await act(async () => {
		root.render(createElement(Probe, { slug, enabled }));
	});
};
const wait = async (ms: number) => {
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
};

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	vi.useFakeTimers();
	state.calls = [];
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.useRealTimers();
});

describe("useFolderRules", () => {
	it("no pide nada mientras la carpeta no cambia", async () => {
		await show("comercial/");
		await show("comercial/nueva-oferta");
		await wait(1000);
		expect(state.calls).toEqual([]);
		expect(shown()).toContain("inicial");
	});

	it("pide una sola vez, por la última carpeta escrita", async () => {
		await show("comercial/");
		await show("legal/");
		await show("marketing/");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls.map((call) => call.input)).toEqual([
			{ tenantSlug: "acme", folder: "marketing" },
		]);
		await act(async () => state.calls[0].resolve(view("marketing")));
		expect(shown()).toContain("marketing");
	});

	it("descarta una respuesta vieja", async () => {
		await show("comercial/");
		await show("legal/");
		await wait(RULES_DEBOUNCE_MS);
		await show("marketing/");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls.map((call) => call.input.folder)).toEqual([
			"legal",
			"marketing",
		]);
		await act(async () => state.calls[0].resolve(view("legal")));
		expect(shown()).toContain("inicial");
		await act(async () => state.calls[1].resolve(view("marketing")));
		expect(shown()).toContain("marketing");
		expect(shown()).not.toContain("legal");
	});

	it("una carpeta a medio escribir que no es válida no pide", async () => {
		await show("comercial/");
		await show("comercial-/x");
		await wait(RULES_DEBOUNCE_MS);
		expect(state.calls).toEqual([]);
	});

	it("si falla, muestra el error", async () => {
		await show("comercial/");
		await show("legal/");
		await wait(RULES_DEBOUNCE_MS);
		await act(async () => state.calls[0].reject(new Error("red")));
		expect(shown()).toContain('"kind":"error"');
	});

	it("apagado no pide nunca", async () => {
		await show("comercial/", false);
		await show("legal/", false);
		await wait(1000);
		expect(state.calls).toEqual([]);
	});
});
