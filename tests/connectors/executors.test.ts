import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Una sola tabla `executors` en memoria, compartida por el que ESCRIBE
// (markGmailAuthorized, vía el admin client mockeado) y el que LEE
// (createSupabaseOutreachStore, el código real del store). Sin esto, cada lado
// se testea contra su propio doble y la desconexión entre ambos —la que dejó
// el barrido sin ejecutores en producción— no la levanta ningún test.
const db = vi.hoisted(() => ({ executors: [] as Record<string, unknown>[] }));

type Filter = (row: Record<string, unknown>) => boolean;

/** Lo mínimo de PostgREST que usan las queries reales del store sobre
 * `executors`: select().eq().not(col, "is", null), esperable con await. */
function selectQuery(rows: Record<string, unknown>[], filters: Filter[] = []) {
	const query = {
		eq(column: string, value: unknown) {
			return selectQuery(rows, [...filters, (row) => row[column] === value]);
		},
		not(column: string, operator: string, value: unknown) {
			if (operator !== "is" || value !== null)
				throw new Error(`not(${operator}) no está simulado`);
			return selectQuery(rows, [
				...filters,
				(row) => row[column] !== null && row[column] !== undefined,
			]);
		},
		// biome-ignore lint/suspicious/noThenProperty: el thenable es el punto: las queries reales del store hacen `await client.from().select()...`.
		then(
			resolve: (result: {
				data: Record<string, unknown>[];
				error: null;
			}) => unknown,
		) {
			return resolve({
				data: rows.filter((row) => filters.every((f) => f(row))),
				error: null,
			});
		},
	};
	return query;
}

function fakeClient() {
	return {
		from(table: string) {
			if (table !== "executors") throw new Error(`tabla ${table} no simulada`);
			return {
				upsert: async (
					values: Record<string, unknown>,
					options: Record<string, unknown>,
				) => {
					calls.upserts.push([values, options]);
					const key = `${values.tenant_id}|${values.user_id}`;
					const existing = db.executors.find(
						(row) => `${row.tenant_id}|${row.user_id}` === key,
					);
					if (existing) Object.assign(existing, values);
					else db.executors.push({ ...values });
					return { error: null };
				},
				select: (_columns: string) => selectQuery(db.executors),
			};
		},
	};
}

const calls = vi.hoisted(() => ({ upserts: [] as unknown[][] }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => fakeClient(),
}));

const { markGmailAuthorized } = await import("@/lib/connectors/executors");
const { createSupabaseOutreachStore } = await import("@/lib/outreach/store");

beforeEach(() => {
	calls.upserts = [];
	db.executors = [];
});

describe("markGmailAuthorized", () => {
	it("hace upsert por tenant y usuario con la fecha", async () => {
		await markGmailAuthorized("tenant-a", "user-1");
		const [values, options] = calls.upserts[0] as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(values).toMatchObject({ tenant_id: "tenant-a", user_id: "user-1" });
		expect(typeof values.gmail_authorized_at).toBe("string");
		expect(options).toEqual({ onConflict: "tenant_id,user_id" });
	});

	// El bug de la Etapa 5: el barrido filtra por `gmail_read_authorized_at` y
	// nadie la escribía, así que `listExecutorsWithGmailRead` devolvía cero
	// filas todas las mañanas, sin un solo error. El test corre el escritor
	// real contra el lector real: si vuelven a escribir una columna y a filtrar
	// por otra, esto se pone rojo.
	it("deja al ejecutor visible para el barrido (escritor y lector reales)", async () => {
		await markGmailAuthorized("tenant-a", "user-1");

		const store = createSupabaseOutreachStore(
			fakeClient() as unknown as SupabaseClient,
		);
		const executors = await store.listExecutorsWithGmailRead("tenant-a");

		expect(executors.map((e) => e.userId)).toEqual(["user-1"]);
	});

	it("estampa las dos columnas: el grant de Gmail trae envío y lectura juntos", async () => {
		await markGmailAuthorized("tenant-a", "user-1");
		const [values] = calls.upserts[0] as [Record<string, unknown>];
		expect(typeof values.gmail_authorized_at).toBe("string");
		expect(typeof values.gmail_read_authorized_at).toBe("string");
	});
});
