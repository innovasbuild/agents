import { describe, expect, it } from "vitest";
import type { HostBinding } from "@/lib/tenants/host";
import { publicOriginForRequest } from "@/lib/tenants/public-url";

const FALLBACK = "https://agentes.innov.as";

function origin(headers: Record<string, string>, binding: HostBinding) {
	return publicOriginForRequest(new Headers(headers), {
		resolve: async () => binding,
		fallback: FALLBACK,
	});
}

describe("publicOriginForRequest", () => {
	it("en un host de empresa devuelve ese host con https", async () => {
		expect(
			await origin(
				{ host: "ai.okeefe.com.ar" },
				{ kind: "tenant", slug: "okeefe" },
			),
		).toEqual({ origin: "https://ai.okeefe.com.ar", tenantHost: true });
	});

	it("respeta x-forwarded-proto", async () => {
		expect(
			await origin(
				{ "x-forwarded-host": "ai.okeefe.com.ar", "x-forwarded-proto": "http" },
				{ kind: "tenant", slug: "okeefe" },
			),
		).toEqual({ origin: "http://ai.okeefe.com.ar", tenantHost: true });
	});

	it("un *.localhost de empresa usa http y conserva el puerto", async () => {
		expect(
			await origin(
				{ host: "okeefe.localhost:3000" },
				{ kind: "tenant", slug: "okeefe" },
			),
		).toEqual({ origin: "http://okeefe.localhost:3000", tenantHost: true });
	});

	it("en el host raíz devuelve el origen fijo, como hoy", async () => {
		expect(
			await origin({ host: "agentes.innov.as" }, { kind: "root" }),
		).toEqual({ origin: FALLBACK, tenantHost: false });
	});

	it("un host inventado nunca se refleja", async () => {
		expect(await origin({ host: "evil.com" }, { kind: "unknown" })).toEqual({
			origin: FALLBACK,
			tenantHost: false,
		});
	});

	it("sin headers devuelve el origen fijo", async () => {
		expect(await origin({}, { kind: "unknown" })).toEqual({
			origin: FALLBACK,
			tenantHost: false,
		});
	});
});
