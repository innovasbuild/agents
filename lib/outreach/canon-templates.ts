// Páginas que nacen con el brain de una empresa (spec 21.3 §3.6): carpeta y
// archivo por defecto para el ICP y para hooks y vectores. Nacen en borrador
// y con los bloques comentados: no cuentan hasta que una persona los completa
// y activa la página. Genéricas: no nombran a ningún cliente.
const ICP_BODY = `Esta página define a quién le vende la empresa. La leen el agente al redactar y el calificador de contactos.

Escribí arriba, en prosa, quién es el cliente ideal y por qué. Abajo, en el bloque, van los niveles que usa el calificador: cada línea es una situación concreta que se entiende sola, de la peor a la mejor.

Para que la página cuente: sacale el "# " a cada línea del bloque, reemplazá el texto por el tuyo y pasá la página a estado activo.

\`\`\`icp
# De 2 a 10 líneas "encaje", de la empresa que menos encaja a la que más.
# encaje: No encaja: describí acá la empresa que claramente queda afuera
# encaje: Podría encajar: describí acá la empresa que comparte algunos rasgos
# encaje: Encaja: describí acá la empresa que es exactamente la que buscás
# De 2 a 10 líneas "rol", de la persona menos indicada a la más indicada.
# rol: Sin relación: describí acá el rol que no participa de la decisión
# rol: Influye: describí acá el rol que sufre el problema pero no decide
# rol: Decide: describí acá el rol que aprueba la compra
# Una sola línea "excluir": cuándo una empresa se descarta sin mirar lo demás.
# excluir: La empresa es competidora, ya es cliente o es proveedora
\`\`\`
`;

const HOOKS_BODY = `Esta página lista los hooks (el ángulo con el que se abre un mensaje) y los vectores (de dónde sale el contacto) de la empresa. Lo que escribas en los bloques es lo que aparece en Focos y en Métricas: no hace falta cargarlo en otro lado.

Explicá en prosa qué dice cada hook y cuándo se usa. En los bloques va el identificador (minúsculas, dígitos y guion bajo), dos puntos y el rótulo. Un vector puede llevar su hook por defecto después de " => ".

Un identificador que ya se usó no se cambia: si un hook deja de usarse, sacá su línea y queda desactivado, con su historia intacta.

Para que la página cuente: sacale el "# " a las líneas de ejemplo, reemplazalas por las tuyas y pasá la página a estado activo.

\`\`\`hooks
# h_ejemplo: Rótulo del hook de ejemplo
\`\`\`

\`\`\`vectores
# v_ejemplo: Rótulo del vector de ejemplo => h_ejemplo
\`\`\`
`;

export const DEFAULT_CANON_PAGES = [
	{
		slug: "comercial/icp",
		title: "Cliente ideal (ICP)",
		category: "comercial",
		tags: ["canon:icp"],
		body: ICP_BODY,
	},
	{
		slug: "comercial/hooks",
		title: "Hooks y vectores",
		category: "comercial",
		tags: ["canon:hooks"],
		body: HOOKS_BODY,
	},
] as const;
