import { beforeEach, describe, expect, it, vi } from "vitest";

// La cadena real (host-store, resolutor, rutas) con la base simulada: lo único
// que se reemplaza es la llamada a resolve_tenant_by_host.
const domains: Record<string, string> = { "ai.okeefe.com.ar": "okeefe" };
let rpcError: { message: string } | null = null;
const rpc = vi.fn(async (_fn: string, args: { p_host: string }) => ({
	data: rpcError ? null : (domains[args.p_host] ?? null),
	error: rpcError,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const ISSUER = "https://ref.supabase.co/auth/v1";

function req(host: string, extra: Record<string, string> = {}) {
	return new Request(`https://${host}/x`, {
		headers: { host, "x-forwarded-proto": "https", ...extra },
	});
}

beforeEach(() => {
	vi.resetModules();
	rpc.mockClear();
	rpcError = null;
	vi.stubEnv("PUBLIC_APP_URL", "https://agentes.innov.as");
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
	vi.stubEnv("NODE_ENV", "production");
});

describe("metadata OAuth del brain en el dominio de una empresa", () => {
	it("publica /brain/mcp, sin slug, con el host del request", async () => {
		const { GET } = await import(
			"@/app/.well-known/oauth-protected-resource/brain/mcp/route"
		);
		const response = await GET(req("ai.okeefe.com.ar"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			resource: "https://ai.okeefe.com.ar/brain/mcp",
			authorization_servers: [ISSUER],
			bearer_methods_supported: ["header"],
		});
	});

	it("en el host raíz no existe: 404", async () => {
		const { GET } = await import(
			"@/app/.well-known/oauth-protected-resource/brain/mcp/route"
		);
		expect((await GET(req("agentes.innov.as"))).status).toBe(404);
	});

	it("un host inventado da 404 y no se refleja", async () => {
		const { GET } = await import(
			"@/app/.well-known/oauth-protected-resource/brain/mcp/route"
		);
		const response = await GET(req("evil.com"));
		expect(response.status).toBe(404);
		expect(JSON.stringify(await response.json())).not.toContain("evil.com");
	});

	it("si la base no responde da 503, no 404, y no lo cachea", async () => {
		const { GET } = await import(
			"@/app/.well-known/oauth-protected-resource/brain/mcp/route"
		);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		rpcError = { message: "base caída" };
		const down = await GET(req("ai.okeefe.com.ar"));
		expect(down.status).toBe(503);
		expect(JSON.stringify(await down.json())).not.toContain("base caída");

		rpcError = null;
		expect((await GET(req("ai.okeefe.com.ar"))).status).toBe(200);
		error.mockRestore();
	});
});

describe("metadata OAuth del brain con slug", () => {
	const load = async () =>
		(
			await import(
				"@/app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route"
			)
		).GET;
	const ctx = (tenant: string) => ({ params: Promise.resolve({ tenant }) });

	it("en el host raíz sigue siendo la forma con slug, con el origen fijo", async () => {
		const GET = await load();
		const response = await GET(req("agentes.innov.as"), ctx("okeefe") as never);
		expect((await response.json()).resource).toBe(
			"https://agentes.innov.as/brain/okeefe/mcp",
		);
	});

	it("en el dominio de una empresa solo sirve a esa empresa", async () => {
		const GET = await load();
		const own = await GET(req("ai.okeefe.com.ar"), ctx("okeefe") as never);
		expect(own.status).toBe(200);
		expect((await own.json()).resource).toBe(
			"https://ai.okeefe.com.ar/brain/mcp",
		);

		const other = await GET(
			req("ai.okeefe.com.ar"),
			ctx("lagomarsino") as never,
		);
		expect(other.status).toBe(404);
		expect(await other.json()).toMatchObject({ code: "tenant_not_found" });
	});
});

describe("metadata OAuth del agente", () => {
	const load = async () =>
		(
			await import(
				"@/app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route"
			)
		).GET;

	it("en el dominio de una empresa anuncia ese dominio", async () => {
		const GET = await load();
		expect((await (await GET(req("ai.okeefe.com.ar"))).json()).resource).toBe(
			"https://ai.okeefe.com.ar/eve/outreach/v1/mcp",
		);
	});

	it("en el host raíz, el origen fijo de siempre", async () => {
		const GET = await load();
		expect((await (await GET(req("agentes.innov.as"))).json()).resource).toBe(
			"https://agentes.innov.as/eve/outreach/v1/mcp",
		);
	});

	it("un host inventado no se refleja", async () => {
		const GET = await load();
		const body = await (await GET(req("evil.com"))).json();
		expect(body.resource).toBe("https://agentes.innov.as/eve/outreach/v1/mcp");
	});

	it("un deploy de preview (*.vercel.app) es raíz y no consulta la base", async () => {
		const GET = await load();
		const response = await GET(req("agents-git-rama.vercel.app"));
		expect(response.status).toBe(200);
		expect(rpc).not.toHaveBeenCalled();
	});
});
