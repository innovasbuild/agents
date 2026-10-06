import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseWikiStore } from "@/lib/brain/core/wiki-store";

type Call = { table: string; filters: Record<string, unknown> };

// Imita la cadena de PostgREST: select/eq/order devuelven la cadena, y la
// cadena es "esperable" (devuelve todas las filas) o termina en maybeSingle.
function fakeClient(rows: Record<string, Array<Record<string, unknown>>>) {
	const calls: Call[] = [];
	const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
	const client = {
		rpc: async (name: string, args: Record<string, unknown>) => {
			rpcCalls.push({ name, args });
			return { data: rows[name] ?? [], error: null };
		},
		from(table: string) {
			const filters: Record<string, unknown> = {};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				order: () => chain,
				maybeSingle: async () => {
					calls.push({ table, filters: { ...filters } });
					return { data: rows[table]?.[0] ?? null, error: null };
				},
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: unknown) => void) => {
					calls.push({ table, filters: { ...filters } });
					resolve({ data: rows[table] ?? [], error: null });
				},
			};
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

const pageRow = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: {},
	body: "cuerpo",
	revision: 3,
	updated_at: "2026-10-01T00:00:00Z",
};

describe("createSupabaseWikiStore.list", () => {
	it("filtra por el tenant y mapea las columnas", async () => {
		const { client, calls } = fakeClient({ brain_pages: [pageRow] });
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		expect(calls).toEqual([
			{ table: "brain_pages", filters: { tenant_id: "tenant-a" } },
		]);
		expect(pages).toEqual([
			{
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: ["canon:icp"],
				frontmatter: {},
				body: "cuerpo",
				revision: 3,
				updatedAt: "2026-10-01T00:00:00Z",
			},
		]);
	});
});

describe("createSupabaseWikiStore.listRevisions", () => {
	it("devuelve null si la página no existe", async () => {
		const { client } = fakeClient({ brain_pages: [] });
		expect(
			await createSupabaseWikiStore(client).listRevisions("tenant-a", "nada"),
		).toBeNull();
	});

	it("filtra la página y las revisiones por el tenant", async () => {
		const { client, calls } = fakeClient({
			brain_pages: [{ id: "page-1" }],
			brain_revisions: [
				{
					revision: 2,
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: [],
					frontmatter: {},
					body: "v2",
					author_kind: "user",
					author_user_id: "user-1",
					reason: "ajuste",
					created_at: "2026-10-02T00:00:00Z",
				},
			],
		});
		const revisions = await createSupabaseWikiStore(client).listRevisions(
			"tenant-a",
			"comercial/icp",
		);
		expect(calls).toEqual([
			{
				table: "brain_pages",
				filters: { tenant_id: "tenant-a", slug: "comercial/icp" },
			},
			{
				table: "brain_revisions",
				filters: { tenant_id: "tenant-a", page_id: "page-1" },
			},
		]);
		expect(revisions?.[0]).toMatchObject({
			revision: 2,
			authorKind: "user",
			authorUserId: "user-1",
			reason: "ajuste",
			createdAt: "2026-10-02T00:00:00Z",
		});
	});
});

// Value: protects=read y search mapean columnas a campos igual que list (toPage compartido), con tags y frontmatter
//   nulos como [] y {}, y read filtra por tenant y slug.
// fails_when=un refactor de toPage o del mapeo de search cambia el mapeo columna a campo o suelta el filtro de tenant.
// why_new=solo list y listRevisions estan cubiertos a nivel store; seam=none
describe("createSupabaseWikiStore.read", () => {
	it("filtra por tenant y slug y mapea igual que list", async () => {
		const { client, calls } = fakeClient({ brain_pages: [pageRow] });
		const store = createSupabaseWikiStore(client);
		const page = await store.read("tenant-a", "comercial/icp");
		expect(calls).toEqual([
			{
				table: "brain_pages",
				filters: { tenant_id: "tenant-a", slug: "comercial/icp" },
			},
		]);
		expect(page).toEqual((await store.list("tenant-a"))[0]);
		expect(page).toMatchObject({
			updatedAt: "2026-10-01T00:00:00Z",
			revision: 3,
		});
	});

	it("tags y frontmatter nulos quedan como [] y {}", async () => {
		const { client } = fakeClient({
			brain_pages: [{ ...pageRow, tags: null, frontmatter: null }],
		});
		const page = await createSupabaseWikiStore(client).read("tenant-a", "x");
		expect(page?.tags).toEqual([]);
		expect(page?.frontmatter).toEqual({});
	});

	it("devuelve null si no hay fila", async () => {
		const { client } = fakeClient({ brain_pages: [] });
		expect(
			await createSupabaseWikiStore(client).read("tenant-a", "x"),
		).toBeNull();
	});
});

describe("createSupabaseWikiStore.search", () => {
	it("llama a brain_search_pages con el tenant y mapea las filas a resúmenes", async () => {
		const { client, rpcCalls } = fakeClient({
			brain_search_pages: [
				{
					slug: "comercial/icp",
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: null,
					snippet: null,
					updated_at: "2026-10-01T00:00:00Z",
				},
			],
		});
		const results = await createSupabaseWikiStore(client).search("tenant-a", {
			query: "icp",
		});
		expect(rpcCalls).toEqual([
			{
				name: "brain_search_pages",
				args: {
					p_tenant_id: "tenant-a",
					p_query: "icp",
					p_category: null,
					p_tag: null,
					p_include_archived: false,
					p_limit: 8,
				},
			},
		]);
		expect(results).toEqual([
			{
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				snippet: "",
				updatedAt: "2026-10-01T00:00:00Z",
			},
		]);
	});
});
