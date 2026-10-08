import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabasePageDeleter } from "@/lib/brain/core/delete-store";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function fakeClient(result: {
	data?: unknown;
	error?: { code?: string; message: string; details?: string | null } | null;
}) {
	const rpc = vi.fn(async () => ({ data: null, error: null, ...result }));
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const params = {
	tenantId: "t1",
	slug: "comercial/icp",
	expectedRevision: 4,
	actorUserId: "u1",
	bindingId: "b1",
	cleanups: [{ slug: "legal/contrato", baseRevision: 2, body: "limpio" }],
};

describe("createSupabasePageDeleter", () => {
	it("llama a brain_delete_page con los nombres de la función y devuelve los conteos", async () => {
		const { client, rpc } = fakeClient({
			data: [{ deleted_revisions: 5, cleaned: 1, rules_removed: 2 }],
		});
		const outcome = await createSupabasePageDeleter(client).delete(params);
		expect(rpc).toHaveBeenCalledWith("brain_delete_page", {
			p_tenant_id: "t1",
			p_slug: "comercial/icp",
			p_expected_revision: 4,
			p_actor: "u1",
			p_binding_id: "b1",
			p_cleanups: [
				{ slug: "legal/contrato", base_revision: 2, body: "limpio" },
			],
		});
		expect(outcome).toEqual({
			deletedRevisions: 5,
			cleaned: 1,
			rulesRemoved: 2,
		});
	});

	it("traduce un error de la base a WikiStoreError con su código", async () => {
		const { client } = fakeClient({
			error: { code: "BR409", message: "BRAIN_CONFLICT", details: "5" },
		});
		const error = await createSupabasePageDeleter(client)
			.delete(params)
			.catch((e) => e);
		expect(error).toBeInstanceOf(WikiStoreError);
		expect(error.code).toBe("BR409");
		expect(error.details).toBe("5");
	});

	it("si la base no devuelve fila, lanza: no se da el borrado por hecho", async () => {
		const { client } = fakeClient({ data: [] });
		await expect(
			createSupabasePageDeleter(client).delete(params),
		).rejects.toThrow();
	});

	it("manda las limpiezas ordenadas por slug (evita deadlocks) sin mutar la entrada", async () => {
		const { client, rpc } = fakeClient({
			data: [{ deleted_revisions: 1, cleaned: 2, rules_removed: 0 }],
		});
		const cleanups = [
			{ slug: "z/ultima", baseRevision: 1, body: "b" },
			{ slug: "a/primera", baseRevision: 3, body: "a" },
		];
		await createSupabasePageDeleter(client).delete({ ...params, cleanups });
		const sent = (rpc.mock.calls[0] as unknown[])[1] as {
			p_cleanups: Array<{ slug: string }>;
		};
		expect(sent.p_cleanups.map((c) => c.slug)).toEqual([
			"a/primera",
			"z/ultima",
		]);
		expect(cleanups.map((c) => c.slug)).toEqual(["z/ultima", "a/primera"]);
	});
});
