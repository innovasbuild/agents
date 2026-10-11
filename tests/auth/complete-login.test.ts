import { describe, expect, it } from "vitest";
import { completeLogin } from "@/lib/auth/complete-login";

function client(gate: unknown) {
	const calls: string[] = [];
	return {
		calls,
		rpc: async (fn: string) => {
			calls.push(fn);
			return { data: fn === "login_gate" ? gate : 1, error: null };
		},
		auth: {
			signOut: async () => {
				calls.push("signOut");
				return { error: null };
			},
		},
	};
}

describe("completeLogin", () => {
	it("une membresías y después pasa la compuerta", async () => {
		const supabase = client({ allowed: true, landing: null });
		expect(await completeLogin(supabase)).toEqual({ ok: true });
		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
			"login_gate",
		]);
	});

	it("si la compuerta corta, cierra la sesión y devuelve la landing", async () => {
		const supabase = client({ allowed: false, landing: "acme" });
		expect(await completeLogin(supabase)).toEqual({
			ok: false,
			landing: "/login/acme?error=metodo",
		});
		expect(supabase.calls.at(-1)).toBe("signOut");
	});
});
