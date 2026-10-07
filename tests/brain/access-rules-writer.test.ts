import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseAccessRulesWriter } from "@/lib/brain/core/access/rules-store";

function fakeClient(error: { message: string } | null = null) {
	const rpc = vi.fn(async () => ({ data: null, error }));
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("createSupabaseAccessRulesWriter", () => {
	it("set llama a brain_set_access_rule con los nombres de la función", async () => {
		const { client, rpc } = fakeClient();
		await createSupabaseAccessRulesWriter(client).set(
			"t1",
			{ path: "comercial", principal: "user", userId: "u1", level: "editor" },
			"admin1",
		);
		expect(rpc).toHaveBeenCalledWith("brain_set_access_rule", {
			p_tenant_id: "t1",
			p_path: "comercial",
			p_principal: "user",
			p_user_id: "u1",
			p_level: "editor",
			p_actor: "admin1",
		});
	});

	it("remove llama a brain_remove_access_rule", async () => {
		const { client, rpc } = fakeClient();
		await createSupabaseAccessRulesWriter(client).remove(
			"t1",
			{ path: "", principal: "members", userId: null },
			"admin1",
		);
		expect(rpc).toHaveBeenCalledWith("brain_remove_access_rule", {
			p_tenant_id: "t1",
			p_path: "",
			p_principal: "members",
			p_user_id: null,
			p_actor: "admin1",
		});
	});

	it("si la base falla, lanza: el cambio no se da por hecho", async () => {
		const { client } = fakeClient({ message: "boom" });
		await expect(
			createSupabaseAccessRulesWriter(client).set(
				"t1",
				{ path: "a", principal: "members", userId: null, level: "lector" },
				"admin1",
			),
		).rejects.toThrow(/boom/);
	});
});
