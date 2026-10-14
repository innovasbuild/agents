// @vitest-environment happy-dom
// Value: protects=al reintentar el borrado de una carpeta el error anterior se limpia; fails_when=el aviso del primer intento queda pegado mientras corre el segundo; seam=none; no_claim=la Server Action real (deleteBrainFolder simulada, happy-dom)
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	calls: [] as Array<() => Promise<unknown>>,
}));

vi.mock("@/app/[tenant]/brain/folder-actions", () => ({
	deleteBrainFolder: () =>
		(state.calls.shift() ?? (() => new Promise(() => {})))(),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));

const { FolderDeleteDialog } = await import(
	"@/components/brain/folder-delete-dialog"
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

const alertText = () => document.querySelector('[role="alert"]')?.textContent;

async function clickDelete() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent === "Borrar",
	);
	await act(async () => {
		button?.click();
	});
}

describe("FolderDeleteDialog", () => {
	it("limpia el error anterior al reintentar", async () => {
		state.calls = [
			() =>
				Promise.resolve({ ok: false, message: "La carpeta no está vacía." }),
		];
		await act(async () => {
			root.render(
				createElement(FolderDeleteDialog, {
					tenantSlug: "acme",
					path: "comercial",
					onClose: () => {},
				}),
			);
		});
		await clickDelete();
		expect(alertText()).toBe("La carpeta no está vacía.");
		await clickDelete();
		expect(alertText()).toBeUndefined();
	});
});
