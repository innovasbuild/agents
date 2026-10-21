import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
	createSupabaseWikiStore,
	WikiStoreError,
} from "@/lib/brain/core/wiki-store";

type Call = { table: string; filters: Record<string, unknown> };

// Imita la cadena de PostgREST: select/eq/order/range devuelven la cadena, y la
// cadena es "esperable" (devuelve todas las filas) o termina en maybeSingle.
// Corta cada respuesta en maxRows como hace el servidor (1000 por defecto, el
// max_rows de supabase/config.toml), con o sin range. `ranges` y `orders`
// guardan, por consulta que terminó, el rango pedido y la columna de orden;
// `rpcRanges` y `rpcOrders` hacen lo mismo con las llamadas a rpc. Un rpc que
// recibe `p_after` responde por keyset (keysetSlice) en lugar de por rango.
// `afterQuery(n)` corre después de resolver la consulta número n (de a una, entre
// tablas y rpc) y puede mutar `rows` o `errors` para simular lo que pasa entre dos
// páginas (una inserción concurrente, una falla de la base).
type DbError = { code: string; message: string; details: string | null };

function rangeSlice(
	all: Array<Record<string, unknown>>,
	range: [number, number] | null,
	maxRows: number,
) {
	const [from, to] = range ?? [0, Number.POSITIVE_INFINITY];
	return all.slice(from, Math.min(to + 1, from + maxRows));
}

// Imita brain_page_links_after: slug > p_after (nulo o vacío = desde el
// principio), orden por slug, a lo sumo p_limit, y encima el corte de max_rows.
function keysetSlice(
	all: Array<Record<string, unknown>>,
	args: Record<string, unknown>,
	maxRows: number,
) {
	const after = (args.p_after as string | null) ?? "";
	return all
		.filter((row) => String(row.slug) > after)
		.sort((a, b) => (String(a.slug) < String(b.slug) ? -1 : 1))
		.slice(0, Math.min(Number(args.p_limit), maxRows));
}

function fakeClient(
	rows: Record<string, Array<Record<string, unknown>>>,
	errors: Record<string, DbError> = {},
	{
		maxRows = 1000,
		afterQuery,
	}: { maxRows?: number; afterQuery?: (queryNumber: number) => void } = {},
) {
	let queries = 0;
	const calls: Call[] = [];
	const ranges: Array<[number, number] | null> = [];
	const orders: Array<string | null> = [];
	const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
	const rpcRanges: Array<[number, number] | null> = [];
	const rpcOrders: Array<string | null> = [];
	const selects: Array<string | undefined> = [];
	const client = {
		// Igual que from(): la cadena del rpc es esperable y acepta order y range.
		rpc(name: string, args: Record<string, unknown>) {
			let range: [number, number] | null = null;
			let orderBy: string | null = null;
			const chain = {
				order: (column: string) => {
					orderBy = column;
					return chain;
				},
				range: (from: number, to: number) => {
					range = [from, to];
					return chain;
				},
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: unknown) => void) => {
					rpcCalls.push({ name, args });
					rpcRanges.push(range);
					rpcOrders.push(orderBy);
					const data =
						"p_after" in args
							? keysetSlice(rows[name] ?? [], args, maxRows)
							: rangeSlice(rows[name] ?? [], range, maxRows);
					resolve({ data, error: errors[name] ?? null });
					afterQuery?.(++queries);
				},
			};
			return chain;
		},
		from(table: string) {
			const filters: Record<string, unknown> = {};
			let range: [number, number] | null = null;
			let orderBy: string | null = null;
			const chain = {
				select: (columns?: string) => {
					selects.push(columns);
					return chain;
				},
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				order: (column: string) => {
					orderBy = column;
					return chain;
				},
				range: (from: number, to: number) => {
					range = [from, to];
					return chain;
				},
				maybeSingle: async () => {
					calls.push({ table, filters: { ...filters } });
					return {
						data: errors[table] ? null : (rows[table]?.[0] ?? null),
						error: errors[table] ?? null,
					};
				},
				// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
				then: (resolve: (value: unknown) => void) => {
					calls.push({ table, filters: { ...filters } });
					ranges.push(range);
					orders.push(orderBy);
					const [from, to] = range ?? [0, Number.POSITIVE_INFINITY];
					const data = (rows[table] ?? []).slice(
						from,
						Math.min(to + 1, from + maxRows),
					);
					resolve({
						data: errors[table] ? null : data,
						error: errors[table] ?? null,
					});
					afterQuery?.(++queries);
				},
			};
			return chain;
		},
	};
	return {
		client: client as unknown as SupabaseClient,
		calls,
		rpcCalls,
		rpcRanges,
		rpcOrders,
		selects,
		ranges,
		orders,
	};
}

function pagesRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		...pageRow,
		slug: `p/${String(i).padStart(5, "0")}`,
	}));
}

function linksRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		slug: `p/${String(i).padStart(5, "0")}`,
		links: [{ target: "marketing/voz", anchor: null, alias: null }],
	}));
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

// Value: protects=listMeta devuelve todas las paginas del tenant aunque PostgREST corte cada respuesta en max_rows,
//   y no depende de que max_rows sea 1000 (avanza por las filas recibidas y corta en la respuesta vacia).
// fails_when=listMeta vuelve a un select sin paginar (trunca en 1000) o corta cuando una respuesta viene corta.
// why_new=un brain de mas de 1.000 paginas llegaba truncado al arbol, al indice y al mapa; seam=none
describe("createSupabaseWikiStore.listMeta · paginado", () => {
	it("listMeta devuelve 1.001 páginas", async () => {
		const { client } = fakeClient({ brain_pages: pagesRows(1001) });
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(metas).toHaveLength(1001);
		expect(metas[1000].slug).toBe("p/01000");
	});

	it("listMeta devuelve 2.500 páginas", async () => {
		const { client } = fakeClient({ brain_pages: pagesRows(2500) });
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(metas).toHaveLength(2500);
		expect(new Set(metas.map((m) => m.slug)).size).toBe(2500);
	});

	it("listMeta sigue completo si el servidor corta en 500 por respuesta", async () => {
		const { client } = fakeClient(
			{ brain_pages: pagesRows(1200) },
			{},
			{ maxRows: 500 },
		);
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(metas).toHaveLength(1200);
		expect(new Set(metas.map((m) => m.slug)).size).toBe(1200);
	});

	it("listMeta con exactamente 1.000 páginas hace una consulta más y termina", async () => {
		const { client, calls } = fakeClient({ brain_pages: pagesRows(1000) });
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(metas).toHaveLength(1000);
		expect(calls).toHaveLength(2);
	});

	it("listMeta pide siempre order por slug y filtra por tenant", async () => {
		const { client, calls, orders, ranges } = fakeClient({
			brain_pages: pagesRows(1001),
		});
		await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(calls.length).toBeGreaterThan(1);
		for (const call of calls) {
			expect(call).toEqual({
				table: "brain_pages",
				filters: { tenant_id: "tenant-a" },
			});
		}
		expect(orders.every((column) => column === "slug")).toBe(true);
		expect(ranges).toEqual([
			[0, 999],
			[1000, 1999],
			[1001, 2000],
		]);
	});
});

// Value: protects=list devuelve todas las paginas del tenant, con cuerpo, aunque PostgREST corte cada respuesta en max_rows,
//   y no depende de que max_rows sea 1000 (avanza por las filas recibidas y corta en la respuesta vacia).
// fails_when=list vuelve a un select sin paginar (trunca en 1000) o repite un slug que una insercion concurrente corrio de pagina.
// why_new=la limpieza al borrar una carpeta y la administracion por MCP dejaban de ver las paginas pasada la fila 1.000; seam=none
describe("createSupabaseWikiStore.list · paginado", () => {
	it("list devuelve 1.001 páginas con su cuerpo", async () => {
		const { client } = fakeClient({ brain_pages: pagesRows(1001) });
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		expect(pages).toHaveLength(1001);
		expect(pages[1000].slug).toBe("p/01000");
		expect(pages[1000].body).toBe("cuerpo");
	});

	it("list devuelve 2.500 páginas", async () => {
		const { client } = fakeClient({ brain_pages: pagesRows(2500) });
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		expect(pages).toHaveLength(2500);
		expect(new Set(pages.map((p) => p.slug)).size).toBe(2500);
	});

	it("list sigue completo si el servidor corta en 500 por respuesta", async () => {
		const { client } = fakeClient(
			{ brain_pages: pagesRows(1200) },
			{},
			{ maxRows: 500 },
		);
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		expect(pages).toHaveLength(1200);
		expect(new Set(pages.map((p) => p.slug)).size).toBe(1200);
	});

	it("list pide siempre order por slug y filtra por tenant", async () => {
		const { client, calls, orders, ranges } = fakeClient({
			brain_pages: pagesRows(1001),
		});
		await createSupabaseWikiStore(client).list("tenant-a");
		for (const call of calls) {
			expect(call).toEqual({
				table: "brain_pages",
				filters: { tenant_id: "tenant-a" },
			});
		}
		expect(orders.every((column) => column === "slug")).toBe(true);
		expect(ranges).toEqual([
			[0, 999],
			[1000, 1999],
			[1001, 2000],
		]);
	});

	it("list no repite el slug que una inserción concurrente corre a la página siguiente", async () => {
		const rows = pagesRows(1500);
		const { client } = fakeClient(
			{ brain_pages: rows },
			{},
			{
				afterQuery: (n) => {
					if (n === 1) rows.unshift({ ...pageRow, slug: "a/recien-insertada" });
				},
			},
		);
		const pages = await createSupabaseWikiStore(client).list("tenant-a");
		const slugs = pages.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs).toHaveLength(1500);
	});
});

