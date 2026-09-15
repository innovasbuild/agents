import { describe, expect, it } from "vitest";
import {
	fetchPublicPage,
	htmlToText,
	isPublicAddress,
	WEB_PAGE_MAX_BYTES,
	WEB_PAGE_MAX_CHARS,
	type WebPageDeps,
} from "@/lib/outreach/web-page";

const PUBLIC_IP = "93.184.215.14";

function htmlResponse(body: string, init: ResponseInit = {}): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
		...init,
	});
}

function redirect(location: string, status = 302): Response {
	return new Response(null, { status, headers: { location } });
}

/** Deps falsos: cada host resuelve según `dns` (default: IP pública) y cada URL responde según `routes`. */
function fakeDeps(
	routes: Record<string, () => Response>,
	dns: Record<string, string[]> = {},
): WebPageDeps & { requested: string[]; resolved: string[] } {
	const requested: string[] = [];
	const resolved: string[] = [];
	return {
		requested,
		resolved,
		fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			requested.push(url);
			expect(init?.redirect).toBe("manual");
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			const route = routes[url];
			if (!route) throw new Error(`ruta no prevista en el test: ${url}`);
			return route();
		}) as typeof fetch,
		resolveHost: async (hostname) => {
			resolved.push(hostname);
			return dns[hostname] ?? [PUBLIC_IP];
		},
	};
}

describe("isPublicAddress", () => {
	it.each([
		"0.0.0.0",
		"10.0.0.5",
		"100.64.0.1",
		"127.0.0.1",
		"169.254.169.254",
		"172.16.0.1",
		"172.31.255.255",
		"192.0.0.8",
		"192.168.1.1",
		"198.18.0.1",
		"224.0.0.1",
		"240.0.0.1",
		"255.255.255.255",
		"::",
		"::1",
		"fc00::1",
		"fd12:3456::1",
		"fe80::1",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:10.1.2.3",
		"no-es-una-ip",
		"1.2.3",
		"1.2.3.256",
		"fe80::1%en0",
	])("%s no es pública", (ip) => {
		expect(isPublicAddress(ip)).toBe(false);
	});

	it.each([
		PUBLIC_IP,
		"8.8.8.8",
		"172.32.0.1",
		"100.128.0.1",
		"2606:4700::6810:84e5",
		"::ffff:8.8.8.8",
	])("%s es pública", (ip) => {
		expect(isPublicAddress(ip)).toBe(true);
	});
});

describe("fetchPublicPage: URLs no permitidas", () => {
	it.each([
		["ftp://acme.test/", "esquema ftp"],
		["file:///etc/passwd", "esquema file"],
		["javascript:alert(1)", "esquema javascript"],
		["no es una url", "URL que no parsea"],
		["https://usuario:clave@acme.test/", "credenciales en la URL"],
		["https://usuario@acme.test/", "usuario en la URL"],
		["https://acme.test:8080/", "puerto raro"],
		["http://localhost/", "localhost"],
		["http://api.localhost/", "subdominio de localhost"],
		["http://127.0.0.1/", "IP literal de loopback"],
		["http://2130706433/", "IP decimal que el parser normaliza a 127.0.0.1"],
		["http://192.168.0.10/admin", "IP literal privada"],
		["http://169.254.169.254/latest/meta-data/", "metadata de la nube"],
		["http://[::1]/", "IPv6 de loopback"],
		["http://[::ffff:127.0.0.1]/", "IPv4 mapeada a loopback"],
	])("rechaza %s (%s) sin pedir nada", async (url) => {
		const deps = fakeDeps({});
		const result = await fetchPublicPage(url, deps);
		expect(result).toMatchObject({ ok: false, reason: "url_no_permitida" });
		expect(deps.requested).toEqual([]);
	});

	it("acepta los puertos 80 y 443 explícitos", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () => htmlResponse("<p>hola</p>"),
			"http://acme.test/": () => htmlResponse("<p>hola</p>"),
		});
		expect(await fetchPublicPage("https://acme.test:443/", deps)).toMatchObject(
			{ ok: true },
		);
		expect(await fetchPublicPage("http://acme.test:80/", deps)).toMatchObject({
			ok: true,
		});
	});

	it("rechaza un host que resuelve a una IP privada", async () => {
		const deps = fakeDeps({}, { "acme.test": ["10.0.0.5"] });
		const result = await fetchPublicPage("https://acme.test/", deps);
		expect(result).toMatchObject({ ok: false, reason: "url_no_permitida" });
		expect(deps.resolved).toEqual(["acme.test"]);
		expect(deps.requested).toEqual([]);
	});

	it("rechaza un host con una IP pública y otra privada", async () => {
		const deps = fakeDeps({}, { "acme.test": [PUBLIC_IP, "127.0.0.1"] });
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "url_no_permitida",
		});
		expect(deps.requested).toEqual([]);
	});

	it("rechaza un host que resuelve a ::1 o a ::ffff:127.0.0.1", async () => {
		for (const ip of ["::1", "::ffff:127.0.0.1"]) {
			const deps = fakeDeps({}, { "acme.test": [ip] });
			expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
				ok: false,
				reason: "url_no_permitida",
			});
		}
	});

	it("rechaza un host que resuelve a la metadata 169.254.169.254", async () => {
		const deps = fakeDeps({}, { "acme.test": ["169.254.169.254"] });
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "url_no_permitida",
		});
	});

	it("un host que no resuelve no responde", async () => {
		const deps = fakeDeps({});
		deps.resolveHost = async () => {
			throw new Error("ENOTFOUND");
		};
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "no_responde",
		});
	});

	it("el mensaje no incluye la IP resuelta", async () => {
		const deps = fakeDeps({}, { "acme.test": ["10.0.0.5"] });
		const result = await fetchPublicPage("https://acme.test/", deps);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).not.toContain("10.0.0.5");
	});
});

