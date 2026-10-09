import { afterEach, describe, expect, it, vi } from "vitest";
import { joinOnLogin } from "@/lib/auth/join-on-login";

function client(results: Record<string, "ok" | "error" | "throw">) {
	const calls: string[] = [];
	return {
		calls,
		rpc: async (fn: string) => {
			calls.push(fn);
			const result = results[fn] ?? "ok";
			if (result === "throw") throw new Error("red caída");
			return { error: result === "error" ? { message: "falló" } : null };
		},
	};
}

describe("joinOnLogin", () => {
	afterEach(() => vi.restoreAllMocks());

	it("acepta invitaciones primero y después une por dominio", async () => {
		const supabase = client({});

		await joinOnLogin(supabase);

		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
		]);
	});

	it("si las invitaciones devuelven error, igual une por dominio", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ accept_pending_invitations: "error" });

		await joinOnLogin(supabase);

		expect(supabase.calls).toContain("join_tenants_by_domain");
	});

	it("si una RPC lanza, la otra corre y no se propaga", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ accept_pending_invitations: "throw" });

		await expect(joinOnLogin(supabase)).resolves.toBeUndefined();
		expect(supabase.calls).toEqual([
			"accept_pending_invitations",
			"join_tenants_by_domain",
		]);
	});

	it("si falla el ingreso por dominio no se propaga", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const supabase = client({ join_tenants_by_domain: "error" });

		await expect(joinOnLogin(supabase)).resolves.toBeUndefined();
	});
});
