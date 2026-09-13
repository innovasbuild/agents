// Subconjunto escrito a mano de Places API (New): Google no publica OpenAPI.
// Solo searchText; ver spec 02 §6.4 para por qué no está getPlace.
export const googlePlacesOpenApi = {
	openapi: "3.0.3",
	info: { title: "Google Places API (New), subconjunto", version: "1" },
	servers: [{ url: "https://places.googleapis.com" }],
	paths: {
		"/v1/places:searchText": {
			post: {
				operationId: "searchText",
				summary:
					"Busca negocios por texto libre con rubro y zona, por ejemplo 'inmobiliarias en Córdoba'.",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["textQuery"],
								properties: {
									textQuery: {
										type: "string",
										description: "Rubro y zona en lenguaje natural.",
									},
									languageCode: {
										type: "string",
										description: "Idioma de los resultados, por ejemplo es.",
									},
									regionCode: {
										type: "string",
										description: "País en código CLDR de dos letras, por ejemplo AR.",
									},
									pageSize: { type: "integer", minimum: 1, maximum: 20 },
									pageToken: {
										type: "string",
										description: "Token de la página siguiente, si la respuesta anterior lo trajo.",
									},
								},
							},
						},
					},
				},
				responses: { "200": { description: "Lugares encontrados." } },
			},
		},
	},
};
