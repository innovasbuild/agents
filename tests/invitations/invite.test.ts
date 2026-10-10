import { beforeEach, describe, expect, it } from "vitest";
import { inviteToTenant, sendInvitationMail } from "@/lib/invitations/invite";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	tenant: { slug: string; allowed_domains: string[] } | null;
	insertError: unknown;
	inviteError: { code?: string; message: string } | null;
	inserts: { table: string; values: Record<string, unknown> }[];
	invites: { email: string; redirectTo?: string }[];
} = {
	tenant: null,
	insertError: null,
	inviteError: null,
	inserts: [],
	invites: [],
};

const admin = {
	from: (table: string) => ({
		select: () => ({
			eq: () => ({ single: async () => ({ data: state.tenant }) }),
		}),
		insert: async (values: Record<string, unknown>) => {
			state.inserts.push({ table, values });
			return { error: table === "invitations" ? state.insertError : null };
		},
	}),
	auth: {
		admin: {
			inviteUserByEmail: async (
				email: string,
				options: { redirectTo?: string },
			) => {
				state.invites.push({ email, redirectTo: options.redirectTo });
				return { error: state.inviteError };
			},
		},
	},
};

const base = {
	// biome-ignore lint/suspicious/noExplicitAny: doble de prueba del cliente admin
	admin: admin as any,
	tenantId: TENANT_ID,
	email: "Ana@Acme.test",
	role: "tenant_admin" as const,
	invitedBy: "u1",
	allowExternal: false,
	origin: "https://app.test",
};

describe("inviteToTenant", () => {
	beforeEach(() => {
		state.tenant = { slug: "acme", allowed_domains: ["acme.test"] };
		state.insertError = null;
		state.inviteError = null;
		state.inserts = [];
		state.invites = [];
	});

	it("invita y manda el mail con el callback del origen", async () => {
		const result = await inviteToTenant(base);

		expect(result).toEqual({ kind: "ok" });
		expect(state.inserts[0]).toEqual({
			table: "invitations",
			values: {
				tenant_id: TENANT_ID,
				email: "ana@acme.test",
				role: "tenant_admin",
				invited_by: "u1",
			},
		});
		expect(state.invites[0]).toEqual({
			email: "ana@acme.test",
			redirectTo: "https://app.test/auth/callback",
		});
	});

	it("suma next al callback cuando viene", async () => {
		await inviteToTenant({ ...base, next: "/acme/chat" });

		expect(state.invites[0]?.redirectTo).toBe(
			"https://app.test/auth/callback?next=%2Facme%2Fchat",
		);
	});

	it("rechaza un dominio externo sin permiso, sin escribir nada", async () => {
		const result = await inviteToTenant({ ...base, email: "ana@gmail.com" });

		expect(result).toEqual({
			kind: "dominio_no_permitido",
			allowedDomains: ["acme.test"],
		});
		expect(state.inserts).toHaveLength(0);
	});

	it("con permiso externo invita y deja el evento de auditoría", async () => {
		const result = await inviteToTenant({
			...base,
			email: "ana@gmail.com",
			allowExternal: true,
		});

		expect(result).toEqual({ kind: "ok" });
		expect(state.inserts.map((i) => i.table)).toEqual([
			"invitations",
			"events",
		]);
		expect(state.inserts[1]?.values).toMatchObject({
			tenant_id: TENANT_ID,
			type: "invitation.external",
		});
	});

	it("contesta duplicada si ya hay una invitación pendiente", async () => {
		state.insertError = { code: "23505" };

		expect(await inviteToTenant(base)).toEqual({ kind: "duplicada" });
		expect(state.invites).toHaveLength(0);
	});

	it("contesta ya_existe si el usuario ya estaba en Auth", async () => {
		state.inviteError = { code: "email_exists", message: "existe" };

		expect(await inviteToTenant(base)).toEqual({ kind: "ya_existe" });
	});

	it("contesta mail_fallo ante otro error del envío", async () => {
		state.inviteError = { message: "smtp caído" };

		expect(await inviteToTenant(base)).toEqual({ kind: "mail_fallo" });
	});

	it("contesta tenant_inexistente sin tenant", async () => {
		state.tenant = null;

		expect(await inviteToTenant(base)).toEqual({ kind: "tenant_inexistente" });
	});
});

describe("sendInvitationMail", () => {
	const params = {
		// biome-ignore lint/suspicious/noExplicitAny: doble de prueba del cliente admin
		admin: admin as any,
		email: "ana@acme.test",
		origin: "https://app.test",
	};

	beforeEach(() => {
		state.inviteError = null;
		state.inserts = [];
		state.invites = [];
	});

	it("manda el mail con el callback del origen", async () => {
		expect(await sendInvitationMail(params)).toBe("ok");
		expect(state.invites).toEqual([
			{ email: "ana@acme.test", redirectTo: "https://app.test/auth/callback" },
		]);
	});

	it("con next, lo lleva codificado en el callback", async () => {
		await sendInvitationMail({ ...params, next: "/acme/chat" });

		expect(state.invites[0].redirectTo).toBe(
			"https://app.test/auth/callback?next=%2Facme%2Fchat",
		);
	});

	it.each(["email_exists", "user_already_exists"])(
		"si la persona ya tiene cuenta (%s) lo dice",
		async (code) => {
			state.inviteError = { code, message: "ya existe" };
			expect(await sendInvitationMail(params)).toBe("ya_existe");
		},
	);

	it("cualquier otro error es un fallo del mail", async () => {
		state.inviteError = { code: "over_email_send_rate_limit", message: "x" };
		expect(await sendInvitationMail(params)).toBe("mail_fallo");
	});

	it("no escribe nada en la base", async () => {
		await sendInvitationMail(params);
		expect(state.inserts).toHaveLength(0);
	});
});