const dbError: DbError = {
	code: "42501",
	message: "permiso denegado",
	details: null,
};

// Value: protects=listLinks devuelve las filas de todas las paginas con links pidiendo por keyset (p_after = ultimo slug recibido),
//   aunque PostgREST corte cada respuesta del rpc en max_rows, y sin depender de que max_rows sea 1000 (corta en la respuesta vacia).
// fails_when=listLinks vuelve a paginar por offset sobre brain_page_links (costo cuadratico), avanza por PAGE_SIZE en lugar del
//   ultimo slug recibido, corta cuando una respuesta viene corta, o devuelve las paginas con "[[" sin links validos.
// why_new=con offset cada llamada extraia los links de todos los cuerpos del tenant (15 s a 20.000 paginas); seam=none
describe("createSupabaseWikiStore.listLinks · keyset", () => {
	it("listLinks llama brain_page_links_after con p_after nulo la primera vez y el último slug recibido después", async () => {
		const { client, rpcCalls, rpcRanges, rpcOrders } = fakeClient({
			brain_page_links_after: linksRows(1001),
		});
		await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(rpcCalls).toEqual([
			{
				name: "brain_page_links_after",
				args: { p_tenant_id: "tenant-a", p_after: null, p_limit: 1000 },
			},
			{
				name: "brain_page_links_after",
				args: { p_tenant_id: "tenant-a", p_after: "p/00999", p_limit: 1000 },
			},
			{
				name: "brain_page_links_after",
				args: { p_tenant_id: "tenant-a", p_after: "p/01000", p_limit: 1000 },
			},
		]);
		// Sin offset: el rango lo fija p_limit en la base, no el cliente. El order
		// asegura que, si max_rows corta, lleguen los slugs más chicos.
		expect(rpcRanges.every((range) => range === null)).toBe(true);
		expect(rpcOrders.every((column) => column === "slug")).toBe(true);
	});

	it("listLinks devuelve las filas de 2.500 páginas", async () => {
		const { client } = fakeClient({ brain_page_links_after: linksRows(2500) });
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links).toHaveLength(2500);
		expect(links.map((l) => l.slug)).toEqual(
			linksRows(2500).map((r) => r.slug),
		);
	});

	it("listLinks sigue completo si el servidor corta en 500", async () => {
		const { client, rpcCalls } = fakeClient(
			{ brain_page_links_after: linksRows(1200) },
			{},
			{ maxRows: 500 },
		);
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links).toHaveLength(1200);
		expect(new Set(links.map((l) => l.slug)).size).toBe(1200);
		expect(rpcCalls.map((c) => c.args.p_after)).toEqual([
			null,
			"p/00499",
			"p/00999",
			"p/01199",
		]);
	});

	it("listLinks corta con una respuesta vacía", async () => {
		const { client, rpcCalls } = fakeClient({
			brain_page_links_after: linksRows(1000),
		});
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links).toHaveLength(1000);
		// La página llena no corta: hace falta la respuesta vacía.
		expect(rpcCalls).toHaveLength(2);
	});

	it("listLinks sin páginas con links hace una sola llamada", async () => {
		const { client, rpcCalls } = fakeClient({});
		expect(await createSupabaseWikiStore(client).listLinks("tenant-a")).toEqual(
			[],
		);
		expect(rpcCalls).toHaveLength(1);
	});

	it("listLinks no repite slugs", async () => {
		const rows = linksRows(1500);
		const { client } = fakeClient(
			{ brain_page_links_after: rows },
			{},
			{
				// Una página nueva antes del cursor no corre las filas siguientes.
				afterQuery: (n) => {
					if (n === 1)
						rows.unshift({ slug: "a/recien-insertada", links: rows[0].links });
				},
			},
		);
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		const slugs = links.map((l) => l.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs).toEqual(linksRows(1500).map((r) => r.slug));
	});

	it("listLinks avanza por las páginas con [[ sin links válidos y no las devuelve", async () => {
		// La base acota antes de extraer: una página con "[[" suelto vuelve con
		// links nulo y cuenta para el cursor, aunque no sea una fila del resultado.
		const rows = [
			...Array.from({ length: 1000 }, (_, i) => ({
				slug: `a/${String(i).padStart(5, "0")}`,
				links: null,
			})),
			...linksRows(3),
		];
		const { client, rpcCalls } = fakeClient({ brain_page_links_after: rows });
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links.map((l) => l.slug)).toEqual(["p/00000", "p/00001", "p/00002"]);
		expect(rpcCalls.map((c) => c.args.p_after)).toEqual([
			null,
			"a/00999",
			"p/00002",
		]);
	});

	it("listLinks propaga un error de la primera página", async () => {
		const { client } = fakeClient({}, { brain_page_links_after: dbError });
		const result = createSupabaseWikiStore(client).listLinks("tenant-a");
		await expect(result).rejects.toBeInstanceOf(WikiStoreError);
		await expect(result).rejects.toMatchObject({ code: "42501" });
	});

	it("listLinks propaga un error de una página posterior", async () => {
		const errors: Record<string, DbError> = {};
		const { client } = fakeClient(
			{ brain_page_links_after: linksRows(2500) },
			errors,
			{
				afterQuery: (n) => {
					if (n === 1) errors.brain_page_links_after = dbError;
				},
			},
		);
		const result = createSupabaseWikiStore(client).listLinks("tenant-a");
		await expect(result).rejects.toBeInstanceOf(WikiStoreError);
		await expect(result).rejects.toMatchObject({ code: "42501" });
	});
});

