import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
	exists: vi.fn(),
	upload: vi.fn(),
	createSignedUrl: vi.fn(),
	from: vi.fn(),
	insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		storage: {
			from: (bucket: string) => {
				storage.from(bucket);
				return {
					exists: storage.exists,
					upload: storage.upload,
					createSignedUrl: storage.createSignedUrl,
				};
			},
		},
		from: () => ({ insert: storage.insert }),
	}),
}));
vi.mock("@/lib/brain/adapters/skills", () => ({
	blobStore: () => ({ get: vi.fn(async () => null), put: vi.fn() }),
}));

import {
	packageIssueEvent,
	packageLinkDeps,
	packageObjects,
} from "@/lib/brain/adapters/skill-packages";

beforeEach(() => vi.clearAllMocks());

describe("packageObjects", () => {
	it("busca, sube y firma en skill-packages bajo <tenant>/<digest>.zip", async () => {
		storage.exists.mockResolvedValue({ data: true, error: null });
		storage.upload.mockResolvedValue({ data: {}, error: null });
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: "https://storage.test/firmado" },
			error: null,
		});
		const objects = packageObjects();
		expect(await objects.exists("t1", "dg")).toBe(true);
		await objects.put("t1", "dg", new Uint8Array([1]));
		const url = await objects.sign("t1", "dg", {
			expiresIn: 600,
			filename: "reporte-v2.zip",
		});

		expect(url).toBe("https://storage.test/firmado");
		expect(
			storage.from.mock.calls.every(([bucket]) => bucket === "skill-packages"),
		).toBe(true);
		expect(storage.exists).toHaveBeenCalledWith("t1/dg.zip");
		expect(storage.upload).toHaveBeenCalledWith(
			"t1/dg.zip",
			new Uint8Array([1]),
			{
				contentType: "application/zip",
				upsert: true,
			},
		);
		expect(storage.createSignedUrl).toHaveBeenCalledWith("t1/dg.zip", 600, {
			download: "reporte-v2.zip",
		});
	});

	it("un tenant firma solo su propio objeto", async () => {
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: "u" },
			error: null,
		});
		await packageObjects().sign("t2", "dg", {
			expiresIn: 60,
			filename: "a-v1.zip",
		});
		expect(storage.createSignedUrl).toHaveBeenCalledWith("t2/dg.zip", 60, {
			download: "a-v1.zip",
		});
	});

	it("si exists da error, lo trata como ausente: se rearma y se sube", async () => {
		storage.exists.mockResolvedValue({
			data: false,
			error: { message: "timeout" },
		});
		expect(await packageObjects().exists("t1", "dg")).toBe(false);
	});

	it("si subir o firmar falla, lanza", async () => {
		storage.upload.mockResolvedValue({
			data: null,
			error: { message: "lleno" },
		});
		storage.createSignedUrl.mockResolvedValue({
			data: null,
			error: { message: "no" },
		});
		await expect(
			packageObjects().put("t1", "dg", new Uint8Array()),
		).rejects.toThrow();
		await expect(
			packageObjects().sign("t1", "dg", { expiresIn: 60, filename: "a.zip" }),
		).rejects.toThrow();
	});
});

describe("packageIssueEvent", () => {
	it("arma el evento con canal, slug y versión", () => {
		expect(
			packageIssueEvent({
				tenantId: "t1",
				userId: "ana",
				channel: "web",
				slug: "skills/ventas/reporte",
				name: "reporte",
				version: 2,
				digest: "dg",
			}),
		).toEqual({
			tenant_id: "t1",
			actor_user_id: "ana",
			channel: "web",
			type: "brain.skill_package_issued",
			summary: "skills/ventas/reporte",
			payload: { name: "reporte", version: 2, digest: "dg" },
		});
	});
});

describe("packageLinkDeps", () => {
	it("el registro inserta en events y lanza con el mensaje de la base si falla", async () => {
		storage.insert.mockResolvedValue({ error: { message: "rls" } });
		const record = {
			tenantId: "t1",
			userId: "ana",
			channel: "mcp" as const,
			slug: "skills/a",
			name: "a",
			version: 1,
			digest: "dg",
		};
		await expect(packageLinkDeps().record(record)).rejects.toThrow("rls");
		expect(storage.insert).toHaveBeenCalledWith(packageIssueEvent(record));
	});
});
