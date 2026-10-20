import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn() }));

// Storage falso en memoria: guarda objetos con su fecha de creación y deja
// forzar fallas, así se prueba lo que queda en el bucket y no las llamadas.
const store = vi.hoisted(() => ({
	buckets: [] as string[],
	objects: new Map<string, { createdAt: string | null }>(),
	signed: [] as { path: string; upsert: boolean | undefined }[],
	removed: [] as string[],
	failList: false,
	failRemove: false,
	failSign: false,
	failDownload: false,
}));

function fakeBucket() {
	return {
		async createSignedUploadUrl(path: string, opts?: { upsert: boolean }) {
			if (store.failSign) {
				return { data: null, error: { message: "firmar: boom" } };
			}
			store.signed.push({ path, upsert: opts?.upsert });
			return {
				data: {
					signedUrl: `https://ref.supabase.co/upload/sign/${path}?token=tk`,
					token: "tk",
					path,
				},
				error: null,
			};
		},
		async list(prefix: string) {
			if (store.failList) {
				return { data: null, error: { message: "listar: boom" } };
			}
			const dir = `${prefix.replace(/\/$/, "")}/`;
			const data = [...store.objects]
				.filter(
					([path]) =>
						path.startsWith(dir) && !path.slice(dir.length).includes("/"),
				)
				.map(([path, o]) => ({
					name: path.slice(dir.length),
					created_at: o.createdAt,
					updated_at: o.createdAt,
				}));
			return { data, error: null };
		},
		async remove(paths: string[]) {
			if (store.failRemove) {
				return { data: null, error: { message: "borrar: boom" } };
			}
			for (const path of paths) {
				store.objects.delete(path);
				store.removed.push(path);
			}
			return { data: [], error: null };
		},
		async download(path: string) {
			if (store.failDownload) {
				return { data: null, error: { message: "bajar: boom" } };
			}
			if (!store.objects.has(path)) {
				return { data: null, error: { message: "Object not found" } };
			}
			return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
		},
		async exists(path: string) {
			return { data: store.objects.has(path), error: null };
		},
	};
}

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			db.from(table);
			return { insert: db.insert };
		},
		storage: {
			from: (bucket: string) => {
				store.buckets.push(bucket);
				return fakeBucket();
			},
		},
	}),
}));

import {
	recordSkillImport,
	skillImportEvent,
	uploadStaging,
} from "@/lib/brain/adapters/skill-uploads";
import { UPLOAD_LINK_SECONDS } from "@/lib/brain/core/skills/upload-id";

const entry = {
	tenantId: "t1",
	userId: "ana",
	channel: "web" as const,
	slug: "skills/ventas/reporte",
	mode: "crear" as const,
	files: 3,
};

beforeEach(() => {
	vi.clearAllMocks();
	store.buckets = [];
	store.objects = new Map();
	store.signed = [];
	store.removed = [];
	store.failList = false;
	store.failRemove = false;
	store.failSign = false;
	store.failDownload = false;
});

describe("skillImportEvent", () => {
	it("arma el evento con canal, slug, modo y cantidad de archivos", () => {
		expect(skillImportEvent(entry)).toEqual({
			tenant_id: "t1",
			actor_user_id: "ana",
			channel: "web",
			type: "brain.skill_imported",
			summary: "skills/ventas/reporte",
			payload: { mode: "crear", files: 3 },
		});
	});
});

describe("recordSkillImport", () => {
	it("inserta en events", async () => {
		db.insert.mockResolvedValue({ error: null });
		await recordSkillImport(entry);
		expect(db.from).toHaveBeenCalledWith("events");
		expect(db.insert).toHaveBeenCalledWith(skillImportEvent(entry));
	});

	it("tira solo el mensaje de la base", async () => {
		db.insert.mockResolvedValue({ error: { message: "boom" } });
		await expect(recordSkillImport(entry)).rejects.toThrow("boom");
	});
});

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ID = "lx1abc.Rnd_m-1.ventas~cuentas";
const who = { tenantId: "t1", userId: "u1" };

