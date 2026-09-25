import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
	createServerClient: () => ({ auth: { getUser, getClaims } }),
}));

const { verifyCaller } = await import("../../lib/auth/verify-caller");

function request() {
	return new Request("https://app.test/eve/v1/info", {
		headers: { cookie: "sb-local-auth-token=algo" },
	});
}

describe("verifyCaller con tokens del servidor OAuth", () => {
	beforeEach(() => {
		getUser.mockResolvedValue({
			data: { user: { id: "user-1", email: "mati@innov.as" } },
			error: null,
		});
	});

	it("rechaza un token emitido a un cliente OAuth", async () => {
		getClaims.mockResolvedValue({
			data: { claims: { sub: "user-1", client_id: "claude" } },
			error: null,
		});
		expect(await verifyCaller(request())).toBeNull();
	});

	it("acepta una sesión normal del dashboard", async () => {
		getClaims.mockResolvedValue({
			data: { claims: { sub: "user-1" } },
			error: null,
		});
		expect(await verifyCaller(request())).toEqual({
			userId: "user-1",
			email: "mati@innov.as",
		});
	});

	it("devuelve null si no se pueden leer los claims", async () => {
		getClaims.mockResolvedValue({ data: null, error: new Error("x") });
		expect(await verifyCaller(request())).toBeNull();
	});
});