// Lo que devuelve supabase-js cuando la función no está en el schema cache de
// PostgREST (la migración keyset sin aplicar) y lo que devuelve Postgres si la
// llamada llega igual a la base.
const rpcMissing: DbError = {
	code: "PGRST202",
	message:
		"Could not find the function public.brain_page_links_after(p_after, p_limit, p_tenant_id) in the schema cache",
	details:
		"Searched for the function public.brain_page_links_after with parameters p_after, p_limit, p_tenant_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
};
const undefinedFunction: DbError = {
	code: "42883",
	message:
		"function public.brain_page_links_after(uuid, text, integer) does not exist",
	details: null,
};

// Value: protects=listLinks sigue andando si el código llega a producción antes que la migración de brain_page_links_after:
//   cae al rpc viejo brain_page_links paginado por offset, devuelve los mismos links, y no paga una llamada fallida por pedido.
// fails_when=listLinks tira cuando falta la función (todo /brain y /mapa en 500), el fallback se traga un error real de la base,
//   el store vuelve a probar el rpc keyset en cada pedido dentro del TTL, o el camino feliz llama también al rpc viejo.
// why_new=el orden de deploy (código antes que migración) dejaba caído el brain de todos los tenants wiki; seam=none
describe("createSupabaseWikiStore.listLinks · fallback sin la migración keyset", () => {
	it("con PGRST202 cae a brain_page_links paginado y devuelve los mismos links", async () => {
		const { client, rpcCalls, rpcRanges, rpcOrders } = fakeClient(
			{ brain_page_links: linksRows(1001) },
			{ brain_page_links_after: rpcMissing },
		);
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links).toHaveLength(1001);
		expect(links[0]).toEqual({
			slug: "p/00000",
			links: [{ target: "marketing/voz", anchor: null, alias: null }],
		});
		expect(rpcCalls.map((c) => c.name)).toEqual([
			"brain_page_links_after",
			"brain_page_links",
			"brain_page_links",
			"brain_page_links",
		]);
		expect(rpcCalls[1].args).toEqual({ p_tenant_id: "tenant-a" });
		expect(rpcRanges.slice(1)).toEqual([
			[0, 999],
			[1000, 1999],
			[1001, 2000],
		]);
		expect(rpcOrders.slice(1).every((column) => column === "slug")).toBe(true);
	});

	it("con 42883 también cae al rpc viejo", async () => {
		const { client, rpcCalls } = fakeClient(
			{ brain_page_links: linksRows(3) },
			{ brain_page_links_after: undefinedFunction },
		);
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(links.map((l) => l.slug)).toEqual(["p/00000", "p/00001", "p/00002"]);
		expect(rpcCalls.map((c) => c.name)).toEqual([
			"brain_page_links_after",
			"brain_page_links",
			"brain_page_links",
		]);
	});

	it.each([
		{ code: "XX000", message: "internal error", details: null },
		{ code: "", message: "TypeError: fetch failed", details: null },
		dbError,
	])(
		"otro error ($code) tira WikiStoreError y no llama al rpc viejo",
		async (error) => {
			const { client, rpcCalls } = fakeClient(
				{ brain_page_links: linksRows(3) },
				{ brain_page_links_after: error },
			);
			const result = createSupabaseWikiStore(client).listLinks("tenant-a");
			await expect(result).rejects.toBeInstanceOf(WikiStoreError);
			await expect(result).rejects.toMatchObject({ code: error.code });
			expect(rpcCalls.map((c) => c.name)).toEqual(["brain_page_links_after"]);
		},
	);

	it("dentro del TTL el mismo store no vuelve a probar el rpc keyset; pasado el TTL, sí", async () => {
		vi.useFakeTimers();
		try {
			const { client, rpcCalls } = fakeClient(
				{ brain_page_links: linksRows(3) },
				{ brain_page_links_after: rpcMissing },
			);
			const store = createSupabaseWikiStore(client);
			await store.listLinks("tenant-a");
			rpcCalls.length = 0;

			vi.advanceTimersByTime(59_000);
			expect(await store.listLinks("tenant-b")).toHaveLength(3);
			expect(rpcCalls.map((c) => c.name)).toEqual([
				"brain_page_links",
				"brain_page_links",
			]);
			rpcCalls.length = 0;

			vi.advanceTimersByTime(2_000);
			await store.listLinks("tenant-a");
			expect(rpcCalls[0].name).toBe("brain_page_links_after");
		} finally {
			vi.useRealTimers();
		}
	});

	it("un store nuevo vuelve a probar el rpc keyset", async () => {
		const { client, rpcCalls } = fakeClient(
			{ brain_page_links: linksRows(3) },
			{ brain_page_links_after: rpcMissing },
		);
		await createSupabaseWikiStore(client).listLinks("tenant-a");
		rpcCalls.length = 0;
		await createSupabaseWikiStore(client).listLinks("tenant-a");
		expect(rpcCalls[0].name).toBe("brain_page_links_after");
	});

	it("con la migración aplicada nunca llama al rpc viejo", async () => {
		const { client, rpcCalls } = fakeClient({
			brain_page_links_after: linksRows(1500),
			brain_page_links: linksRows(1500),
		});
		const store = createSupabaseWikiStore(client);
		await store.listLinks("tenant-a");
		await store.listLinks("tenant-a");
		expect(rpcCalls.every((c) => c.name === "brain_page_links_after")).toBe(
			true,
		);
	});
});

