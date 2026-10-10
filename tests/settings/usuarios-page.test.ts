import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const state: {
	tenant: unknown;
	memberships: unknown[];
	invitations: unknown[];
	blocks: unknown[];
} = { tenant: null, memberships: [], invitations: [], blocks: [] };

// Consulta encadenable que resuelve al hacer await, como la de supabase-js.
function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) =>
			query(() => ({
				data:
					table === "memberships"
						? state.memberships
						: table === "invitations"
							? state.invitations
							: state.blocks,
				error: null,
			})),
	}),
}));
vi.mock("@/lib/tenants/people", () => ({
	loadPeople: async (ids: string[]) =>
		new Map(
			ids.map((id) => [id, { name: `Nombre ${id}`, email: `${id}@a.test` }]),
		),
}));
vi.mock("@/app/[tenant]/settings/usuarios/actions", () => ({
	revokeMembership: async () => ({ ok: true }),
	revokeInvitation: async () => ({ ok: true }),
	changeMemberRole: async () => ({ ok: true }),
	blockMember: async () => ({ ok: true }),
	unblockMember: async () => ({ ok: true }),
	resendInvitation: async () => ({ ok: true }),
}));
vi.mock("@/app/[tenant]/settings/usuarios/invite-form", () => ({
	InviteForm: () => null,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));

const { default: UsuariosPage } = await import(
	"@/app/[tenant]/settings/usuarios/page"
);

const tenant = (role: string, userId = "yo") => ({
	id: "t1",
	slug: "acme",
	displayName: "Acme",
	role,
	userId,
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
});

const render = async () =>
	renderToStaticMarkup(
		await UsuariosPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

/** El <li> de la persona con ese correo. */
const rowOf = (html: string, email: string) =>
	html.split("<li").find((li) => li.includes(email)) ?? "";

describe("página de usuarios", () => {
	beforeEach(() => {
		state.tenant = tenant("tenant_admin");
		state.memberships = [
			{ id: "m-yo", role: "tenant_admin", user_id: "yo" },
			{ id: "m-ana", role: "tenant_member", user_id: "ana" },
			{ id: "m-plat", role: "platform_admin", user_id: "plat" },
		];
		state.invitations = [
			{
				id: "i1",
				email: "nueva@a.test",
				role: "tenant_member",
				expires_at: "2026-11-01T00:00:00Z",
			},
		];
		state.blocks = [];
	});

	it("un miembro común recibe 404", async () => {
		state.tenant = tenant("tenant_member");
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("un miembro tiene selector de rol, Sacar y Bloquear", async () => {
		const row = rowOf(await render(), "ana@a.test");

		expect(row).toContain("<select");
		expect(row).toContain("Sacar");
		expect(row).toContain("Bloquear");
	});

	it("la propia fila no ofrece Bloquear", async () => {
		const row = rowOf(await render(), "yo@a.test");

		expect(row).toContain("<select");
		expect(row).not.toContain("Bloquear");
	});

	it("un administrador de la plataforma muestra el rol como texto, sin selector ni Bloquear", async () => {
		const row = rowOf(await render(), "plat@a.test");

		expect(row).toContain("Administrador de la plataforma");
		expect(row).not.toContain("<select");
		expect(row).not.toContain("Bloquear");
	});

	it("una invitación pendiente ofrece Reenviar y Revocar", async () => {
		const row = rowOf(await render(), "nueva@a.test");

		expect(row).toContain("Reenviar");
		expect(row).toContain("Revocar");
	});

	it("sin bloqueados no aparece la sección", async () => {
		expect(await render()).not.toContain("Bloqueados");
	});

	it("con bloqueados los lista con Desbloquear", async () => {
		state.blocks = [
			{ tenant_id: "t1", user_id: "beto", created_at: "2026-10-09T12:00:00Z" },
		];
		const html = await render();

		expect(html).toContain("Bloqueados");
		const row = rowOf(html, "beto@a.test");
		expect(row).toContain("Nombre beto");
		expect(row).toContain("Desbloquear");
	});
});
