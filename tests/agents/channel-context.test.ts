import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
	conversationById: null as Record<string, unknown> | null,
	conversationBySession: null as Record<string, unknown> | null,
	tenantAgent: null as {
		tenant_id: string;
		agent: string;
		enabled: boolean;
	} | null,
	membership: null as {
		tenant_id: string;
		user_id: string;
		role: string;
	} | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			const builder = {
				_kind: "byId" as string,
				_filters: {} as Record<string, unknown>,
				select: () => builder,
				eq: (column: string, value: unknown) => {
					if (column === "id") builder._kind = "byId";
					if (column === "eve_session_id") builder._kind = "bySession";
					builder._filters[column] = value;
					return builder;
				},
				maybeSingle: async () => {
					// conversations: al igual que tenant_agents/memberships más abajo,
					// no alcanza con mirar qué COLUMNA se usó en .eq() -- hay que
					// chequear que el VALOR consultado sea el de la fila que se quiere
					// devolver. C1 (secuestro de sesión por eve_session_id escribible)
					// le sube el precio a este mock: un bug que buscara por el id
					// equivocado sobre la columna correcta debe fallar el test, no
					// pasar por casualidad.
					if (table === "conversations") {
						if (builder._kind === "bySession") {
							const row = rows.conversationBySession;
							const matches =
								row !== null &&
								row.eve_session_id === builder._filters.eve_session_id;
							return { data: matches ? row : null, error: null };
						}

						const row = rows.conversationById;
						const matches = row !== null && row.id === builder._filters.id;
						return { data: matches ? row : null, error: null };
					}

					// tenant_agents y memberships solo devuelven su row si los
					// filtros de .eq(...) coinciden con lo esperado: así un bug que
					// consulte tenant_id/agent/user_id equivocados también falla el
					// test, en vez de pasar por casualidad porque el mock ignoraba
					// los argumentos.
					if (table === "tenant_agents") {
						const row = rows.tenantAgent;
						const matches =
							row !== null &&
							row.tenant_id === builder._filters.tenant_id &&
							row.agent === builder._filters.agent;
						return { data: matches ? row : null, error: null };
					}

					if (table === "memberships") {
						const row = rows.membership;
						const matches =
							row !== null &&
							row.tenant_id === builder._filters.tenant_id &&
							row.user_id === builder._filters.user_id;
						return { data: matches ? row : null, error: null };
					}

					return { data: null, error: null };
				},
			};
			return builder;
		},
	}),
}));

const { resolveChannelContext } = await import("@/lib/agents/channel-context");

const CONVERSATION = {
	id: "cccccccc-0000-0000-0000-000000000001",
	tenant_id: "aaaaaaaa-0000-0000-0000-000000000002",
	user_id: "22222222-2222-2222-2222-222222222222",
	agent: "outreach",
	// Mismo valor que las URLs ".../session/wrun_A" de los tests de
	// continue-path más abajo: el mock ahora compara por VALOR (M2), así que
	// tiene que coincidir con lo que esos tests consultan.
	eve_session_id: "wrun_A",
	tenants: { slug: "lagomarcino" },
};

// Conversación propia y válida de un atacante: sirve para el escenario de
// secuestro de sesión, donde el atacante manda un header que apunta a ALGO
// legítimo suyo, para probar que en continue el header se ignora igual.
const ATTACKER_CONVERSATION = {
	id: "cccccccc-0000-0000-0000-000000000002",
	tenant_id: "aaaaaaaa-0000-0000-0000-000000000002",
	user_id: "33333333-3333-3333-3333-333333333333",
	agent: "outreach",
	tenants: { slug: "lagomarcino" },
};

function createRequest(url: string, conversationId?: string) {
	return new Request(url, {
		headers: conversationId ? { "x-innovas-conversation": conversationId } : {},
	});
}

beforeEach(() => {
	rows.conversationById = CONVERSATION;
	rows.conversationBySession = CONVERSATION;
	rows.tenantAgent = {
		tenant_id: CONVERSATION.tenant_id,
		agent: CONVERSATION.agent,
		enabled: true,
	};
	rows.membership = {
		tenant_id: CONVERSATION.tenant_id,
		user_id: CONVERSATION.user_id,
		role: "tenant_member",
	};
});