describe("uploadStaging.issue", () => {
	// Sin upsert: una vez subido, el zip que la persona aprobó en la vista
	// previa no se puede cambiar con la misma URL.
	it("firma exactamente imports/<tenant>/<persona>/<id>.zip sin upsert en skill-packages", async () => {
		const out = await uploadStaging().issue({ ...who, uploadId: ID });
		expect(store.buckets).toContain("skill-packages");
		expect(store.signed).toEqual([
			{ path: `imports/t1/u1/${ID}.zip`, upsert: false },
		]);
		expect(out).toEqual({
			url: `https://ref.supabase.co/upload/sign/imports/t1/u1/${ID}.zip?token=tk`,
			expiresIn: UPLOAD_LINK_SECONDS,
		});
	});

	it("la clave lleva el id entero: misma parte aleatoria con otra carpeta u hora son objetos distintos", async () => {
		const staging = uploadStaging();
		await staging.issue({ ...who, uploadId: "lx1abc.Rnd.ventas" });
		await staging.issue({ ...who, uploadId: "lx1abc.Rnd.rrhh" });
		await staging.issue({ ...who, uploadId: "lx9zzz.Rnd.ventas" });
		const paths = store.signed.map((s) => s.path);
		expect(new Set(paths).size).toBe(3);
		expect(paths).toEqual([
			"imports/t1/u1/lx1abc.Rnd.ventas.zip",
			"imports/t1/u1/lx1abc.Rnd.rrhh.zip",
			"imports/t1/u1/lx9zzz.Rnd.ventas.zip",
		]);
	});

	it.each([
		"a/b.c.d",
		"../x.y.z",
		"a..b.c.d",
		"..",
		"",
		"con espacio.a.b",
		"a\\b.c.d",
		"x".repeat(301),
	])("rechaza el uploadId %j antes de tocar Storage", async (uploadId) => {
		await expect(uploadStaging().issue({ ...who, uploadId })).rejects.toThrow();
		expect(store.buckets).toEqual([]);
		expect(store.signed).toEqual([]);
	});

	it("borra solo los objetos viejos (más de 24 h) de esa persona y deja los recientes", async () => {
		store.objects.set("imports/t1/u1/viejo.a.b.zip", {
			createdAt: ago(25 * HOUR),
		});
		store.objects.set("imports/t1/u1/reciente.a.b.zip", {
			createdAt: ago(23 * HOUR),
		});
		store.objects.set("imports/t1/u2/ajeno-viejo.a.b.zip", {
			createdAt: ago(30 * HOUR),
		});
		store.objects.set("imports/t2/u1/otro-tenant-viejo.a.b.zip", {
			createdAt: ago(30 * HOUR),
		});
		await uploadStaging().issue({ ...who, uploadId: ID });
		expect(store.removed).toEqual(["imports/t1/u1/viejo.a.b.zip"]);
		expect([...store.objects.keys()].sort()).toEqual([
			"imports/t1/u1/reciente.a.b.zip",
			"imports/t1/u2/ajeno-viejo.a.b.zip",
			"imports/t2/u1/otro-tenant-viejo.a.b.zip",
		]);
	});

	it("sigue emitiendo aunque el listado falle, y loguea solo el mensaje", async () => {
		store.failList = true;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const out = await uploadStaging().issue({ ...who, uploadId: ID });
		expect(out.expiresIn).toBe(UPLOAD_LINK_SECONDS);
		expect(store.signed).toHaveLength(1);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0].every((a) => typeof a === "string")).toBe(true);
		spy.mockRestore();
	});

	it("sigue emitiendo aunque el borrado falle", async () => {
		store.objects.set("imports/t1/u1/viejo.a.b.zip", {
			createdAt: ago(48 * HOUR),
		});
		store.failRemove = true;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await uploadStaging().issue({ ...who, uploadId: ID });
		expect(store.signed).toHaveLength(1);
		expect(spy.mock.calls[0].every((a) => typeof a === "string")).toBe(true);
		spy.mockRestore();
	});

	it("tira solo el mensaje si no puede firmar", async () => {
		store.failSign = true;
		await expect(
			uploadStaging().issue({ ...who, uploadId: ID }),
		).rejects.toThrow("firmar: boom");
	});
});

describe("uploadStaging.read y remove", () => {
	it("read devuelve los bytes del objeto del id exacto", async () => {
		store.objects.set(`imports/t1/u1/${ID}.zip`, { createdAt: ago(HOUR) });
		const bytes = await uploadStaging().read({ ...who, uploadId: ID });
		expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
	});

	it("read devuelve null si el objeto no existe (también el de otra persona)", async () => {
		store.objects.set(`imports/t1/u2/${ID}.zip`, { createdAt: ago(HOUR) });
		expect(await uploadStaging().read({ ...who, uploadId: ID })).toBeNull();
	});

	it("read tira si la descarga falla con el objeto presente", async () => {
		store.objects.set(`imports/t1/u1/${ID}.zip`, { createdAt: ago(HOUR) });
		store.failDownload = true;
		await expect(
			uploadStaging().read({ ...who, uploadId: ID }),
		).rejects.toThrow("bajar: boom");
	});

	it("read rechaza un uploadId inválido sin tocar Storage", async () => {
		await expect(
			uploadStaging().read({ ...who, uploadId: "../x.y.z" }),
		).rejects.toThrow();
		expect(store.buckets).toEqual([]);
	});

	it("remove borra la ruta exacta", async () => {
		store.objects.set(`imports/t1/u1/${ID}.zip`, { createdAt: ago(HOUR) });
		store.objects.set("imports/t1/u1/otro.a.b.zip", { createdAt: ago(HOUR) });
		await uploadStaging().remove({ ...who, uploadId: ID });
		expect(store.removed).toEqual([`imports/t1/u1/${ID}.zip`]);
		expect(store.objects.has("imports/t1/u1/otro.a.b.zip")).toBe(true);
	});

	it("remove rechaza un uploadId inválido", async () => {
		await expect(
			uploadStaging().remove({ ...who, uploadId: "a/b.c.d" }),
		).rejects.toThrow();
		expect(store.removed).toEqual([]);
	});
});

describe("frontera del canal MCP", () => {
	it("skill-uploads.ts y sus imports relativos no cargan next/* ni @/lib/tenants", () => {
		const root = fileURLToPath(
			new URL("../../lib/brain/adapters", import.meta.url),
		);
		const seen = new Set<string>();
		const pending = [join(root, "skill-uploads.ts")];
		const bad: string[] = [];
		while (pending.length) {
			const file = pending.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			const source = readFileSync(file, "utf8");
			for (const m of source.matchAll(
				/(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
			)) {
				const spec = m[1];
				if (/^next(\/|$)/.test(spec) || /(^|\/)tenants(\/|$)/.test(spec)) {
					bad.push(`${file}: ${spec}`);
				}
				if (spec.startsWith(".")) pending.push(join(dirname(file), spec));
			}
		}
		expect(bad).toEqual([]);
		expect(seen.size).toBeGreaterThan(1);
	});
});
