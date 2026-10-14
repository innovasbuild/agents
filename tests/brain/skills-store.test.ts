import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseSkillStore } from "@/lib/brain/core/skills/store";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function clientWith(rpc: ReturnType<typeof vi.fn>) {
	return { rpc } as unknown as SupabaseClient;
}

describe("createSupabaseSkillStore", () => {
	it("overview llama a brain_skill_overview y arma el último acto", async () => {
		const rpc = vi.fn(async () => ({
			data: [
				{
					page_id: "p1",
					slug: "skills/a",
					revision: 3,
					draft_files_digest: "d1",
					action: "publicar",
					version: 2,
					page_revision: 3,
					files_digest: "d1",
					title: "A",
					description: "desc",
					body: "cuerpo",
					frontmatter: { description: "desc" },
					manifest: [{ path: "a.py", sha256: "x", size: 1 }],
					digest: "dg",
					published_at: "2026-10-11T00:00:00Z",
				},
				{
					page_id: "p2",
					slug: "skills/b",
					revision: 1,
					draft_files_digest: "d0",
					action: null,
				},
			],
			error: null,
		}));
		const rows = await createSupabaseSkillStore(clientWith(rpc)).overview("t1");
		expect(rpc).toHaveBeenCalledWith("brain_skill_overview", {
			p_tenant_id: "t1",
		});
		expect(rows[0].current?.version).toBe(2);
		expect(rows[0].current?.manifest).toEqual([
			{ path: "a.py", sha256: "x", size: 1 },
		]);
		expect(rows[1]).toEqual({
			pageId: "p2",
			slug: "skills/b",
			revision: 1,
			draftFilesDigest: "d0",
			current: null,
		});
	});

	it("publish pasa los argumentos exactos y devuelve versión y hash", async () => {
		const rpc = vi.fn(async () => ({
			data: [{ skill_version: 4, skill_digest: "dg" }],
			error: null,
		}));
		const out = await createSupabaseSkillStore(clientWith(rpc)).publish({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: 7,
			expectedFilesDigest: "fd",
			note: "nota",
			actorUserId: "u1",
			fromVersion: null,
		});
		expect(rpc).toHaveBeenCalledWith("brain_publish_skill", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_expected_revision: 7,
			p_expected_files_digest: "fd",
			p_note: "nota",
			p_actor: "u1",
			p_from_version: null,
		});
		expect(out).toEqual({ version: 4, digest: "dg" });
	});

	it("putFile, removeFile y withdraw usan sus funciones", async () => {
		const rpc = vi.fn(async (name: string) => ({
			data: name === "brain_withdraw_skill" ? true : "digest",
			error: null,
		}));
		const store = createSupabaseSkillStore(clientWith(rpc));
		await store.putFile({
			tenantId: "t1",
			pageId: "p1",
			path: "a.py",
			sha256: "x",
			size: 3,
			actorUserId: "u1",
		});
		expect(rpc).toHaveBeenLastCalledWith("brain_skill_put_file", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_path: "a.py",
			p_sha256: "x",
			p_size: 3,
			p_actor: "u1",
		});
		await store.removeFile({
			tenantId: "t1",
			pageId: "p1",
			path: "a.py",
			actorUserId: "u1",
		});
		expect(rpc).toHaveBeenLastCalledWith("brain_skill_remove_file", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_path: "a.py",
			p_actor: "u1",
		});
		expect(
			await store.withdraw({
				tenantId: "t1",
				pageId: "p1",
				note: "n",
				actorUserId: "u1",
			}),
		).toBe(true);
		expect(rpc).toHaveBeenLastCalledWith("brain_withdraw_skill", {
			p_tenant_id: "t1",
			p_page_id: "p1",
			p_note: "n",
			p_actor: "u1",
		});
	});

	it("un error de la base sale como WikiStoreError con código y detalle", async () => {
		const rpc = vi.fn(async () => ({
			data: null,
			error: { code: "BR409", message: "BRAIN_CONFLICT", details: "name" },
		}));
		await expect(
			createSupabaseSkillStore(clientWith(rpc)).publish({
				tenantId: "t1",
				pageId: "p1",
				expectedRevision: 1,
				expectedFilesDigest: "fd",
				note: "n",
				actorUserId: "u1",
				fromVersion: null,
			}),
		).rejects.toMatchObject({
			name: "WikiStoreError",
			code: "BR409",
			details: "name",
		});
		expect(WikiStoreError).toBeDefined();
	});
});
