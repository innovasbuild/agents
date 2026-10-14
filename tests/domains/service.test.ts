import { describe, expect, it, vi } from "vitest";
import {
	addDomain,
	type DomainDeps,
	type DomainRow,
	type DomainStore,
	refreshDomain,
	removeDomain,
	setPrimaryDomain,
	sweepVerifyingDomains,
	verifyDomain,
} from "@/lib/domains/service";
import type { AuthRedirects } from "@/lib/domains/supabase-auth";
import {
	type DomainConfig,
	type ProjectDomain,
	VercelApiError,
	type VercelDomains,
} from "@/lib/domains/vercel";
import { rootHostsFromEnv } from "@/lib/tenants/host";

const ROOTS = rootHostsFromEnv({
	PUBLIC_APP_URL: "https://agentes.innov.as",
	NODE_ENV: "production",
});
const TENANT = "tenant-okeefe";

function memoryStore(initial: Partial<DomainRow>[] = []) {
	let seq = 0;
	const rows = new Map<string, DomainRow>();
	const make = (p: Partial<DomainRow>): DomainRow => {
		seq += 1;
		return {
			id: `d${seq}`,
			tenantId: TENANT,
			hostname: `h${seq}.okeefe.com.ar`,
			isPrimary: false,
			status: "pending",
			lastError: null,
			verifiedAt: null,
			createdAt: `2026-10-14T00:00:0${seq}Z`,
			...p,
		};
	};
	for (const p of initial) {
		const r = make(p);
		rows.set(r.id, r);
	}
	const store: DomainStore = {
		list: async (tenantId) =>
			[...rows.values()].filter((r) => r.tenantId === tenantId),
		get: async (id) => rows.get(id) ?? null,
		listVerifying: async (limit) =>
			[...rows.values()]
				.filter((r) => r.status === "verifying")
				.slice(0, limit),
		activeHostnames: async () =>
			[...rows.values()]
				.filter((r) => r.status === "active")
				.map((r) => r.hostname),
		insert: async ({ tenantId, hostname, createdBy: _c }) => {
			if ([...rows.values()].some((r) => r.hostname === hostname)) {
				return { ok: false, reason: "duplicate" };
			}
			const row = make({ tenantId, hostname });
			rows.set(row.id, row);
			return { ok: true, row };
		},
		update: async (id, patch) => {
			const r = rows.get(id);
			if (r) rows.set(id, { ...r, ...patch });
		},
		clearPrimary: async (tenantId) => {
			for (const [id, r] of rows) {
				if (r.tenantId === tenantId) rows.set(id, { ...r, isPrimary: false });
			}
		},
		remove: async (id) => {
			rows.delete(id);
		},
	};
	return { store, rows };
}

function fakeVercel(over: Partial<VercelDomains> = {}) {
	const domain = (verified = true): ProjectDomain => ({
		name: "x",
		verified,
		verification: [],
	});
	const config: DomainConfig = {
		configuredBy: "CNAME",
		misconfigured: false,
		recommendedCname: "cname.vercel-dns.com.",
	};
	const api = {
		add: vi.fn(async () => domain()),
		get: vi.fn(async () => domain()),
		verify: vi.fn(async () => domain()),
		remove: vi.fn(async () => undefined),
		config: vi.fn(async () => config),
		...over,
	} satisfies VercelDomains;
	return api;
}

function fakeRedirects(initial: string[] = []) {
	let list = [...initial];
	const redirects: AuthRedirects = {
		read: async () => [...list],
		write: async (next) => {
			list = [...next];
		},
	};
	return { redirects, current: () => list };
}

function deps(
	over: Partial<DomainDeps> & { store?: DomainStore } = {},
): DomainDeps {
	return {
		store: memoryStore().store,
		vercel: fakeVercel(),
		redirects: fakeRedirects().redirects,
		roots: ROOTS,
		production: true,
		now: () => new Date("2026-10-14T12:00:00Z"),
		...over,
	};
}

