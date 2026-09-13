// Subconjunto escrito a mano de https://api.coldiq.com/openapi.json, tag
// "GTM Verbs" (spec 02 §6.3). El spec público tiene 773 operaciones sin
// operationId: acá van solo las individuales, con operationId propio.
// El body solo expone `input`: sin `inputs` (lotes de hasta 50 por llamada),
// `provider` ni `max_credits`, para que el modelo no dispare lotes ni elija
// proveedores más caros. Los límites de resultados van topeados en 25.

const FindPeopleInput = {
	type: "object",
	properties: {
		company_linkedin_urls: {
			type: "array",
			items: { type: "string" },
			description: "Company LinkedIn URLs (preferred over domains).",
		},
		company_domains: {
			type: "array",
			items: { type: "string" },
			description: "Company domains to search.",
		},
		job_titles: {
			type: "array",
			items: { type: "string" },
			description: 'Target job titles, e.g. ["CEO", "VP of Sales"].',
		},
		seniorities: {
			type: "array",
			items: { type: "string" },
			description: 'Seniority levels, e.g. ["c_suite", "vp"].',
		},
		locations: {
			type: "array",
			items: { type: "string" },
			description: "Person locations as ISO-2 codes or country names.",
		},
		keywords: {
			type: "array",
			items: { type: "string" },
		},
		limit: {
			type: "number",
			minimum: 1,
			maximum: 25,
			default: 25,
		},
		max_per_company: {
			type: "number",
			minimum: 1,
			description:
				"Cap the number of contacts returned per company (e.g. 3 for a buying committee). Applied across all matched companies.",
		},
	},
	description: "Single input — synchronous.",
};

const SearchCompaniesInput = {
	type: "object",
	properties: {
		keywords: {
			type: "array",
			items: { type: "string" },
			description: 'Topics/business models, e.g. ["SaaS", "fintech"].',
		},
		similar_to_domains: {
			type: "array",
			items: { type: "string" },
			maxItems: 10,
			description:
				"Seed company domains to find lookalikes of (up to 10). Routes to DiscoLike's lookalike discovery over 70M companies; combine with keywords / industries / countries / employee range to narrow. Not compatible with tech-stack, funding, revenue, founded-year, or hiring/growth filters.",
		},
		countries: {
			type: "array",
			items: { type: "string" },
			description: "2-letter ISO country codes.",
		},
		locations: {
			type: "array",
			items: { type: "string" },
		},
		industries: {
			type: "array",
			items: { type: "string" },
		},
		technologies: {
			type: "array",
			items: { type: "string" },
			description: "Tech stack filters — routes to tech-aware providers.",
		},
		min_employees: {
			type: "number",
			description:
				"Minimum employee count. Bucket-only providers may widen non-aligned bounds; see _meta.filter_approximations.",
		},
		max_employees: {
			type: "number",
			description:
				"Maximum employee count. Bucket-only providers may widen non-aligned bounds; see _meta.filter_approximations.",
		},
		min_founded_year: { type: "number" },
		max_founded_year: { type: "number" },
		funding_stages: {
			type: "array",
			items: { type: "string" },
		},
		min_funding_amount: { type: "number" },
		max_funding_amount: { type: "number" },
		min_funding_year: { type: "number" },
		max_funding_year: { type: "number" },
		min_revenue: {
			type: "number",
			description:
				"Minimum estimated annual revenue in USD. Bucket-only providers may widen non-aligned bounds; see _meta.filter_approximations.",
		},
		max_revenue: {
			type: "number",
			description:
				"Maximum estimated annual revenue in USD. Bucket-only providers may widen non-aligned bounds; see _meta.filter_approximations.",
		},
		exclude_domains: {
			type: "array",
			items: { type: "string" },
		},
		exclude_industries: {
			type: "array",
			items: { type: "string" },
		},
		exclude_countries: {
			type: "array",
			items: { type: "string" },
		},
		is_hiring: { type: "boolean" },
		min_workforce_growth_pct: {
			type: "number",
			description:
				'Signals "fast-growing" intent. No provider applies an exact growth %, so this routes the search to active-hiring and recently-funded proxies rather than filtering on a literal percentage.',
		},
		linkedin_search_url: { type: "string" },
		limit: {
			type: "number",
			minimum: 1,
			maximum: 25,
			default: 25,
		},
	},
	description: "Single input — synchronous.",
};

const EnrichPersonIdentity = {
	type: "object",
	properties: {
		email: {
			type: "string",
			description: "Work email — strongest identifier.",
		},
		linkedin_url: {
			type: "string",
			description: "LinkedIn profile URL.",
		},
		first_name: { type: "string" },
		last_name: { type: "string" },
		company_name: { type: "string" },
		domain: { type: "string" },
	},
	description: "Single input — synchronous.",
};