describe("resolveChannelContext", () => {
	it("resuelve el tenant al crear una sesión", async () => {
		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
		);

		expect(context).toEqual({
			tenantId: CONVERSATION.tenant_id,
			tenantSlug: "lagomarcino",
			conversationId: CONVERSATION.id,
			role: "tenant_member",
		});
	});

	it("rechaza crear sobre una conversación ajena", async () => {
		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session",
				CONVERSATION.id,
			),
			"99999999-9999-9999-9999-999999999999",
		);

		expect(context).toBeNull();
	});

	it("rechaza continuar la sesión de otro usuario", async () => {
		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
			),
			"99999999-9999-9999-9999-999999999999",
		);

		expect(context).toBeNull();
	});

	it("ignora el header al continuar y usa la sesión de la URL", async () => {
		rows.conversationById = { ...CONVERSATION, tenant_id: "otro-tenant" };

		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
				"cccccccc-0000-0000-0000-000000000009",
			),
			CONVERSATION.user_id,
		);

		expect(context?.tenantId).toBe(CONVERSATION.tenant_id);
	});

	it("rechaza el secuestro: sesión real de la víctima + header con una conversación propia y válida del atacante", async () => {
		// Ataque completo en un solo test: la sesión de la URL es la sesión real
		// de la víctima (A). El atacante (B) manda un header que no es basura —
		// apunta a una conversación SUYA, legítima. Si el código alguna vez
		// mezclara header y URL en continue, esto podría colarse. Como en
		// continue el header se ignora del todo, la conversación resuelta sigue
		// siendo la de A, y el ownership check contra userId=B debe fallar.
		rows.conversationBySession = CONVERSATION;
		rows.conversationById = ATTACKER_CONVERSATION;

		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
				ATTACKER_CONVERSATION.id,
			),
			ATTACKER_CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});

	it("rechaza si el agente está deshabilitado para el tenant", async () => {
		rows.tenantAgent = {
			tenant_id: CONVERSATION.tenant_id,
			agent: CONVERSATION.agent,
			enabled: false,
		};

		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});

	it("rechaza si el usuario ya no es miembro del tenant", async () => {
		rows.membership = null;

		const context = await resolveChannelContext(
			createRequest(
				"https://app.test/eve/agents/outreach/eve/v1/session",
				CONVERSATION.id,
			),
			CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});

	it("rechaza cuando no hay sesión ni header", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/agents/outreach/eve/v1/session"),
			CONVERSATION.user_id,
		);

		expect(context).toBeNull();
	});

	it("reintenta el lookup por eve_session_id si bind-session todavía no escribió (carrera con el hook async)", async () => {
		// bind-session.ts ata eve_session_id de forma asíncrona DESPUÉS de que
		// eve ya le devolvió el sessionId al cliente; el stream que abre el
		// cliente casi al toque puede llegar antes de que esa escritura
		// termine. Sin retry esto 401ea el primer mensaje de un hilo nuevo.
		vi.useFakeTimers();
		try {
			rows.conversationBySession = null;
			const pending = resolveChannelContext(
				createRequest(
					"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
				),
				CONVERSATION.user_id,
			);

			// Todavía no llegó la escritura de bind-session: el primer intento
			// falla y el código tiene que esperar antes de reintentar, no
			// devolver null de una.
			await vi.advanceTimersByTimeAsync(50);
			rows.conversationBySession = CONVERSATION;
			await vi.advanceTimersByTimeAsync(5000);

			expect(await pending).toEqual({
				tenantId: CONVERSATION.tenant_id,
				tenantSlug: "lagomarcino",
				conversationId: CONVERSATION.id,
				role: "tenant_member",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("devuelve null si eve_session_id nunca se ata (agota los reintentos)", async () => {
		vi.useFakeTimers();
		try {
			rows.conversationBySession = null;
			const pending = resolveChannelContext(
				createRequest(
					"https://app.test/eve/agents/outreach/eve/v1/session/wrun_A",
				),
				CONVERSATION.user_id,
			);

			await vi.advanceTimersByTimeAsync(10000);

			expect(await pending).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
