// Adaptador de la API REST de Vercel para los dominios del proyecto (spec 21.6
// §4.8). Los endpoints y las respuestas salen de la documentación vigente el
// 2026-10-14 (spike S2): POST /v10/projects/{id}/domains, GET/DELETE
// /v9/projects/{id}/domains/{domain}, POST .../verify y GET
// /v6/domains/{domain}/config. Sin imports de Next: lo usa un schedule de eve.

export interface DomainVerificationChallenge {
	type: string;
	domain: string;
	value: string;
	reason: string;
}

export interface ProjectDomain {
	name: string;
	verified: boolean;
	verification: DomainVerificationChallenge[];
}

export interface DomainConfig {
	/** Cómo ve Vercel el dominio: CNAME, A, http, dns-01 o null si no resuelve a Vercel. */
	configuredBy: string | null;
	/** Falso solo si el dominio está configurado Y Vercel puede emitir el certificado. */
	misconfigured: boolean;
	/** El CNAME recomendado (rank 1), o null si Vercel no devolvió ninguno. */
	recommendedCname: string | null;
}

export interface VercelDomains {
	add(hostname: string): Promise<ProjectDomain>;
	get(hostname: string): Promise<ProjectDomain | null>;
	verify(hostname: string): Promise<ProjectDomain>;
	remove(hostname: string): Promise<void>;
	config(hostname: string): Promise<DomainConfig>;
}

export type VercelErrorKind =
	| "in_use"
	| "invalid"
	| "unauthorized"
	| "payment"
	| "rate_limit"
	| "unavailable";

export class VercelApiError extends Error {
	constructor(
		readonly kind: VercelErrorKind,
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "VercelApiError";
	}
}

const BASE = "https://api.vercel.com";
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

interface RawDomain {
	name?: unknown;
	verified?: unknown;
	verification?: unknown;
}

function toProjectDomain(raw: RawDomain): ProjectDomain {
	const verification = Array.isArray(raw.verification)
		? raw.verification.flatMap((item): DomainVerificationChallenge[] => {
				const c = item as Record<string, unknown>;
				return typeof c.type === "string" &&
					typeof c.domain === "string" &&
					typeof c.value === "string"
					? [
							{
								type: c.type,
								domain: c.domain,
								value: c.value,
								reason: typeof c.reason === "string" ? c.reason : "",
							},
						]
					: [];
			})
		: [];
	return {
		name: typeof raw.name === "string" ? raw.name : "",
		verified: raw.verified === true,
		verification,
	};
}

export function createVercelDomains(options: {
	token: string;
	projectId: string;
	teamId?: string;
	fetchImpl?: typeof fetch;
}): VercelDomains {
	const doFetch = options.fetchImpl ?? fetch;

	function url(path: string, extra: Record<string, string> = {}): string {
		const params = new URLSearchParams(extra);
		if (options.teamId) params.set("teamId", options.teamId);
		const query = params.toString();
		return `${BASE}${path}${query ? `?${query}` : ""}`;
	}

	function checked(hostname: string): string {
		// El hostname va en la ruta: uno con barras o puntos de más armaría otra.
		if (!HOSTNAME.test(hostname) || hostname.includes("..")) {
			throw new VercelApiError("invalid", 0, "Dominio inválido.");
		}
		return encodeURIComponent(hostname);
	}

	async function call(
		method: string,
		fullUrl: string,
		body?: unknown,
	): Promise<{ status: number; json: unknown }> {
		let response: Response;
		try {
			response = await doFetch(fullUrl, {
				method,
				headers: {
					authorization: `Bearer ${options.token}`,
					"content-type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		} catch {
			// Nunca el error crudo: puede traer la URL o los headers.
			throw new VercelApiError("unavailable", 0, "No pude hablar con Vercel.");
		}
		const json = await response.json().catch(() => null);
		return { status: response.status, json };
	}

	function fail(status: number): never {
		if (status === 401 || status === 403) {
			throw new VercelApiError(
				"unauthorized",
				status,
				"Vercel rechazó el token de la plataforma.",
			);
		}
		if (status === 402) {
			throw new VercelApiError(
				"payment",
				status,
				"La cuenta de Vercel tiene un pago pendiente.",
			);
		}
		if (status === 429) {
			throw new VercelApiError(
				"rate_limit",
				status,
				"Vercel limitó los pedidos. Probá de nuevo en un rato.",
			);
		}
		if (status === 409) {
			throw new VercelApiError(
				"in_use",
				status,
				"Ese dominio ya está en otro proyecto de Vercel.",
			);
		}
		if (status >= 500 || status === 0) {
			throw new VercelApiError(
				"unavailable",
				status,
				"Vercel no respondió. Probá de nuevo.",
			);
		}
		throw new VercelApiError("invalid", status, "Vercel no aceptó el dominio.");
	}

	const self: VercelDomains = {
		async add(hostname) {
			const name = hostname;
			checked(name);
			const { status, json } = await call(
				"POST",
				url(`/v10/projects/${options.projectId}/domains`),
				{ name },
			);
			if (status === 200) return toProjectDomain(json as RawDomain);
			// Un dominio que ya está en este proyecto devuelve 400: se lo trata como
			// éxito para que cargarlo dos veces no falle.
			if (status === 400) {
				const existing = await self.get(name);
				if (existing) return existing;
			}
			return fail(status);
		},

		async get(hostname) {
			const { status, json } = await call(
				"GET",
				url(`/v9/projects/${options.projectId}/domains/${checked(hostname)}`),
			);
			if (status === 404) return null;
			if (status === 200) return toProjectDomain(json as RawDomain);
			return fail(status);
		},

		async verify(hostname) {
			const { status, json } = await call(
				"POST",
				url(
					`/v9/projects/${options.projectId}/domains/${checked(hostname)}/verify`,
				),
			);
			if (status === 200) return toProjectDomain(json as RawDomain);
			// 400 es "todavía no está el registro TXT": no es una falla, es el
			// estado actual del dominio.
			if (status === 400) {
				const current = await self.get(hostname);
				if (current) return { ...current, verified: false };
			}
			return fail(status);
		},

		async remove(hostname) {
			const { status } = await call(
				"DELETE",
				url(`/v9/projects/${options.projectId}/domains/${checked(hostname)}`),
			);
			if (status === 200 || status === 404) return;
			fail(status);
		},

		async config(hostname) {
			const { status, json } = await call(
				"GET",
				url(`/v6/domains/${checked(hostname)}/config`, {
					projectIdOrName: options.projectId,
				}),
			);
			if (status !== 200) return fail(status);
			const raw = json as {
				configuredBy?: unknown;
				misconfigured?: unknown;
				recommendedCNAME?: unknown;
			};
			const cnames = Array.isArray(raw.recommendedCNAME)
				? (raw.recommendedCNAME as { rank?: number; value?: unknown }[])
						.filter((c) => typeof c.value === "string")
						.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
				: [];
			return {
				configuredBy:
					typeof raw.configuredBy === "string" ? raw.configuredBy : null,
				misconfigured: raw.misconfigured !== false,
				recommendedCname: (cnames[0]?.value as string | undefined) ?? null,
			};
		},
	};
	return self;
}

/** El adaptador real, o null si faltan el token o el proyecto (la consola avisa). */
export function vercelDomainsFromEnv(
	env: Record<string, string | undefined>,
): VercelDomains | null {
	const token = env.VERCEL_API_TOKEN;
	const projectId = env.VERCEL_PROJECT_ID;
	if (!token || !projectId) return null;
	return createVercelDomains({
		token,
		projectId,
		teamId: env.VERCEL_TEAM_ID || undefined,
	});
}
