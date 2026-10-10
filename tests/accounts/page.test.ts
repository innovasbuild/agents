import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AUTH = new Error("auth");
const state = vi.hoisted(() => ({
	session: true,
	connections: [] as {
		capability: string;
		provider: string;
		enabled: boolean;
	}[],
	executor: null as Record<string, unknown> | null,
	tokens: {} as Record<string, "ok" | "auth" | "boom">,
	tokenCalls: [] as { connector: string; scopes: unknown }[],
	startCalls: 0,
	gmailMarks: [] as string[],
	ownerMarks: [] as string[],
	owner: "777" as string | null,
	ownerThrows: false,
	notInstalled: false,
}));

vi.mock("@/lib/outreach/web-session", () => ({
	webSession: async () =>
		state.session
			? {
					caller: {
						tenantId: "t1",
						userId: "u1",
						role: "tenant_member",
						email: "ana@acme.test",
					},
					tenant: { id: "t1", slug: "acme", displayName: "Acme" },
				}
			: null,
}));
vi.mock("@/lib/outreach/web-context", () => ({
	connectSubjectIssuer: () => "https://sb.test",
}));
vi.mock("@/lib/gmail/send", () => ({
	GMAIL_SCOPES: ["gmail.send", "gmail.readonly"],
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) => {
			const q = {
				select: () => q,
				eq: () => q,
				maybeSingle: async () => ({ data: state.executor, error: null }),
				// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve({
						data: table === "tenant_connections" ? state.connections : [],
						error: null,
					}).then(resolve),
			};
			return q;
		},
	}),
}));
vi.mock("@/lib/connectors/auth", () => ({
	tokenForSubject: async (
		connector: string,
		_who: unknown,
		scopes: unknown,
	) => {
		state.tokenCalls.push({ connector, scopes });
		const outcome = state.tokens[connector] ?? "ok";
		if (outcome === "auth") throw AUTH;
		if (outcome === "boom") throw new Error("red");
		return { token: `tok-${connector}`, expiresAt: 0 };
	},
	startAuthorizationForSubject: async () => {
		state.startCalls += 1;
		return { url: "x", expiresAt: null };
	},
	isConnectAuthError: (e: unknown) => e === AUTH,
	isConnectorNotInstalledError: () => state.notInstalled,
}));
vi.mock("@/lib/connectors/executors", () => ({
	markGmailAuthorized: async (_t: string, userId: string) => {
		state.gmailMarks.push(userId);
	},
	markCrmOwner: async (_t: string, _u: string, ownerId: string) => {
		state.ownerMarks.push(ownerId);
	},
}));
vi.mock("@/lib/connectors/crm/owner", () => ({
	resolveCrmOwnerId: async () => {
		if (state.ownerThrows) throw new Error("hubspot");
		return state.owner;
	},
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/mis-cuentas/actions", () => ({
	startAccountAuthorization: async () => ({ ok: true, url: "x" }),
}));

