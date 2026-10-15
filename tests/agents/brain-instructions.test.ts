// Value: protects=el bloque del brain llega al chat en session.started solo a agentes con brain declarado, y una falla de lectura no tumba la sesión; fails_when=un agente con brain none recibe el bloque, la excepción sale del resolver o se arma sin tenant; why_new=session-instructions.test.ts cubre el contenido, no el montaje en eve; seam=vi.mock de agent-access y session-instructions; no_claim=cómo eve inyecta el resultado en el prompt
import type { DynamicResolveContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	access: "read" as "none" | "read" | "read_write",
	accessError: null as Error | null,
	block: "# Instrucciones del brain" as string | null,
	blockError: null as Error | null,
	calls: [] as unknown[][],
}));

vi.mock("@/lib/brain/adapters/agent-access", () => ({
	loadAgentBrainAccess: async () => {
		if (state.accessError) throw state.accessError;
		return state.access;
	},
}));
vi.mock("@/lib/brain/adapters/session-instructions", () => ({
	brainSessionInstructions: async (...args: unknown[]) => {
		state.calls.push(args);
		if (state.blockError) throw state.blockError;
		return state.block;
	},
}));

const { default: asistente } = await import(
	"@/agents/asistente/instructions/brain"
);
const { default: outreach } = await import(
	"@/agents/outreach/instructions/brain"
);

function ctx(auth: unknown): DynamicResolveContext {
	return {
		session: { id: "s1", auth: { initiator: auth, current: null } },
		channel: {},
		messages: [],
	} as unknown as DynamicResolveContext;
}

const user = {
	principalType: "user",
	principalId: "ana",
	attributes: { tenantId: "t1", role: "tenant_member" },
};

async function resolve(
	dynamic: typeof asistente,
	auth: unknown,
): Promise<string | null> {
	const handler = dynamic.events["session.started"];
	if (!handler) throw new Error("brain.ts no define session.started");
	const result = await handler({}, ctx(auth));
	return result === null ? null : JSON.stringify(result);
}

beforeEach(() => {
	state.access = "read";
	state.accessError = null;
	state.block = "# Instrucciones del brain";
	state.blockError = null;
	state.calls = [];
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("instructions/brain", () => {
	it("suma el bloque del brain con la persona que actúa", async () => {
		expect(await resolve(asistente, user)).toContain(
			"# Instrucciones del brain",
		);
		expect(state.calls).toEqual([
			["t1", { userId: "ana", role: "tenant_member" }],
		]);
	});

	it("outreach también lo suma", async () => {
		expect(await resolve(outreach, user)).toContain(
			"# Instrucciones del brain",
		);
	});

	it("sin tenant no hay bloque", async () => {
		expect(
			await resolve(asistente, { ...user, attributes: { tenantId: 1 } }),
		).toBeNull();
		expect(state.calls).toEqual([]);
	});

	it("un agente con brain none no recibe bloque", async () => {
		state.access = "none";
		expect(await resolve(asistente, user)).toBeNull();
		expect(state.calls).toEqual([]);
	});

	it("sin bloque (brain mcp o nada visible) no suma nada", async () => {
		state.block = null;
		expect(await resolve(asistente, user)).toBeNull();
	});

	it("si leer las reglas falla, la sesión arranca sin el bloque", async () => {
		state.blockError = new Error("db caída");
		expect(await resolve(asistente, user)).toBeNull();
		expect(console.error).toHaveBeenCalled();
	});

	it("si leer la configuración del agente falla, la sesión arranca sin el bloque", async () => {
		state.accessError = new Error("db caída");
		expect(await resolve(outreach, user)).toBeNull();
	});
});
