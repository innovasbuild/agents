// Opciones del AI Gateway que acompañan a toda llamada al modelo (spec 21.5
// §4). El tag es lo que separa el gasto por empresa en el gateway. Imports
// relativos: lo usan tools, schedules y el agente de eve.
import type { AdminLike } from "./usage";

// `type` y no `interface`: tiene que ser asignable al Record de providerOptions.
export type GatewayOptions = { gateway: { tags: string[] } };

export function tenantTag(key: string): string {
	return `tenant:${key}`;
}

export function gatewayOptions(slug: string): GatewayOptions {
	return { gateway: { tags: [tenantTag(slug)] } };
}

/**
 * Para las puertas que conocen el id del tenant y no su slug (schedules).
 * Nunca tira: un tag no puede tumbar una llamada al modelo. Si no puede leer
 * el slug etiqueta con el id, que la conciliación sabe atribuir, y no guarda
 * el fallo en caché.
 */
export function createGatewayOptions(
	admin: AdminLike,
): (tenantId: string) => Promise<GatewayOptions> {
	const cache = new Map<string, GatewayOptions>();
	return async (tenantId) => {
		const cached = cache.get(tenantId);
		if (cached) return cached;
		try {
			const { data, error } = await admin
				.from("tenants")
				.select("slug")
				.eq("id", tenantId)
				.maybeSingle();
			const slug = (data as { slug?: unknown } | null)?.slug;
			if (!error && typeof slug === "string" && slug) {
				const options = gatewayOptions(slug);
				cache.set(tenantId, options);
				return options;
			}
			console.error("gateway-options:", error?.message ?? "tenant sin slug");
		} catch (error) {
			console.error("gateway-options:", error);
		}
		return gatewayOptions(tenantId);
	};
}
