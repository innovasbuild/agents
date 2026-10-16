import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn(
	async (): Promise<{ data: { user: object | null } }> => ({
		data: { user: { id: "u1" } },
	}),
);
let setCookies: { name: string; value: string }[] = [];
const createServerClient = vi.fn(
	(
		_url: string,
		_key: string,
		options: {
			cookies: {
				setAll: (
					c: { name: string; value: string; options?: object }[],
				) => void;
			};
		},
	) => ({
		auth: {
			getUser: async () => {
				if (setCookies.length) options.cookies.setAll(setCookies);
				return getUser();
			},
		},
	}),
);
vi.mock("@supabase/ssr", () => ({
	createServerClient: (...args: Parameters<typeof createServerClient>) =>
		createServerClient(...args),
}));

let binding:
	| { kind: "root" }
	| { kind: "tenant"; slug: string }
	| { kind: "unknown" }
	| Error = { kind: "root" };
vi.mock("@/lib/tenants/host-store", () => ({
	resolveHostBinding: async () => {
		if (binding instanceof Error) throw binding;
		return binding;
	},
}));

const { proxy, config } = await import("@/proxy");

const call = (path: string, host = "ai.okeefe.com.ar") =>
	proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

beforeEach(() => {
	getUser.mockClear();
	getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
	createServerClient.mockClear();
	setCookies = [];
	binding = { kind: "root" };
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});

describe("proxy en el host raíz", () => {
	it("refresca la sesión y deja pasar, como siempre", async () => {
		const response = await call("/okeefe/chat", "agentes.innov.as");
		expect(response.status).toBe(200);
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
		expect(getUser).toHaveBeenCalledTimes(1);
	});

	it("/brain/<slug>/mcp sale enseguida, sin tocar Supabase", async () => {
		const response = await call("/brain/okeefe/mcp", "agentes.innov.as");
		expect(response.status).toBe(200);
		expect(createServerClient).not.toHaveBeenCalled();
	});
});

describe("proxy en el dominio de una empresa", () => {
	beforeEach(() => {
		binding = { kind: "tenant", slug: "okeefe" };
	});

	it.each([
		["/", "/okeefe"],
		["/login", "/login/okeefe"],
		["/chat", "/okeefe/chat"],
		["/brain/mapa", "/okeefe/brain/mapa"],
		["/brain/mcp", "/brain/okeefe/mcp"],
	])("%s se reescribe a %s", async (path, internal) => {
		const response = await call(path);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			`https://ai.okeefe.com.ar${internal}`,
		);
		expect(getUser).toHaveBeenCalledTimes(1);
	});

	it("la reescritura conserva la query", async () => {
		const response = await call("/chat?thread=1");
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://ai.okeefe.com.ar/okeefe/chat?thread=1",
		);
	});

	it("una URL con slug redirige (308) a la limpia, con la query", async () => {
		const response = await call("/okeefe/chat?thread=1");
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(
			"https://ai.okeefe.com.ar/chat?thread=1",
		);
		expect(getUser).not.toHaveBeenCalled();
	});

	it("/plataforma y la forma con slug del MCP dan 404", async () => {
		expect((await call("/plataforma")).status).toBe(404);
		expect((await call("/brain/okeefe/mcp")).status).toBe(404);
	});

	it("las cookies que refresca Supabase salen en la respuesta reescrita", async () => {
		setCookies = [{ name: "sb-token", value: "nuevo" }];
		const response = await call("/chat");
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://ai.okeefe.com.ar/okeefe/chat",
		);
		expect(response.cookies.get("sb-token")?.value).toBe("nuevo");
	});

	it("/auth/callback pasa tal cual", async () => {
		const response = await call("/auth/callback?code=x");
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
		expect(response.status).toBe(200);
	});
});

describe("proxy en el dominio de una empresa, sin sesión", () => {
	beforeEach(() => {
		binding = { kind: "tenant", slug: "okeefe" };
		getUser.mockResolvedValue({ data: { user: null } });
	});

	it.each(["/", "/chat", "/brain/mapa", "/settings/usuarios"])(
		"%s redirige (307) al login de la empresa, no da 404",
		async (path) => {
			const response = await call(path);
			expect(response.status).toBe(307);
			expect(response.headers.get("location")).toBe(
				"https://ai.okeefe.com.ar/login",
			);
		},
	);

	it("el redirect conserva las cookies que Supabase limpia", async () => {
		setCookies = [{ name: "sb-token", value: "" }];
		const response = await call("/");
		expect(response.status).toBe(307);
		expect(response.cookies.get("sb-token")).toBeDefined();
	});

	it.each([
		["/login", "/login/okeefe"],
		["/brain/mcp", "/brain/okeefe/mcp"],
	])("%s sigue siendo público y se reescribe", async (path, internal) => {
		const response = await call(path);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			`https://ai.okeefe.com.ar${internal}`,
		);
	});

	it("/auth/callback pasa tal cual", async () => {
		const response = await call("/auth/callback?code=x");
		expect(response.status).toBe(200);
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
	});
});

describe("proxy en un host desconocido o con la base caída", () => {
	it("un host que no es de nadie da 404 sin tocar Supabase", async () => {
		binding = { kind: "unknown" };
		const response = await call("/chat", "evil.com");
		expect(response.status).toBe(404);
		expect(createServerClient).not.toHaveBeenCalled();
	});

	it("si la base no responde da 503", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		binding = new Error("base caída");
		const response = await call("/chat");
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("base caída");
		error.mockRestore();
	});
});

describe("matcher", () => {
	const pattern = new RegExp(`^${config.matcher[0]}$`);

	it("ya no excluye brain/ pero sí eve/ y .well-known/", () => {
		expect(pattern.test("/brain/mapa")).toBe(true);
		expect(pattern.test("/eve/outreach/v1/mcp")).toBe(false);
		expect(
			pattern.test("/.well-known/oauth-protected-resource/brain/mcp"),
		).toBe(false);
		expect(pattern.test("/icon.png")).toBe(false);
	});
});
