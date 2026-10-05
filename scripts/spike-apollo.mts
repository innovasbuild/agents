// scripts/spike-apollo.mts
// Spike S3/S4/S5 (spec etapa 13 §12). Corre a mano, una vez, con una llave
// real. No es código de producción: se borra al cerrar E1.
// Uso: APOLLO_KEY=... node scripts/spike-apollo.mts
const KEY = process.env.APOLLO_KEY;
if (!KEY) throw new Error("falta APOLLO_KEY");

async function call(path: string, body: unknown) {
	const response = await fetch(`https://api.apollo.io/api/v1${path}`, {
		method: "POST",
		headers: { "x-api-key": KEY as string, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await response.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* se imprime el texto crudo */
	}
	return { status: response.status, json, text: text.slice(0, 600) };
}

// S5: ¿cuántas empresas y personas devuelve con filtros realistas?
const orgs = await call("/mixed_companies/search", {
	organization_num_employees_ranges: ["50,200"],
	organization_locations: ["Buenos Aires, Argentina"],
	page: 1,
	per_page: 25,
});
console.log("ORG status:", orgs.status);
console.log("ORG top-level keys:", Object.keys((orgs.json as object) ?? {}));
console.log("ORG pagination:", (orgs.json as Record<string, unknown>)?.pagination);
const orgList =
	((orgs.json as Record<string, unknown>)?.organizations as unknown[]) ?? [];
console.log("ORG count:", orgList.length);
console.log("ORG primer registro:", JSON.stringify(orgList[0], null, 2)?.slice(0, 1500));

// S5: personas dentro de esas empresas
const orgIds = orgList
	.slice(0, 3)
	.map((o) => (o as Record<string, unknown>).id)
	.filter(Boolean);
const people = await call("/mixed_people/search", {
	organization_ids: orgIds,
	person_titles: ["owner", "founder", "gerente general", "director"],
	page: 1,
	per_page: 25,
});
console.log("PEOPLE status:", people.status);
console.log("PEOPLE top-level keys:", Object.keys((people.json as object) ?? {}));
const peopleList =
	((people.json as Record<string, unknown>)?.people as unknown[]) ?? [];
console.log("PEOPLE count:", peopleList.length);
console.log("PEOPLE primer registro:", JSON.stringify(peopleList[0], null, 2)?.slice(0, 1500));

// S3: ¿informa créditos consumidos en algún header o campo?
console.log("ORG texto crudo (primeros 600):", orgs.text);