describe("addDomain", () => {
	it("con el DNS ya listo queda activo, principal y en las Redirect URLs", async () => {
		const m = memoryStore();
		const r = fakeRedirects();
		const result = await addDomain(
			deps({ store: m.store, redirects: r.redirects }),
			{ tenantId: TENANT, rawHostname: "AI.Okeefe.com.ar", actorUserId: "u1" },
		);
		expect(result.ok).toBe(true);
		const [row] = [...m.rows.values()];
		expect(row).toMatchObject({
			hostname: "ai.okeefe.com.ar",
			status: "active",
			isPrimary: true,
			lastError: null,
			verifiedAt: "2026-10-14T12:00:00.000Z",
		});
		expect(r.current()).toEqual(["https://ai.okeefe.com.ar/auth/callback**"]);
	});

	it("si el DNS todavía no está queda en verifying con el motivo", async () => {
		const m = memoryStore();
		const vercel = fakeVercel({
			config: vi.fn(async () => ({
				configuredBy: null,
				misconfigured: true,
				recommendedCname: "cname.vercel-dns.com.",
			})),
		});
		const result = await addDomain(deps({ store: m.store, vercel }), {
			tenantId: TENANT,
			rawHostname: "ai.okeefe.com.ar",
			actorUserId: null,
		});
		expect(result.ok).toBe(true);
		const [row] = [...m.rows.values()];
		expect(row?.status).toBe("verifying");
		expect(row?.lastError).toMatch(/registro DNS/);
		expect(row?.isPrimary).toBe(false);
	});

	it("rechaza un dominio inválido o de la plataforma sin tocar Vercel", async () => {
		const vercel = fakeVercel();
		const m = memoryStore();
		for (const raw of ["agentes.innov.as", "okeefe", "ai.innov.as"]) {
			const out = await addDomain(deps({ store: m.store, vercel }), {
				tenantId: TENANT,
				rawHostname: raw,
				actorUserId: null,
			});
			expect(out.ok, raw).toBe(false);
		}
		expect(vercel.add).not.toHaveBeenCalled();
		expect(m.rows.size).toBe(0);
	});

	it("un dominio que ya está cargado no se duplica", async () => {
		const m = memoryStore([{ hostname: "ai.okeefe.com.ar", status: "active" }]);
		const out = await addDomain(deps({ store: m.store }), {
			tenantId: "otra",
			rawHostname: "ai.okeefe.com.ar",
			actorUserId: null,
		});
		expect(out).toEqual({ ok: false, message: "Ese dominio ya está cargado." });
	});

	it("un dominio de otro proyecto de Vercel queda failed con el motivo", async () => {
		const m = memoryStore();
		const vercel = fakeVercel({
			add: vi.fn(async () => {
				throw new VercelApiError(
					"in_use",
					409,
					"Ese dominio ya está en otro proyecto de Vercel.",
				);
			}),
		});
		const out = await addDomain(deps({ store: m.store, vercel }), {
			tenantId: TENANT,
			rawHostname: "ai.okeefe.com.ar",
			actorUserId: null,
		});
		expect(out.ok).toBe(false);
		expect([...m.rows.values()][0]).toMatchObject({
			status: "failed",
			lastError: "Ese dominio ya está en otro proyecto de Vercel.",
		});
	});

	it("una falla transitoria de Vercel deja el dominio en pending para reintentar", async () => {
		const m = memoryStore();
		const vercel = fakeVercel({
			add: vi.fn(async () => {
				throw new VercelApiError(
					"unavailable",
					503,
					"Vercel no respondió. Probá de nuevo.",
				);
			}),
		});
		await addDomain(deps({ store: m.store, vercel }), {
			tenantId: TENANT,
			rawHostname: "ai.okeefe.com.ar",
			actorUserId: null,
		});
		expect([...m.rows.values()][0]?.status).toBe("pending");
	});

	it("sin la API de Vercel configurada avisa y no carga nada", async () => {
		const m = memoryStore();
		const out = await addDomain(deps({ store: m.store, vercel: null }), {
			tenantId: TENANT,
			rawHostname: "ai.okeefe.com.ar",
			actorUserId: null,
		});
		expect(out).toMatchObject({ ok: false });
		expect(out.message).toMatch(/VERCEL_API_TOKEN/);
		expect(m.rows.size).toBe(0);
	});
});

