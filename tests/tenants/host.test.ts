import { describe, expect, it, vi } from "vitest";
import {
	assertHostServesTenant,
	createHostResolver,
	isRootHost,
	normalizeHost,
	requestHost,
	rootHostsFromEnv,
} from "@/lib/tenants/host";

describe("normalizeHost", () => {
	it("pasa a minúsculas, saca el puerto y el punto final", () => {
		expect(normalizeHost("AI.Okeefe.com.ar")).toBe("ai.okeefe.com.ar");
		expect(normalizeHost("ai.okeefe.com.ar:443")).toBe("ai.okeefe.com.ar");
		expect(normalizeHost("ai.okeefe.com.ar.")).toBe("ai.okeefe.com.ar");
		expect(normalizeHost("okeefe.localhost:3000")).toBe("okeefe.localhost");
	});

	it("convierte un nombre internacional a punycode", () => {
		expect(normalizeHost("ía.okeefe.com.ar")).toBe("xn--a-iga.okeefe.com.ar");
	});

	it("acepta localhost, 127.0.0.1 y ::1", () => {
		expect(normalizeHost("localhost:3000")).toBe("localhost");
		expect(normalizeHost("127.0.0.1:3000")).toBe("127.0.0.1");
		expect(normalizeHost("[::1]:3000")).toBe("[::1]");
	});

	it.each([
		"",
		"a b",
		"a/b",
		"a?b",
		"a#b",
		"user@host.com",
		"host:80:90",
		"host:abc",
		"-host.com",
		"*.okeefe.com.ar",
		"https://ai.okeefe.com.ar",
	])("rechaza %j", (raw) => {
		expect(normalizeHost(raw)).toBeNull();
	});

	it("rechaza null y undefined", () => {
		expect(normalizeHost(null)).toBeNull();
		expect(normalizeHost(undefined)).toBeNull();
	});
});

describe("requestHost", () => {
	it("prefiere x-forwarded-host sobre host", () => {
		const headers = new Headers({
			"x-forwarded-host": "ai.okeefe.com.ar",
			host: "interno.vercel.app",
		});
		expect(requestHost(headers)).toBe("ai.okeefe.com.ar");
	});

	it("con varios valores en x-forwarded-host usa el primero", () => {
		const headers = new Headers({
			"x-forwarded-host": "ai.okeefe.com.ar, proxy.interno",
		});
		expect(requestHost(headers)).toBe("ai.okeefe.com.ar");
	});

	it("sin x-forwarded-host usa host", () => {
		expect(requestHost(new Headers({ host: "Localhost:3000" }))).toBe(
			"localhost",
		);
	});

	it("sin headers devuelve null", () => {
		expect(requestHost(new Headers())).toBeNull();
	});

	it("un valor inválido devuelve null en vez de caer al otro header", () => {
		const headers = new Headers({
			"x-forwarded-host": "a b",
			host: "agentes.innov.as",
		});
		expect(requestHost(headers)).toBeNull();
	});
});

describe("rootHostsFromEnv / isRootHost", () => {
	it("toma el host de PUBLIC_APP_URL", () => {
		const roots = rootHostsFromEnv({
			PUBLIC_APP_URL: "https://agentes.innov.as/",
			NODE_ENV: "production",
		});
		expect(isRootHost("agentes.innov.as", roots)).toBe(true);
		expect(isRootHost("otro.innov.as", roots)).toBe(false);
	});

	it("sin PUBLIC_APP_URL cae a VERCEL_URL", () => {
		const roots = rootHostsFromEnv({
			VERCEL_URL: "agents-abc123.vercel.app",
			NODE_ENV: "production",
		});
		expect(isRootHost("agents-abc123.vercel.app", roots)).toBe(true);
	});

	it("cualquier *.vercel.app es raíz: son los deploys de preview", () => {
		const roots = rootHostsFromEnv({
			PUBLIC_APP_URL: "https://agentes.innov.as",
			NODE_ENV: "production",
		});
		expect(isRootHost("agents-git-rama-innovas.vercel.app", roots)).toBe(true);
	});

	it("localhost y 127.0.0.1 son raíz fuera de producción", () => {
		const dev = rootHostsFromEnv({ NODE_ENV: "development" });
		expect(isRootHost("localhost", dev)).toBe(true);
		expect(isRootHost("127.0.0.1", dev)).toBe(true);
		const prod = rootHostsFromEnv({
			PUBLIC_APP_URL: "https://agentes.innov.as",
			NODE_ENV: "production",
		});
		expect(isRootHost("localhost", prod)).toBe(false);
	});

	it("okeefe.localhost no es raíz: es de una empresa", () => {
		const dev = rootHostsFromEnv({ NODE_ENV: "development" });
		expect(isRootHost("okeefe.localhost", dev)).toBe(false);
	});
});