// Value: protects=listMeta no devuelve un slug dos veces ni pierde el orden cuando una inserción concurrente corre las filas entre dos páginas,
//   y listMeta y list propagan el error de la base venga en la primera página o en una posterior (listLinks: bloque keyset).
// fails_when=fetchAllPages deja de deduplicar por slug (el árbol y el índice reciben una página repetida) o se traga el error de una página posterior.
// why_new=con paginación por offset, una fila insertada antes del offset repite la última fila de la página anterior; seam=none
describe("createSupabaseWikiStore · paginado con cambios y errores entre páginas", () => {
	it("listMeta no repite el slug que una inserción concurrente corre a la página siguiente", async () => {
		const rows = pagesRows(1500);
		const { client } = fakeClient(
			{ brain_pages: rows },
			{},
			{
				// Se inserta una fila al principio: la fila 999 pasa a la posición 1000.
				afterQuery: (n) => {
					if (n === 1) rows.unshift({ ...pageRow, slug: "a/recien-insertada" });
				},
			},
		);
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		const slugs = metas.map((m) => m.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs).toHaveLength(1500);
		expect(slugs.slice(0, 1000)).toEqual(pagesRows(1000).map((r) => r.slug));
		expect(slugs[1000]).toBe("p/01000");
	});

	it("listMeta propaga el error de la primera página", async () => {
		const { client } = fakeClient({}, { brain_pages: dbError });
		await expect(
			createSupabaseWikiStore(client).listMeta("tenant-a"),
		).rejects.toBeInstanceOf(WikiStoreError);
	});

	it("listMeta propaga el error de una página posterior", async () => {
		const errors: Record<string, DbError> = {};
		const { client } = fakeClient({ brain_pages: pagesRows(2500) }, errors, {
			afterQuery: (n) => {
				if (n === 1) errors.brain_pages = dbError;
			},
		});
		await expect(
			createSupabaseWikiStore(client).listMeta("tenant-a"),
		).rejects.toMatchObject({ code: "42501" });
	});

	it("list propaga el error de una página posterior", async () => {
		const errors: Record<string, DbError> = {};
		const { client } = fakeClient({ brain_pages: pagesRows(2500) }, errors, {
			afterQuery: (n) => {
				if (n === 1) errors.brain_pages = dbError;
			},
		});
		await expect(
			createSupabaseWikiStore(client).list("tenant-a"),
		).rejects.toMatchObject({ code: "42501" });
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

// Value: protects=list y listRevisions lanzan WikiStoreError cuando la base devuelve error, y una falla al buscar
//   la pagina no cae a null (que el editor leeria como "no existe").
// fails_when=se traga el error y se devuelve [] o null, o el store deja de propagar el codigo de la base.
// why_new=los tests existentes solo usan error: null, asi que esas ramas nunca corrian; seam=none
describe("createSupabaseWikiStore · errores de la base", () => {
	const dbError: DbError = {
		code: "42501",
		message: "permiso denegado",
		details: null,
	};

	it("listMeta no pide el cuerpo ni el frontmatter y filtra por tenant", async () => {
		const { client, calls, selects } = fakeClient({ brain_pages: [pageRow] });
		const metas = await createSupabaseWikiStore(client).listMeta("tenant-a");
		expect(calls[0].filters).toEqual({ tenant_id: "tenant-a" });
		expect(selects[0]).not.toMatch(/body|frontmatter/);
		expect(metas).toEqual([
			{
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: ["canon:icp"],
				revision: pageRow.revision,
				updatedAt: pageRow.updated_at,
			},
		]);
		expect(metas[0]).not.toHaveProperty("body");
	});

	it("listLinks pide brain_page_links_after del tenant y normaliza como parseWikilinks", async () => {
		const { client, rpcCalls } = fakeClient({
			brain_page_links_after: [
				{
					slug: "comercial/icp",
					links: [
						{ target: " marketing/voz ", anchor: "#tono ", alias: " la voz " },
						{ target: "marketing/mensajes", anchor: null, alias: null },
						{ target: "marketing/otro", anchor: "#", alias: "" },
					],
				},
			],
		});
		const links = await createSupabaseWikiStore(client).listLinks("tenant-a");
		// Una página de datos y la consulta vacía que cierra el paginado.
		expect(rpcCalls).toEqual([
			{
				name: "brain_page_links_after",
				args: { p_tenant_id: "tenant-a", p_after: null, p_limit: 1000 },
			},
			{
				name: "brain_page_links_after",
				args: {
					p_tenant_id: "tenant-a",
					p_after: "comercial/icp",
					p_limit: 1000,
				},
			},
		]);
		expect(links).toEqual([
			{
				slug: "comercial/icp",
				links: [
					{ target: "marketing/voz", anchor: "tono", alias: "la voz" },
					{ target: "marketing/mensajes", anchor: null, alias: null },
					{ target: "marketing/otro", anchor: null, alias: null },
				],
			},
		]);
	});

	it("list propaga el error de la base", async () => {
		const { client } = fakeClient({}, { brain_pages: dbError });
		const rejection = createSupabaseWikiStore(client).list("tenant-a");
		await expect(rejection).rejects.toBeInstanceOf(WikiStoreError);
		await expect(rejection).rejects.toMatchObject({ code: "42501" });
	});

	it("listRevisions propaga un error al buscar la pagina y no devuelve null", async () => {
		const { client } = fakeClient({}, { brain_pages: dbError });
		await expect(
			createSupabaseWikiStore(client).listRevisions(
				"tenant-a",
				"comercial/icp",
			),
		).rejects.toBeInstanceOf(WikiStoreError);
	});

	it("listRevisions propaga un error al leer las revisiones", async () => {
		const { client } = fakeClient(
			{ brain_pages: [{ id: "page-1" }] },
			{ brain_revisions: dbError },
		);
		await expect(
			createSupabaseWikiStore(client).listRevisions(
				"tenant-a",
				"comercial/icp",
			),
		).rejects.toMatchObject({ code: "42501" });
	});
});
