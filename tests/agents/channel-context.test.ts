import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
	conversationById: null as Record<string, unknown> | null,
	conversationBySession: null as Record<string, unknown> | null,
	tenantAgent: null as Record<string, unknown> | null,
	membership: null as Record<string, unknown> | null,
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from(table: string) {
			const result =
				table === "tenant_agents"
					? rows.tenantAgent
					: table === "memberships"
						? rows.membership
						: null;

			const builder = {
				select: () => builder,
				eq: (column: string) => {
					if (column === "id") builder._kind = "byId";
					if (column === "eve_session_id") builder._kind = "bySession";
					return builder;
				},
				maybeSingle: async () => ({
					data:
						table === "conversations"
							? builder._kind === "bySession"
								? rows.conversationBySession
								: rows.conversationById
							: result,
					error: null,
				}),
				_kind: "byId" as string,
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
	rows.tenantAgent = { enabled: true };
	rows.membership = { role: "tenant_member" };
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

	it("rechaza si el agente está deshabilitado para el tenant", async () => {
		rows.tenantAgent = { enabled: false };

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
});