const { default: MisCuentasPage } = await import(
	"@/app/[tenant]/mis-cuentas/page"
);
const render = async () =>
	renderToStaticMarkup(
		await MisCuentasPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

const BOTH = [
	{ capability: "crm", provider: "hubspot", enabled: true },
	{ capability: "mail", provider: "gmail", enabled: true },
];

describe("Mis cuentas", () => {
	beforeEach(() => {
		state.session = true;
		state.connections = BOTH;
		state.executor = {
			user_id: "u1",
			gmail_authorized_at: "2026-10-01T00:00:00Z",
			crm_owner_id: "777",
		};
		state.tokens = {};
		state.tokenCalls = [];
		state.startCalls = 0;
		state.gmailMarks = [];
		state.ownerMarks = [];
		state.owner = "777";
		state.ownerThrows = false;
		state.notInstalled = false;
	});

	it("sin acceso da 404", async () => {
		state.session = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("cargar la página NUNCA arranca una autorización, en ningún estado", async () => {
		for (const tokens of [
			{},
			{ "google/google": "auth", "mcp.hubspot.com/hubspot": "auth" },
			{ "google/google": "boom", "mcp.hubspot.com/hubspot": "boom" },
		] as Record<string, "ok" | "auth" | "boom">[]) {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				state.tokens = tokens;
				await render();
			} finally {
				log.mockRestore();
			}
		}
		expect(state.startCalls).toBe(0);
	});

	it("un ejecutor ve las dos cuentas; Gmail se sondea con los scopes completos", async () => {
		const html = await render();
		expect(html).toContain("HubSpot");
		expect(html).toContain("Gmail");
		expect(html).toContain("Autorizada");
		expect(html).toContain("Reautorizar");
		expect(state.tokenCalls).toContainEqual({
			connector: "google/google",
			scopes: ["gmail.send", "gmail.readonly"],
		});
		expect(state.tokenCalls).toContainEqual({
			connector: "mcp.hubspot.com/hubspot",
			scopes: undefined,
		});
	});

	it("quien no es ejecutor ve solo HubSpot y no se sondea Gmail", async () => {
		state.executor = null;
		const html = await render();
		expect(html).toContain("HubSpot");
		expect(html).not.toContain("Gmail");
		expect(state.tokenCalls.map((c) => c.connector)).toEqual([
			"mcp.hubspot.com/hubspot",
		]);
	});

	it("sin grant: Sin autorizar y botón Autorizar", async () => {
		state.tokens = { "mcp.hubspot.com/hubspot": "auth" };
		const html = await render();
		expect(html).toContain("Sin autorizar");
		expect(html).toContain(">Autorizar<");
	});

	it("si no se pudo comprobar, lo dice y no ofrece botón", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.executor = null;
			state.tokens = { "mcp.hubspot.com/hubspot": "boom" };
			const html = await render();
			expect(html).toContain("No pude comprobarlo");
			expect(html).not.toContain("<button");
		} finally {
			log.mockRestore();
		}
	});

	it("conector no instalado: lo dice y no ofrece botón", async () => {
		state.executor = null;
		state.notInstalled = true;
		state.tokens = { "mcp.hubspot.com/hubspot": "boom" };
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const html = await render();
			expect(html).toContain(
				"No disponible: pedile a INNOV.AS que la habilite",
			);
			expect(html).not.toContain("<button");
		} finally {
			log.mockRestore();
		}
	});

	it("una empresa sin cuentas que autorizar lo dice", async () => {
		state.connections = [];
		expect(await render()).toContain("No hay cuentas para autorizar");
	});

	it("reconcilia: sella Gmail y guarda el dueño de HubSpot cuando faltan", async () => {
		state.executor = {
			user_id: "u1",
			gmail_authorized_at: null,
			crm_owner_id: null,
		};
		await render();
		expect(state.gmailMarks).toEqual(["u1"]);
		expect(state.ownerMarks).toEqual(["777"]);
	});

	it("no reconcilia lo que ya está, ni a quien no es ejecutor, ni sin autorización", async () => {
		await render();
		expect(state.gmailMarks).toEqual([]);
		expect(state.ownerMarks).toEqual([]);

		state.executor = null;
		await render();
		expect(state.ownerMarks).toEqual([]);

		state.executor = {
			user_id: "u1",
			gmail_authorized_at: null,
			crm_owner_id: null,
		};
		state.tokens = {
			"google/google": "auth",
			"mcp.hubspot.com/hubspot": "auth",
		};
		await render();
		expect(state.gmailMarks).toEqual([]);
		expect(state.ownerMarks).toEqual([]);
	});

	it("si HubSpot no devuelve dueño, o falla, la página carga y lo dice", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.executor = {
				user_id: "u1",
				gmail_authorized_at: "x",
				crm_owner_id: null,
			};
			state.owner = null;
			expect(await render()).toContain("No pude leer tu usuario de HubSpot");

			state.ownerThrows = true;
			expect(await render()).toContain("No pude leer tu usuario de HubSpot");
			expect(state.ownerMarks).toEqual([]);
		} finally {
			log.mockRestore();
		}
	});

	it("ningún token llega al HTML", async () => {
		expect(await render()).not.toContain("tok-");
	});
});
