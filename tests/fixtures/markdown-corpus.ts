// Corpus de la prueba de ida y vuelta del editor (spec 18.2 §5.3). `exact: true`
// exige que el markdown salga idéntico; `exact: false` acepta una normalización
// de estilo estable y la explica en `note`.
export interface CorpusCase {
	name: string;
	md: string;
	exact: boolean;
	note?: string;
}

const j = (...lines: string[]) => lines.join("\n");

export const CORPUS: CorpusCase[] = [
	{
		name: "titulos",
		exact: true,
		md: j("# Uno", "", "## Dos", "", "### Tres", "", "Texto."),
	},
	{
		name: "enfasis",
		exact: true,
		md: "Texto con **negrita**, *cursiva*, ~~tachado~~ y `código`.",
	},
	{
		name: "viñetas anidadas",
		exact: true,
		md: j("- uno", "  - dos", "    - tres", "- cuatro"),
	},
	{ name: "numerada", exact: true, md: j("1. uno", "2. dos", "3. tres") },
	{ name: "tareas", exact: true, md: j("- [ ] pendiente", "- [x] hecha") },
	{ name: "cita", exact: true, md: j("> una cita", "> en dos líneas") },
	{
		name: "linea divisoria",
		exact: true,
		md: j("Antes", "", "---", "", "Después"),
	},
	{
		name: "link e imagen",
		exact: true,
		md: "Mirá [la web](https://innov.as) y ![logo](https://innov.as/logo.png).",
	},
	{
		name: "codigo con lenguaje",
		exact: true,
		md: j("```ts", "const a = 1;", "```"),
	},
	{
		name: "codigo con markdown y wikilink adentro",
		exact: true,
		md: j(
			"```md",
			"# no es un título",
			"[[comercial/icp]] no es un link",
			"```",
		),
	},
	{
		name: "tabla con alineacion",
		exact: false,
		note: "las columnas se re-rellenan con espacios y los guiones de la fila separadora se alargan; las alineaciones y las celdas quedan iguales, y la segunda pasada no cambia nada",
		md: j(
			"| Nombre | Precio | Nota |",
			"| :--- | ---: | :---: |",
			"| Radar | 100 | ok |",
			"| Mapa | 250 | ok |",
		),
	},
	{ name: "wikilink simple", exact: true, md: "Ver [[comercial/icp]] hoy." },
	{
		name: "wikilink con alias",
		exact: true,
		md: "Ver [[comercial/icp|el perfil]] hoy.",
	},
	{
		name: "wikilink con ancla y alias",
		exact: true,
		md: "Ver [[comercial/icp#objeciones|las objeciones]].",
	},
	{
		name: "wikilink con espacios raros",
		exact: true,
		md: "Ver [[ comercial/icp | el perfil ]] hoy.",
	},
	{
		name: "wikilink en lista y en tabla",
		exact: false,
		note: "solo cambia el relleno de la tabla (columnas alineadas con espacios); los links, con su | adentro, salen byte a byte iguales",
		md: j(
			"- [[comercial/icp|ICP]]",
			"- [[legal/contrato]]",
			"",
			"| Página | Nota |",
			"| --- | --- |",
			"| [[comercial/icp|ICP]] | base |",
		),
	},
	{
		name: "wikilink en codigo en linea",
		exact: true,
		md: "Escribí `[[slug]]` para enlazar.",
	},
	{
		name: "linea en blanco consecutivas",
		exact: false,
		note: "las líneas en blanco extra pueden colapsar o pasar a &nbsp;; el contenido visible es el mismo",
		md: j("Uno", "", "", "", "Dos"),
	},
	{ name: "salto duro", exact: true, md: j("línea uno  ", "línea dos") },
	{
		name: "escapes",
		exact: true,
		md: "Un asterisco \\* y un guion bajo \\_ y un corchete \\[ sueltos.",
	},
	{
		name: "acentos y ñ",
		exact: true,
		md: "Camión, niño, corazón, ¿qué tal? ¡Hola!",
	},
	{
		name: "documento largo mezclado",
		exact: false,
		note: "documento real de ejemplo; solo se exige que no pierda contenido y que sea estable",
		md: j(
			"# Perfil de cliente ideal",
			"",
			"Hablamos con **dueños** de pymes agro. Ver [[comercial/mensajes|los mensajes]].",
			"",
			"## Señales",
			"",
			"- Maneja más de 500 ha",
			"  - propias o arrendadas",
			"- Usa [[tecnica/radar]]",
			"",
			"> Regla: nunca prometer plazos.",
			"",
			"| Segmento | Tamaño |",
			"| --- | --- |",
			"| Chico | < 500 ha |",
			"| Grande | > 2000 ha |",
		),
	},
];

// Casos de seguridad (spec 18.2 V10): el HTML crudo nunca se vuelve elemento.
export const HOSTILE: Array<{ name: string; md: string }> = [
	{ name: "script", md: "Hola <script>alert(1)</script> mundo" },
	{ name: "img con onerror", md: "Mirá <img src=x onerror=alert(1)> esto" },
	{ name: "bloque html", md: j('<div onclick="alert(1)">', "hola", "</div>") },
	{ name: "link javascript", md: "[clic](javascript:alert(1))" },
];