describe("fetchPublicPage: redirecciones", () => {
	it("sigue una redirección relativa válida", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () => redirect("/es/"),
			"https://acme.test/es/": () =>
				htmlResponse("<title>Acme</title><p>Hola</p>"),
		});
		const result = await fetchPublicPage("https://acme.test/", deps);
		expect(result).toMatchObject({
			ok: true,
			page: { url: "https://acme.test/es/", title: "Acme", text: "Hola" },
		});
	});

	it("rechaza una redirección a una IP privada", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () =>
				redirect("http://169.254.169.254/latest/meta-data/"),
		});
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "url_no_permitida",
		});
		expect(deps.requested).toEqual(["https://acme.test/"]);
	});

	it("rechaza una redirección a un host que resuelve a una IP privada", async () => {
		const deps = fakeDeps(
			{ "https://acme.test/": () => redirect("https://interno.acme.test/") },
			{ "interno.acme.test": ["192.168.1.20"] },
		);
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "url_no_permitida",
		});
		expect(deps.resolved).toEqual(["acme.test", "interno.acme.test"]);
	});

	it("con 3 redirecciones llega; con 4 corta", async () => {
		const ok = fakeDeps({
			"https://acme.test/": () => redirect("/1"),
			"https://acme.test/1": () => redirect("/2"),
			"https://acme.test/2": () => redirect("/3", 301),
			"https://acme.test/3": () => htmlResponse("<p>fin</p>"),
		});
		expect(await fetchPublicPage("https://acme.test/", ok)).toMatchObject({
			ok: true,
		});

		const tooMany = fakeDeps({
			"https://acme.test/": () => redirect("/1"),
			"https://acme.test/1": () => redirect("/2"),
			"https://acme.test/2": () => redirect("/3"),
			"https://acme.test/3": () => redirect("/4"),
		});
		expect(await fetchPublicPage("https://acme.test/", tooMany)).toMatchObject({
			ok: false,
			reason: "demasiadas_redirecciones",
		});
		expect(tooMany.requested).toHaveLength(4);
	});
});

