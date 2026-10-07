import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseAccessRulesStore } from "@/lib/brain/core/access/rules-store";

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(result: Result) {
	const calls: Array<{
		table: string;
		columns: string;
		filters: Record<string, unknown>;
	}> = [];
	const client = {
		from(table: string) {
			const filters: Record<string, unknown> = {};
			let columns = "";
			const chain = {
				select: (value: string) => {
					columns = value;
					return chain;
				},
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: Result) => void) => {
					calls.push({ table, columns, filters: { ...filters } });
					resolve(result);
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

// Value: protects=load devuelve las reglas del tenant pedido mapeadas a AccessRule y descarta filas con valores desconocidos.
// fails_when=se pierde el filtro por tenant_id, se mapea mal user_id a userId, o una fila invalida entra como regla.
// why_new=es el unico lector de brain_access_rules y de ahi depende cada decision de acceso; seam=none
describe("createSupabaseAccessRulesStore.load", () => {
	it("filtra por el tenant y mapea las columnas", async () => {
		const { client, calls } = fakeClient({
			data: [
				{ path: "", principal: "members", user_id: null, level: "lector" },
				{
					path: "direccion",
					principal: "members",
					user_id: null,
					level: "ninguno",
				},
				{
					path: "direccion",
					principal: "user",
					user_id: "cecilia",
					level: "editor",
				},
			],
			error: null,
		});
		const rules = await createSupabaseAccessRulesStore(client).load("tenant-a");
		expect(calls).toEqual([
			{
				table: "brain_access_rules",
				columns: "path, principal, user_id, level",
				filters: { tenant_id: "tenant-a" },
			},
		]);
		expect(rules).toEqual([
			{ path: "", principal: "members", userId: null, level: "lector" },
			{
				path: "direccion",
				principal: "members",
				userId: null,
				level: "ninguno",
			},
			{
				path: "direccion",
				principal: "user",
				userId: "cecilia",
				level: "editor",
			},
		]);
	});

	it("descarta una fila con principal o nivel desconocido, y avisa", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { client } = fakeClient({
			data: [
				{ path: "a", principal: "grupo", user_id: null, level: "lector" },
				{ path: "b", principal: "members", user_id: null, level: "dios" },
				{ path: "c", principal: "members", user_id: null, level: "editor" },
			],
			error: null,
		});
		const rules = await createSupabaseAccessRulesStore(client).load("tenant-a");
		expect(rules).toEqual([
			{ path: "c", principal: "members", userId: null, level: "editor" },
		]);
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("sin filas devuelve una lista vacía", async () => {
		const { client } = fakeClient({ data: null, error: null });
		expect(
			await createSupabaseAccessRulesStore(client).load("tenant-a"),
		).toEqual([]);
	});

	it("si la base falla, falla: nunca se confunde con 'sin reglas'", async () => {
		const { client } = fakeClient({
			data: null,
			error: { message: "permiso denegado" },
		});
		await expect(
			createSupabaseAccessRulesStore(client).load("tenant-a"),
		).rejects.toThrow(/permisos del brain.*permiso denegado/);
	});
});
