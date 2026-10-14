// @vitest-environment happy-dom
// Value: protects=el panel muestra el resultado de la conciliación (fila marcada con "revisar", % solo en empresas) y un mensaje si la acción tira; fails_when=se pierde la marca, el % aparece en filas sin libro o el fallo queda mudo
// Value: why_new=reconcile.test.ts y gasto-actions.test.ts cubren el cálculo y la acción, nada ejerce el componente cliente; seam=none; no_claim=estilos y la Server Action real (reconcileSpend simulada, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	next: (() => Promise.resolve(null)) as () => Promise<unknown>,
}));

vi.mock("@/app/plataforma/gasto/actions", () => ({
	reconcileSpend: () => state.next(),
}));

const { ReconcilePanel } = await import(
	"@/app/plataforma/gasto/reconcile-panel"
);

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

async function consult() {
	await act(async () => {
		root.render(createElement(ReconcilePanel));
	});
	const button = [...host.querySelectorAll("button")].find((b) =>
		b.textContent?.startsWith("Mes anterior"),
	);
	await act(async () => {
		button?.click();
	});
}

const line = (over: Record<string, unknown>) => ({
	key: "k",
	kind: "empresa",
	label: "Acme",
	ledger: 10,
	gateway: 10,
	diff: 0,
	diffPct: 0,
	flagged: false,
	...over,
});

describe("panel de conciliación", () => {
	it("muestra las líneas, marca las que hay que revisar y el % solo en empresas", async () => {
		state.next = async () => ({
			ok: true,
			startDate: "2026-09-01",
			endDate: "2026-09-30",
			lines: [
				line({ diff: 2, diffPct: 0.2, flagged: true }),
				line({
					key: "k2",
					kind: "sin_etiqueta",
					label: "Sin etiqueta",
					ledger: 0,
					gateway: 3,
					diff: -3,
					diffPct: null,
					flagged: true,
				}),
			],
		});
		await consult();
		const rows = [...host.querySelectorAll("tbody tr")].map((row) =>
			[...row.querySelectorAll("td")].map((cell) => cell.textContent),
		);
		expect(host.textContent).toContain("Del 01/09/2026 al 30/09/2026, en UTC.");
		expect(rows[0]).toEqual([
			"Acme · revisar",
			"US$ 10,00",
			"US$ 10,00",
			"US$ 2,00",
			"20 %",
		]);
		expect(rows[1][0]).toBe("Sin etiqueta · revisar");
		expect(rows[1][4]).toBe("—");
	});

	it("si la acción responde ok: false, muestra el mensaje y ninguna tabla", async () => {
		state.next = async () => ({
			ok: false,
			message: "Todavía no hay un día cerrado este mes.",
		});
		await consult();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"Todavía no hay un día cerrado este mes.",
		);
		expect(host.querySelector("table")).toBeNull();
	});

	it("mientras consulta, los botones quedan deshabilitados", async () => {
		let finish: (value: unknown) => void = () => {};
		state.next = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		await consult();
		const buttons = [...host.querySelectorAll("button")];
		expect(buttons.length).toBeGreaterThan(0);
		expect(buttons.every((b) => b.disabled)).toBe(true);
		expect(host.textContent).toContain("Consultando el gateway");

		await act(async () => {
			finish({ ok: false, message: "listo" });
		});
		expect([...host.querySelectorAll("button")].some((b) => b.disabled)).toBe(
			false,
		);
	});

	it("si la acción tira, lo dice en vez de quedarse muda", async () => {
		state.next = async () => {
			throw new Error("red caída");
		};
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await consult();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"No pude conciliar. Probá de nuevo.",
		);
		expect(host.querySelector("table")).toBeNull();
		spy.mockRestore();
	});
});
