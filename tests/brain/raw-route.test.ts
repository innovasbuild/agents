// Value: protects=la ruta raw sirve el cuerpo solo via ctx.provider.read(slug), 404 si no hay ctx ok, slug invalido o
//   BrainNotFound, y relanza cualquier otro error.
// fails_when=se quita el manejo de BrainNotFound, se saltea el chequeo de ctx.kind o se traga otro error como 404.
// why_new=la ruta se movio del cliente RLS al proveedor y no tiene cobertura; seam=none

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrainNotFound } from "@/lib/brain/core/errors";

const state = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/brain/adapters/editor", () => ({
	loadEditorContext: vi.fn(async () => state.ctx),
}));

import { GET } from "@/app/[tenant]/brain/raw/[...slug]/route";

function call(slug: string[]) {
	return GET(new Request("http://localhost/acme/brain/raw/x"), {
		params: Promise.resolve({ tenant: "acme", slug }),
	});
}

function okCtx(read: (slug: string) => Promise<unknown>) {
	return { kind: "ok", provider: { read: vi.fn(read) } };
}

beforeEach(() => {
	state.ctx = null;
});

describe("GET /[tenant]/brain/raw/[...slug]", () => {
	it("404 sin contexto", async () => {
		expect((await call(["comercial", "icp"])).status).toBe(404);
	});

	it.each(["no-brain", "external"])(
		"404 si el contexto es %s",
		async (kind) => {
			const read = vi.fn();
			state.ctx = { kind, provider: { read } };
			expect((await call(["comercial", "icp"])).status).toBe(404);
			expect(read).not.toHaveBeenCalled();
		},
	);

	it.each([[[]], [["Mayus/ICP"]], [["a", "%E0%A4%A"]]])(
		"404 con slug inválido %j sin leer",
		async (segments) => {
			const ctx = okCtx(async () => ({ body: "x" }));
			state.ctx = ctx;
			expect((await call(segments)).status).toBe(404);
			expect(ctx.provider.read).not.toHaveBeenCalled();
		},
	);

	it("404 cuando el proveedor lanza BrainNotFound", async () => {
		state.ctx = okCtx(async (slug) => {
			throw new BrainNotFound(slug, []);
		});
		expect((await call(["comercial", "nada"])).status).toBe(404);
	});

	it("relanza los demás errores en vez de tragarlos como 404", async () => {
		state.ctx = okCtx(async () => {
			throw new Error("proveedor caído");
		});
		await expect(call(["comercial", "icp"])).rejects.toThrow("proveedor caído");
	});

	it("devuelve el cuerpo leído por el proveedor con el slug derivado", async () => {
		const ctx = okCtx(async () => ({ body: "# ICP\ncuerpo vigente" }));
		state.ctx = ctx;
		const res = await call(["comercial", "icp"]);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("# ICP\ncuerpo vigente");
		expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(ctx.provider.read).toHaveBeenCalledTimes(1);
		expect(ctx.provider.read).toHaveBeenCalledWith("comercial/icp");
	});
});