describe("refreshDomain", () => {
	it("sin verificar la propiedad pide el registro TXT", async () => {
		const m = memoryStore([
			{ hostname: "ai.okeefe.com.ar", status: "verifying" },
		]);
		const vercel = fakeVercel({
			get: vi.fn(async () => ({
				name: "x",
				verified: false,
				verification: [],
			})),
			verify: vi.fn(async () => ({
				name: "x",
				verified: false,
				verification: [],
			})),
		});
		const row = [...m.rows.values()][0] as DomainRow;
		const out = await refreshDomain(deps({ store: m.store, vercel }), row);
		expect(out.ok).toBe(false);
		expect(m.rows.get(row.id)?.lastError).toMatch(/TXT/);
		expect(m.rows.get(row.id)?.status).toBe("verifying");
	});

	it("si Supabase no acepta la entrada NO lo activa", async () => {
		const m = memoryStore([
			{ hostname: "ai.okeefe.com.ar", status: "verifying" },
		]);
		const row = [...m.rows.values()][0] as DomainRow;
		const redirects: AuthRedirects = {
			read: async () => [],
			write: async () => {
				throw new Error("boom");
			},
		};
		const out = await refreshDomain(deps({ store: m.store, redirects }), row);
		expect(out.ok).toBe(false);
		expect(m.rows.get(row.id)?.status).toBe("verifying");
		expect(m.rows.get(row.id)?.lastError).toMatch(/Supabase Auth/);
	});

	it("sin la API de Supabase configurada tampoco lo activa", async () => {
		const m = memoryStore([
			{ hostname: "ai.okeefe.com.ar", status: "verifying" },
		]);
		const row = [...m.rows.values()][0] as DomainRow;
		const out = await refreshDomain(
			deps({ store: m.store, redirects: null }),
			row,
		);
		expect(out.ok).toBe(false);
		expect(m.rows.get(row.id)?.status).toBe("verifying");
		expect(m.rows.get(row.id)?.lastError).toMatch(/SUPABASE_ACCESS_TOKEN/);
	});

	it("el segundo dominio activo no le saca el primario al primero", async () => {
		const m = memoryStore([
			{ hostname: "a.okeefe.com.ar", status: "active", isPrimary: true },
			{ hostname: "b.okeefe.com.ar", status: "verifying" },
		]);
		const second = [...m.rows.values()][1] as DomainRow;
		await refreshDomain(deps({ store: m.store }), second);
		expect(m.rows.get(second.id)).toMatchObject({
			status: "active",
			isPrimary: false,
		});
	});

	it("la lista de redirects conserva los dominios ya activos", async () => {
		const m = memoryStore([
			{ hostname: "a.okeefe.com.ar", status: "active", isPrimary: true },
			{ hostname: "b.okeefe.com.ar", status: "verifying" },
		]);
		const r = fakeRedirects(["https://manual.test/**"]);
		const second = [...m.rows.values()][1] as DomainRow;
		await refreshDomain(
			deps({ store: m.store, redirects: r.redirects }),
			second,
		);
		expect(r.current()).toEqual([
			"https://manual.test/**",
			"https://a.okeefe.com.ar/auth/callback**",
			"https://b.okeefe.com.ar/auth/callback**",
		]);
	});
});

describe("verifyDomain / setPrimaryDomain", () => {
	it("verifyDomain de un dominio que no existe avisa", async () => {
		expect(await verifyDomain(deps(), "nope")).toEqual({
			ok: false,
			message: "No existe ese dominio.",
		});
	});

	it("solo un dominio activo puede ser el principal", async () => {
		const m = memoryStore([{ status: "verifying" }]);
		const out = await setPrimaryDomain(deps({ store: m.store }), "d1");
		expect(out.ok).toBe(false);
	});

	it("cambiar el principal deja uno solo", async () => {
		const m = memoryStore([
			{ status: "active", isPrimary: true },
			{ status: "active" },
		]);
		await setPrimaryDomain(deps({ store: m.store }), "d2");
		expect(
			[...m.rows.values()].filter((r) => r.isPrimary).map((r) => r.id),
		).toEqual(["d2"]);
	});
});

