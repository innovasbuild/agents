import { describe, expect, it, vi } from "vitest";
import type { DomainRow } from "@/lib/domains/service";
import type { VercelDomains } from "@/lib/domains/vercel";
import { loadDnsInstructions, STATUS_LABELS } from "@/lib/domains/view";

const row = (over: Partial<DomainRow>): DomainRow => ({
	id: "d1",
	tenantId: "t1",
	hostname: "ai.okeefe.com.ar",
	isPrimary: false,
	status: "verifying",
	lastError: null,
	verifiedAt: null,
	createdAt: "2026-10-14T00:00:00Z",
	...over,
});

function vercel(over: Partial<VercelDomains> = {}): VercelDomains {
	return {
		add: vi.fn(),
		verify: vi.fn(),
		remove: vi.fn(),
		get: vi.fn(async () => ({
			name: "x",
			verified: false,
			verification: [
				{
					type: "TXT",
					domain: "_vercel.okeefe.com.ar",
					value: "vc-domain-verify=abc",
					reason: "pending",
				},
			],
		})),
		config: vi.fn(async () => ({
			configuredBy: null,
			misconfigured: true,
			recommendedCname: "cname.vercel-dns.com.",
		})),
		...over,
	} as VercelDomains;
}

describe("STATUS_LABELS", () => {
	it("tiene un rótulo en castellano por cada estado", () => {
		expect(STATUS_LABELS).toEqual({
			pending: "Pendiente",
			verifying: "Esperando el DNS",
			active: "Activo",
			failed: "Con error",
		});
	});
});

describe("loadDnsInstructions", () => {
	it("para un dominio que espera DNS devuelve el CNAME y el TXT", async () => {
		const out = await loadDnsInstructions([row({})], vercel());
		expect(out.get("d1")).toEqual({
			cname: "cname.vercel-dns.com.",
			txt: { name: "_vercel.okeefe.com.ar", value: "vc-domain-verify=abc" },
		});
	});

	it("si ya está verificado no pide el TXT", async () => {
		const api = vercel({
			get: vi.fn(async () => ({ name: "x", verified: true, verification: [] })),
		});
		const out = await loadDnsInstructions([row({})], api);
		expect(out.get("d1")?.txt).toBeNull();
	});

	it("no consulta los dominios activos", async () => {
		const api = vercel();
		const out = await loadDnsInstructions([row({ status: "active" })], api);
		expect(out.size).toBe(0);
		expect(api.config).not.toHaveBeenCalled();
	});

	it("sin la API de Vercel no hay instrucciones", async () => {
		expect((await loadDnsInstructions([row({})], null)).size).toBe(0);
	});

	it("si Vercel falla, ese dominio queda sin instrucciones y no rompe la página", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const api = vercel({
			config: vi.fn(async () => {
				throw new Error("caído");
			}),
		});
		const out = await loadDnsInstructions([row({})], api);
		expect(out.size).toBe(0);
		error.mockRestore();
	});

	it("un Vercel que no responde no cuelga la página", async () => {
		const api = vercel({ config: () => new Promise(() => {}) });
		const out = await loadDnsInstructions([row({})], api, 20);
		expect(out.size).toBe(0);
	});
});