const CompanyIdentity = {
	type: "object",
	properties: {
		domain: {
			type: "string",
			description: 'Company domain, e.g. "coldiq.com".',
		},
		name: {
			type: "string",
			description: 'Company name, e.g. "ColdIQ" — alternative to domain.',
		},
		company_name: {
			type: "string",
			description: "Alias for `name` (accepted for compatibility).",
		},
		linkedin_url: {
			type: "string",
			description: "Company LinkedIn URL — alternative to domain.",
		},
	},
	description: "Single input — synchronous.",
};

const PersonIdentity = {
	type: "object",
	properties: {
		first_name: {
			type: "string",
			description: "First name of the person.",
		},
		last_name: {
			type: "string",
			description: "Last name of the person.",
		},
		domain: {
			type: "string",
			description: 'Company domain, e.g. "coldiq.com".',
		},
		company_name: {
			type: "string",
			description: "Company name — alternative to domain.",
		},
		linkedin_url: {
			type: "string",
			description: "LinkedIn profile URL — alternative to name + domain.",
		},
	},
	description: "Single input — synchronous.",
};

const EmailIdentity = {
	type: "object",
	properties: {
		email: {
			type: "string",
			description: "The email address to verify.",
		},
	},
	required: ["email"],
	description: "Single input — synchronous.",
};

const FindSignalsInput = {
	type: "object",
	properties: {
		signal_type: {
			type: "string",
			enum: [
				"funding",
				"acquisition",
				"hiring",
				"job_change",
				"news",
				"intent",
				"startup_post",
			],
			description:
				"Signal type. Company-targeted: funding, acquisition, hiring, job_change, intent. Feed-style: news, startup_post.",
		},
		companies: {
			type: "array",
			items: { type: "string" },
		},
		domains: {
			type: "array",
			items: { type: "string" },
		},
		since: {
			type: "string",
			description: 'ISO date, e.g. "2026-01-01".',
		},
		industries: {
			type: "array",
			items: { type: "string" },
		},
		countries: {
			type: "array",
			items: { type: "string" },
		},
		round_type: {
			type: "array",
			items: { type: "string" },
			description: "Funding round filter (signal_type=funding).",
		},
		topics: {
			type: "array",
			items: { type: "string" },
			description: "Intent topic slugs (signal_type=intent).",
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: 25,
			default: 25,
		},
	},
	required: ["signal_type"],
	description: "Single input — synchronous.",
};

function operation(operationId: string, summary: string, input: object) {
	return {
		post: {
			operationId,
			summary,
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { type: "object", required: ["input"], properties: { input } },
					},
				},
			},
			responses: { "200": { description: "Resultado del waterfall de proveedores de ColdIQ." } },
		},
	};
}

export const COLDIQ_OPERATIONS = [
	"findPeople",
	"searchCompanies",
	"enrichPerson",
	"enrichCompany",
	"findEmail",
	"verifyEmail",
	"findSignals",
] as const;

export const coldiqOpenApi = {
	openapi: "3.0.3",
	info: { title: "ColdIQ API, subconjunto GTM Verbs", version: "1" },
	servers: [{ url: "https://api.coldiq.com" }],
	paths: {
		"/v1/people/search": operation("findPeople", "Busca decisores en empresas por cargo, seniority, dominio o URL de LinkedIn de la empresa.", FindPeopleInput),
		"/v1/companies/search": operation("searchCompanies", "Arma listas de cuentas por firmográficos, tecnologías, financiamiento, geografía o palabras clave; también lookalikes desde dominios semilla.", SearchCompaniesInput),
		"/v1/person/enrich": operation("enrichPerson", "Completa el perfil de una persona (cargo, empresa, ubicación) desde email, LinkedIn o nombre y empresa.", EnrichPersonIdentity),
		"/v1/company/enrich": operation("enrichCompany", "Completa firmográficos de una empresa (empleados, facturación, industria, financiamiento, tecnologías) desde dominio, nombre o LinkedIn.", CompanyIdentity),
		"/v1/email/find": operation("findEmail", "Encuentra el email profesional de una persona desde nombre y empresa o dominio, o desde su LinkedIn.", PersonIdentity),
		"/v1/email/verify": operation("verifyEmail", "Verifica si un email es entregable, riesgoso, catch-all o inválido.", EmailIdentity),
		"/v1/signals/find": operation("findSignals", "Busca señales de compra: financiamiento, adquisiciones, búsquedas laborales, cambios de puesto, noticias o intención.", FindSignalsInput),
	},
};