describe("removeDomain", () => {
	it("lo quita de Vercel, de la base y de las Redirect URLs, y promueve otro principal", async () => {
		const m = memoryStore([
			{ hostname: "a.okeefe.com.ar", status: "active", isPrimary: true },
			{ hostname: "b.okeefe.com.ar", status: "active" },
		]);
		const vercel = fakeVercel();
		const r = fakeRedirects([
			"https://manual.test/**",
			"https://a.okeefe.com.ar/auth/callback**",
			"https://b.okeefe.com.ar/auth/callback**",
		]);
		const out = await removeDomain(
			deps({ store: m.store, vercel, redirects: r.redirects }),
			"d1",
		);
		expect(out.ok).toBe(true);
		expect(vercel.remove).toHaveBeenCalledWith("a.okeefe.com.ar");
		expect(m.rows.has("d1")).toBe(false);
		expect(m.rows.get("d2")?.isPrimary).toBe(true);
		expect(r.current()).toEqual([
			"https://manual.test/**",
			"https://b.okeefe.com.ar/auth/callback**",
		]);
	});

	it("si Vercel no responde, no borra la fila", async () => {
		const m = memoryStore([{ hostname: "a.okeefe.com.ar", status: "active" }]);
		const vercel = fakeVercel({
			remove: vi.fn(async () => {
				throw new VercelApiError(
					"unavailable",
					503,
					"Vercel no respondió. Probá de nuevo.",
				);
			}),
		});
		const out = await removeDomain(deps({ store: m.store, vercel }), "d1");
		expect(out.ok).toBe(false);
		expect(m.rows.has("d1")).toBe(true);
	});

	it("si falla Supabase igual quita el dominio y lo avisa", async () => {
		const m = memoryStore([{ hostname: "a.okeefe.com.ar", status: "active" }]);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const redirects: AuthRedirects = {
			read: async () => {
				throw new Error("caído");
			},
			write: async () => undefined,
		};
		const out = await removeDomain(deps({ store: m.store, redirects }), "d1");
		expect(out.ok).toBe(true);
		expect(out.message).toMatch(/Redirect URLs/);
		expect(m.rows.has("d1")).toBe(false);
		error.mockRestore();
	});

	it("sin la API de Vercel quita la fila y avisa que falta quitarlo a mano", async () => {
		const m = memoryStore([{ hostname: "a.okeefe.com.ar", status: "failed" }]);
		const out = await removeDomain(
			deps({ store: m.store, vercel: null }),
			"d1",
		);
		expect(out.ok).toBe(true);
		expect(out.message).toMatch(/quitalo a mano/);
	});
});

describe("sweepVerifyingDomains", () => {
	it("revisa los que esperan DNS, activa los que ya están y sigue si uno falla", async () => {
		const m = memoryStore([
			{ hostname: "a.okeefe.com.ar", status: "verifying" },
			{ hostname: "b.okeefe.com.ar", status: "verifying" },
			{ hostname: "c.okeefe.com.ar", status: "active", isPrimary: true },
		]);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const vercel = fakeVercel({
			get: vi.fn(async (h: string) => {
				if (h === "a.okeefe.com.ar") throw new Error("explotó");
				return { name: h, verified: true, verification: [] };
			}),
		});
		const out = await sweepVerifyingDomains(deps({ store: m.store, vercel }));
		expect(out).toEqual({ checked: 2, activated: 1 });
		expect(m.rows.get("d2")?.status).toBe("active");
		error.mockRestore();
	});

	it("sin Vercel configurado no hace nada", async () => {
		const m = memoryStore([{ status: "verifying" }]);
		expect(
			await sweepVerifyingDomains(deps({ store: m.store, vercel: null })),
		).toEqual({ checked: 0, activated: 0 });
	});
});