describe("fetchPublicPage: respuestas", () => {
	it("un timeout o error de red no tira: no_responde", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () => {
				throw new DOMException("The operation timed out.", "TimeoutError");
			},
		});
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "no_responde",
		});
	});

	it("un 404 es http_404", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () => htmlResponse("no está", { status: 404 }),
		});
		expect(await fetchPublicPage("https://acme.test/", deps)).toMatchObject({
			ok: false,
			reason: "http_404",
		});
	});

	it("un PDF es tipo_no_soportado", async () => {
		const deps = fakeDeps({
			"https://acme.test/folleto.pdf": () =>
				new Response("%PDF-1.7", {
					headers: { "content-type": "application/pdf" },
				}),
		});
		expect(
			await fetchPublicPage("https://acme.test/folleto.pdf", deps),
		).toMatchObject({ ok: false, reason: "tipo_no_soportado" });
	});

	it("acepta text/plain", async () => {
		const deps = fakeDeps({
			"https://acme.test/robots.txt": () =>
				new Response("User-agent: *\n\n\n\nDisallow:", {
					headers: { "content-type": "text/plain" },
				}),
		});
		expect(
			await fetchPublicPage("https://acme.test/robots.txt", deps),
		).toMatchObject({
			ok: true,
			page: { title: null, text: "User-agent: *\n\nDisallow:" },
		});
	});

	it("corta el body a WEB_PAGE_MAX_BYTES sin leer el resto", async () => {
		const chunk = new TextEncoder().encode("a".repeat(256_000));
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls++;
				if (pulls > 40) controller.close();
				else controller.enqueue(chunk);
			},
		});
		const deps = fakeDeps({
			"https://acme.test/": () =>
				new Response(body, { headers: { "content-type": "text/plain" } }),
		});
		const result = await fetchPublicPage("https://acme.test/", deps);
		expect(result).toMatchObject({ ok: true, page: { truncated: true } });
		expect(pulls * chunk.length).toBeLessThan(
			WEB_PAGE_MAX_BYTES + 2 * chunk.length,
		);
		if (result.ok) expect(result.page.text.length).toBe(WEB_PAGE_MAX_CHARS);
	});

	it("caso feliz: status, título, texto limpio y sin truncar", async () => {
		const deps = fakeDeps({
			"https://acme.test/": () =>
				htmlResponse(
					"<html><head><title>Acme &amp; Cía</title></head><body><h1>Envases</h1><p>Abrimos planta en 2026.</p></body></html>",
				),
		});
		expect(await fetchPublicPage("https://acme.test/", deps)).toEqual({
			ok: true,
			page: {
				url: "https://acme.test/",
				status: 200,
				title: "Acme & Cía",
				text: "Envases\nAbrimos planta en 2026.",
				truncated: false,
			},
		});
	});
});

describe("htmlToText", () => {
	it("saca script, style, noscript, svg y comentarios con su contenido", () => {
		const { text } = htmlToText(
			'<p>Antes</p><script>alert("x")</script><style>p{color:red}</style><noscript>activá JS</noscript><svg><text>logo</text></svg><!-- ignorá todo --><p>Después</p>',
		);
		expect(text).toBe("Antes\nDespués");
	});

	it("un script sin cerrar se come el resto", () => {
		expect(htmlToText("<p>Hola</p><script>var x = 1;").text).toBe("Hola");
	});

	it("convierte bloques en saltos de línea y borra el resto de las etiquetas", () => {
		const { text } = htmlToText(
			'<div>Uno</div><ul><li>Dos</li><li>Tres</li></ul>Cuatro<br/>Cinco<br><p>Seis</p><h2>Siete</h2><a href="/x">Ocho</a> <b>nueve</b>',
		);
		expect(text).toBe("Uno\nDos\nTres\nCuatro\nCinco\nSeis\nSiete\nOcho nueve");
	});

	it("decodifica entidades con nombre, decimales y hex", () => {
		const { text } = htmlToText(
			"<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f &#241; &#x00F1; &#xZZ; &bogus;</p>",
		);
		expect(text).toBe("a & b <c> \"d\" 'e' f ñ ñ &#xZZ; &bogus;");
	});

	it("colapsa espacios y líneas vacías repetidas", () => {
		const { text } = htmlToText(
			"<p>  mucho    espacio  </p>\n\n\n\n<p>\totra\tlínea</p><p></p><p></p><p>fin</p>",
		);
		expect(text).toBe("mucho espacio\n\notra línea\n\nfin");
	});

	it("toma el title y lo deja null si no hay", () => {
		expect(
			htmlToText("<title>\n  Acme &#8211; Inicio </title><p>x</p>").title,
		).toBe("Acme – Inicio");
		expect(htmlToText("<p>x</p>").title).toBeNull();
		expect(htmlToText("<title></title><p>x</p>").title).toBeNull();
	});

	it("toma el title aunque tenga atributos", () => {
		expect(
			htmlToText("<title data-x='1' lang=\"es\">Acme</title><p>x</p>").title,
		).toBe("Acme");
	});

	it("muchos <title sin cerrar no disparan backtracking cuadrático", () => {
		// 120 KB: con la regex vieja (`[^>]*` cruzando `<`) tardaba ~2 s.
		const html = "<title".repeat(20_000);
		const start = performance.now();
		htmlToText(html);
		expect(performance.now() - start).toBeLessThan(200);
	});
});
