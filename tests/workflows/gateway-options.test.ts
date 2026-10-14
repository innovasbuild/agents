import { describe, expect, it, vi } from "vitest";
import {
	createGatewayOptions,
	gatewayOptions,
	tenantTag,
} from "@/lib/workflows/gateway-options";

function fakeAdmin(result: { data: unknown; error: unknown }) {
	const maybeSingle = vi.fn(async () => result);
	const eq = vi.fn(() => ({ maybeSingle }));
	const select = vi.fn(() => ({ eq }));
	return { admin: { from: vi.fn(() => ({ select })) }, maybeSingle };
}

describe("gatewayOptions", () => {
	it("arma el tag de la empresa", () => {
		expect(tenantTag("acme")).toBe("tenant:acme");
		expect(gatewayOptions("acme")).toEqual({
			gateway: { tags: ["tenant:acme"] },
		});
	});
});

describe("createGatewayOptions", () => {
	it("resuelve el slug por id y lo guarda en caché", async () => {
		const { admin, maybeSingle } = fakeAdmin({
			data: { slug: "acme" },
			error: null,
		});
		const optionsFor = createGatewayOptions(admin as never);
		expect(await optionsFor("t1")).toEqual({
			gateway: { tags: ["tenant:acme"] },
		});
		await optionsFor("t1");
		expect(maybeSingle).toHaveBeenCalledTimes(1);
	});

	it("si la base falla, etiqueta con el id y no guarda el fallo", async () => {
		const { admin, maybeSingle } = fakeAdmin({
			data: null,
			error: { message: "db caída" },
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const optionsFor = createGatewayOptions(admin as never);
		expect(await optionsFor("t1")).toEqual({
			gateway: { tags: ["tenant:t1"] },
		});
		await optionsFor("t1");
		expect(maybeSingle).toHaveBeenCalledTimes(2);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	// Value: protects=un tenant sin fila o con slug vacío se etiqueta con el id y no queda en caché; fails_when=se acepta un slug vacío (tag "tenant:") o se cachea el fallback
	// Value: why_new=las filas anteriores cubren error de base y excepción, no una respuesta sin error y sin slug utilizable; seam=none; no_claim=lectura real de tenants (admin simulado)
	it.each([
		["sin fila", null],
		["slug vacío", { slug: "" }],
		["slug que no es texto", { slug: 7 }],
	])("tenant %s: etiqueta con el id y no lo guarda", async (_name, data) => {
		const { admin, maybeSingle } = fakeAdmin({ data, error: null });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const optionsFor = createGatewayOptions(admin as never);
		expect(await optionsFor("t1")).toEqual({
			gateway: { tags: ["tenant:t1"] },
		});
		await optionsFor("t1");
		expect(maybeSingle).toHaveBeenCalledTimes(2);
		spy.mockRestore();
	});

	it("si la consulta tira, etiqueta con el id y no tira", async () => {
		const admin = {
			from: () => {
				throw new Error("sin red");
			},
		};
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(createGatewayOptions(admin as never)("t1")).resolves.toEqual({
			gateway: { tags: ["tenant:t1"] },
		});
		spy.mockRestore();
	});
});
