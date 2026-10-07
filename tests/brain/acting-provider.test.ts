import { describe, expect, it, vi } from "vitest";
import {
	brainActorFrom,
	resolveActingProvider,
} from "@/lib/brain/adapters/acting-provider";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainBinding } from "@/lib/brain/core/resolve";
import type { BrainProvider } from "@/lib/brain/core/types";

const binding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {},
} as unknown as BrainBinding;

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "x",
	revision: 1,
	updatedAt: "2026-10-01T00:00:00Z",
});

function raw(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(),
		list: vi.fn(async () => [page("comercial/icp"), page("direccion/x")]),
		history: vi.fn(async () => null),
		upsert: vi.fn(),
	};
}

const closeDireccion: AccessRule[] = [
	{ path: "", principal: "members", userId: null, level: "lector" },
	{ path: "direccion", principal: "members", userId: null, level: "ninguno" },
];

describe("brainActorFrom", () => {
	it("una persona sale con su id y su rol", () => {
		expect(
			brainActorFrom({
				principalId: "u1",
				principalType: "user",
				attributes: { role: "tenant_admin" },
			}),
		).toEqual({ userId: "u1", role: "tenant_admin" });
	});

	it("un rol ausente o desconocido es tenant_member, el de menor privilegio", () => {
		expect(
			brainActorFrom({
				principalId: "u1",
				principalType: "user",
				attributes: {},
			}),
		).toEqual({ userId: "u1", role: "tenant_member" });
		expect(
			brainActorFrom({
				principalId: "u1",
				principalType: "user",
				attributes: { role: "root" },
			}),
		).toEqual({ userId: "u1", role: "tenant_member" });
	});

	it("sin persona (corrida desatendida, servicio o nada) no hay actor", () => {
		expect(brainActorFrom(null)).toBeUndefined();
		expect(brainActorFrom(undefined)).toBeUndefined();
		expect(
			brainActorFrom({ principalId: "svc", principalType: "service" }),
		).toBeUndefined();
		expect(brainActorFrom({ principalType: "user" })).toBeUndefined();
	});
});

describe("resolveActingProvider", () => {
	it("sin actor devuelve el proveedor tal cual: el agente desatendido ve todo", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(binding, undefined, {
			provider: () => provider,
			rules,
		});
		expect(result).toBe(provider);
		expect(rules).not.toHaveBeenCalled();
	});

	it("un miembro recibe un proveedor filtrado con las reglas del tenant del binding", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(
			binding,
			{ userId: "ana", role: "tenant_member" },
			{ provider: () => provider, rules },
		);
		expect(rules).toHaveBeenCalledWith("tenant-a");
		expect((await result.list()).map((p) => p.slug)).toEqual(["comercial/icp"]);
	});

	it("un administrador no consulta las reglas", async () => {
		const provider = raw();
		const rules = vi.fn(async () => closeDireccion);
		const result = await resolveActingProvider(
			binding,
			{ userId: "root", role: "tenant_admin" },
			{ provider: () => provider, rules },
		);
		expect(result).toBe(provider);
		expect(rules).not.toHaveBeenCalled();
	});

	it("si las reglas no se pueden cargar, falla cerrado", async () => {
		await expect(
			resolveActingProvider(
				binding,
				{ userId: "ana", role: "tenant_member" },
				{
					provider: raw,
					rules: async () => {
						throw new Error("base caída");
					},
				},
			),
		).rejects.toThrow("base caída");
	});
});