describe("createHostResolver", () => {
	const roots = ["agentes.innov.as"];

	function build(
		lookup: (host: string) => Promise<string | null>,
		extra: { now?: () => number; max?: number } = {},
	) {
		return createHostResolver({
			isRoot: (host) => roots.includes(host),
			lookup,
			...extra,
		});
	}

	it("un host raíz no consulta la base", async () => {
		const lookup = vi.fn();
		const resolve = build(lookup);
		expect(await resolve("agentes.innov.as")).toEqual({ kind: "root" });
		expect(lookup).not.toHaveBeenCalled();
	});

	it("un *.vercel.app tampoco consulta la base", async () => {
		const lookup = vi.fn();
		const resolve = createHostResolver({
			isRoot: (host) =>
				isRootHost(
					host,
					rootHostsFromEnv({
						PUBLIC_APP_URL: "https://agentes.innov.as",
						NODE_ENV: "production",
					}),
				),
			lookup,
		});
		expect(await resolve("agents-abc.vercel.app")).toEqual({ kind: "root" });
		expect(lookup).not.toHaveBeenCalled();
	});

	it("un host de empresa devuelve su slug", async () => {
		const resolve = build(async () => "okeefe");
		expect(await resolve("ai.okeefe.com.ar")).toEqual({
			kind: "tenant",
			slug: "okeefe",
		});
	});

	it("un host desconocido no es raíz", async () => {
		const resolve = build(async () => null);
		expect(await resolve("evil.com")).toEqual({ kind: "unknown" });
	});

	it("un host nulo es desconocido y no consulta", async () => {
		const lookup = vi.fn();
		const resolve = build(lookup);
		expect(await resolve(null)).toEqual({ kind: "unknown" });
		expect(lookup).not.toHaveBeenCalled();
	});

	it("la segunda consulta sale de la caché", async () => {
		const lookup = vi.fn(async () => "okeefe");
		const resolve = build(lookup);
		await resolve("ai.okeefe.com.ar");
		await resolve("ai.okeefe.com.ar");
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it("también cachea los que no existen", async () => {
		const lookup = vi.fn(async () => null);
		const resolve = build(lookup);
		await resolve("evil.com");
		await resolve("evil.com");
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it("la caché vence a los 60 segundos", async () => {
		let now = 1_000;
		const lookup = vi.fn(async () => "okeefe");
		const resolve = build(lookup, { now: () => now });
		await resolve("ai.okeefe.com.ar");
		now += 59_999;
		await resolve("ai.okeefe.com.ar");
		expect(lookup).toHaveBeenCalledTimes(1);
		now += 2;
		await resolve("ai.okeefe.com.ar");
		expect(lookup).toHaveBeenCalledTimes(2);
	});

	it("un error del lookup se propaga y no se cachea", async () => {
		const lookup = vi
			.fn<(host: string) => Promise<string | null>>()
			.mockRejectedValueOnce(new Error("base caída"))
			.mockResolvedValueOnce("okeefe");
		const resolve = build(lookup);
		await expect(resolve("ai.okeefe.com.ar")).rejects.toThrow("base caída");
		expect(await resolve("ai.okeefe.com.ar")).toEqual({
			kind: "tenant",
			slug: "okeefe",
		});
	});

	it("respeta el tope de entradas descartando la más vieja", async () => {
		const lookup = vi.fn(async (host: string) => host.split(".")[0] ?? null);
		const resolve = build(lookup, { max: 2 });
		await resolve("a.test");
		await resolve("b.test");
		await resolve("c.test");
		expect(lookup).toHaveBeenCalledTimes(3);
		await resolve("b.test");
		await resolve("c.test");
		expect(lookup).toHaveBeenCalledTimes(3);
		await resolve("a.test");
		expect(lookup).toHaveBeenCalledTimes(4);
	});
});

describe("assertHostServesTenant", () => {
	it("un host de empresa solo sirve su slug", () => {
		const binding = { kind: "tenant", slug: "okeefe" } as const;
		expect(assertHostServesTenant(binding, "okeefe")).toBe(true);
		expect(assertHostServesTenant(binding, "lagomarsino")).toBe(false);
	});

	it("el host raíz no valida nada", () => {
		expect(assertHostServesTenant({ kind: "root" }, "cualquiera")).toBe(true);
	});

	it("un host desconocido no sirve a nadie", () => {
		expect(assertHostServesTenant({ kind: "unknown" }, "okeefe")).toBe(false);
	});
});
