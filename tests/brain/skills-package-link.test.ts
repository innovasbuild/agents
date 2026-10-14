import { describe, expect, it, vi } from "vitest";
import {
	type PackageEntry,
	parseSkillMd,
	planImport,
} from "@/lib/brain/core/skills/files";
import {
	issuePackageLink,
	type PackageLinkDeps,
	type PackageRequest,
	publishedEntries,
} from "@/lib/brain/core/skills/package-link";
import type { SkillSnapshot } from "@/lib/brain/core/skills/store";

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

function snapshot(over: Partial<SkillSnapshot> = {}): SkillSnapshot {
	return {
		action: "publicar",
		version: 3,
		pageRevision: 5,
		filesDigest: "fd",
		title: "Propuesta",
		description: "Arma la propuesta comercial.",
		body: "# Pasos",
		frontmatter: { description: "Arma la propuesta comercial." },
		manifest: [
			{ path: "scripts/armar.py", sha256: "sha-script", size: 6 },
			{ path: "assets/plantilla.pptx", sha256: "sha-plantilla", size: 3 },
		],
		digest: "dg",
		publishedAt: "2026-10-14T12:00:00Z",
		...over,
	};
}

function request(over: Partial<PackageRequest> = {}): PackageRequest {
	return {
		tenantId: "t1",
		userId: "ana",
		channel: "mcp",
		slug: "skills/ventas/propuesta",
		snapshot: snapshot(),
		...over,
	};
}

function deps(over: Partial<PackageLinkDeps> = {}) {
	const blobs: Record<string, Uint8Array> = {
		"t1/sha-script": bytes("print()"),
		"t1/sha-plantilla": new Uint8Array([0x50, 0x4b, 0x03]),
	};
	const objects = {
		exists: vi.fn(async (_tenantId: string, _digest: string) => false),
		put: vi.fn(
			async (_tenantId: string, _digest: string, _zip: Uint8Array) => {},
		),
		sign: vi.fn(async () => "https://storage.test/firmado"),
	};
	const base = {
		objects,
		blob: vi.fn(
			async (tenantId: string, sha: string) =>
				blobs[`${tenantId}/${sha}`] ?? null,
		),
		zip: vi.fn((_entries: PackageEntry[]) => new Uint8Array([1, 2, 3])),
		record: vi.fn(async () => {}),
	};
	return { ...base, ...over } as typeof base;
}

describe("publishedEntries", () => {
	it("arma la carpeta con SKILL.md y los archivos publicados, binarios incluidos", async () => {
		const d = deps();
		const entries = await publishedEntries("propuesta", snapshot(), (sha) =>
			d.blob("t1", sha),
		);
		expect(entries.map((entry) => entry.path)).toEqual([
			"propuesta/SKILL.md",
			"propuesta/scripts/armar.py",
			"propuesta/assets/plantilla.pptx",
		]);
		expect(parseSkillMd(decode(entries[0].bytes))).toMatchObject({
			description: "Arma la propuesta comercial.",
			body: "# Pasos",
		});
		expect([...entries[2].bytes]).toEqual([0x50, 0x4b, 0x03]);
	});

	it("lo armado se puede volver a importar", async () => {
		const d = deps();
		const entries = await publishedEntries("propuesta", snapshot(), (sha) =>
			d.blob("t1", sha),
		);
		const plan = planImport(entries);
		if (!plan.ok) throw new Error(plan.problems.join(" "));
		expect(plan.skill.description).toBe("Arma la propuesta comercial.");
		expect(plan.files.map((file) => file.path)).toEqual([
			"scripts/armar.py",
			"assets/plantilla.pptx",
		]);
	});

	it("si falta un blob, lanza: no entrega un paquete incompleto", async () => {
		await expect(
			publishedEntries("propuesta", snapshot(), async () => null),
		).rejects.toThrow();
	});
});

describe("issuePackageLink", () => {
	it("la primera vez arma el zip, lo sube por digest y devuelve el link de 10 minutos por MCP", async () => {
		const d = deps();
		const link = await issuePackageLink(request(), d);
		expect(link).toEqual({
			name: "propuesta",
			version: 3,
			filename: "propuesta-v3.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		});
		expect(d.objects.exists).toHaveBeenCalledWith("t1", "dg");
		expect(d.zip).toHaveBeenCalledOnce();
		expect(d.objects.put).toHaveBeenCalledWith(
			"t1",
			"dg",
			new Uint8Array([1, 2, 3]),
		);
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 600,
			filename: "propuesta-v3.zip",
		});
	});

	it("si el zip ya está guardado no lee ningún archivo ni vuelve a subir", async () => {
		const d = deps();
		d.objects.exists.mockResolvedValue(true);
		await issuePackageLink(request(), d);
		expect(d.blob).not.toHaveBeenCalled();
		expect(d.zip).not.toHaveBeenCalled();
		expect(d.objects.put).not.toHaveBeenCalled();
	});

	it("una versión republicada con el mismo contenido comparte el zip pero se descarga con su número", async () => {
		const d = deps();
		d.objects.exists.mockResolvedValue(true);
		const link = await issuePackageLink(
			request({ snapshot: snapshot({ version: 4 }) }),
			d,
		);
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 600,
			filename: "propuesta-v4.zip",
		});
		expect(link.filename).toBe("propuesta-v4.zip");
	});

	it("por web el link dura 60 segundos", async () => {
		const d = deps();
		const link = await issuePackageLink(request({ channel: "web" }), d);
		expect(link.expiresIn).toBe(60);
		expect(d.objects.sign).toHaveBeenCalledWith("t1", "dg", {
			expiresIn: 60,
			filename: "propuesta-v3.zip",
		});
	});

	it("registra quién pidió el link, por qué canal y qué versión", async () => {
		const d = deps();
		await issuePackageLink(request({ channel: "web" }), d);
		expect(d.record).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "ana",
			channel: "web",
			slug: "skills/ventas/propuesta",
			name: "propuesta",
			version: 3,
			digest: "dg",
		});
	});

	it("si el registro falla, el link se entrega igual", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const d = deps({
			record: vi.fn(async () => {
				throw new Error("events caída");
			}),
		});
		const link = await issuePackageLink(request(), d);
		expect(link.url).toBe("https://storage.test/firmado");
		spy.mockRestore();
	});

	it("si el almacén falla, lanza y no firma", async () => {
		const d = deps();
		d.objects.put.mockRejectedValue(new Error("storage caído"));
		await expect(issuePackageLink(request(), d)).rejects.toThrow(
			"storage caído",
		);
		expect(d.objects.sign).not.toHaveBeenCalled();
		expect(d.record).not.toHaveBeenCalled();
	});
});
