// tests/brain/wiki-store-rules.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
	createSupabaseWikiStore,
	WikiStoreError,
} from "@/lib/brain/core/wiki-store";

type State = {
	table: string;
	eq: Record<string, unknown>;
	like?: [string, string];
	range?: [number, number];
};

// select → eq → like → order → range: range es la última y devuelve la promesa.
function fakeClient(
	batches: Array<Array<Record<string, unknown>>>,
	error: { code: string; message: string; details: string } | null = null,
) {
	const calls: State[] = [];
	let call = 0;
	const client = {
		from(table: string) {
			const state: State = { table, eq: {} };
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					state.eq[column] = value;
					return chain;
				},
				like: (column: string, pattern: string) => {
					state.like = [column, pattern];
					return chain;
				},
				order: () => chain,
				range: async (from: number, to: number) => {
					state.range = [from, to];
					calls.push(state);
					return { data: error ? null : (batches[call++] ?? []), error };
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

const row = (slug: string) => ({
	slug,
	status: "activo",
	revision: 3,
	body: `b ${slug}`,
});

describe("listRulePages", () => {
	it("lee solo las 00-reglas del tenant", async () => {
		const { client, calls } = fakeClient([
			[
				row("00-reglas"),
				row("talento/personal/00-reglas"),
				row("comercial/x00-reglas"),
			],
		]);
		const pages = await createSupabaseWikiStore(client).listRulePages("t1");
		expect(pages).toEqual([
			{ slug: "00-reglas", status: "activo", revision: 3, body: "b 00-reglas" },
			{
				slug: "talento/personal/00-reglas",
				status: "activo",
				revision: 3,
				body: "b talento/personal/00-reglas",
			},
		]);
		expect(calls[0]).toMatchObject({
			table: "brain_pages",
			eq: { tenant_id: "t1" },
			like: ["slug", "%00-reglas"],
			range: [0, 999],
		});
	});

	it("pagina de a 1000 hasta que una tanda viene corta", async () => {
		const full = Array.from({ length: 1000 }, (_, i) => row(`c${i}/00-reglas`));
		const { client, calls } = fakeClient([full, [row("z/00-reglas")]]);
		const pages = await createSupabaseWikiStore(client).listRulePages("t1");
		expect(pages).toHaveLength(1001);
		expect(calls.map((c) => c.range)).toEqual([
			[0, 999],
			[1000, 1999],
		]);
	});

	it("con exactamente 1000 filas pide otra tanda y termina en la vacía", async () => {
		const full = Array.from({ length: 1000 }, (_, i) => row(`c${i}/00-reglas`));
		const { client, calls } = fakeClient([full, []]);
		const pages = await createSupabaseWikiStore(client).listRulePages("t1");
		expect(pages).toHaveLength(1000);
		expect(calls.map((c) => c.range)).toEqual([
			[0, 999],
			[1000, 1999],
		]);
	});

	it("un error de la base sale como WikiStoreError", async () => {
		const { client } = fakeClient([], {
			code: "42P01",
			message: "boom",
			details: "",
		});
		await expect(
			createSupabaseWikiStore(client).listRulePages("t1"),
		).rejects.toBeInstanceOf(WikiStoreError);
	});
});
