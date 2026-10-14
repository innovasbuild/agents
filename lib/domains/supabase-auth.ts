// Lista de Redirect URLs de Supabase Auth (spec 21.6 §4.9). Cada dominio activo
// tiene que estar en la lista: si el redirectTo del link mágico o de Google no
// está permitido, Supabase cae a la Site URL y el `code` PKCE llega a otro host,
// que no tiene el verificador, y el login falla.
//
// Management API (spike S3, doc del 2026-10-14): GET y PATCH
// /v1/projects/{ref}/config/auth, campo `uri_allow_list`. La documentación no
// dice cómo se separan las entradas; se asume coma (así lo define GoTrue) y por
// eso después de escribir se vuelve a leer y se confirma: si Supabase no
// guardó lo pedido, falla en vez de dar el cambio por hecho.
// Sin imports de Next: lo usa un schedule de eve.

export interface AuthRedirects {
	read(): Promise<string[]>;
	write(list: string[]): Promise<void>;
}

export type AuthRedirectErrorKind =
	| "unauthorized"
	| "unavailable"
	| "unconfirmed";

export class AuthRedirectError extends Error {
	constructor(
		readonly kind: AuthRedirectErrorKind,
		message: string,
	) {
		super(message);
		this.name = "AuthRedirectError";
	}
}

const BASE = "https://api.supabase.com";
const PROJECT_REF = /^[a-z0-9]{6,40}$/;

export function redirectEntryFor(hostname: string): string {
	const scheme = hostname.endsWith(".localhost") ? "http" : "https";
	return `${scheme}://${hostname}/auth/callback**`;
}

export function createSupabaseAuthRedirects(options: {
	accessToken: string;
	projectRef: string;
	fetchImpl?: typeof fetch;
}): AuthRedirects {
	if (!PROJECT_REF.test(options.projectRef)) {
		throw new Error("SUPABASE_PROJECT_REF no parece un project ref.");
	}
	const doFetch = options.fetchImpl ?? fetch;
	const url = `${BASE}/v1/projects/${options.projectRef}/config/auth`;

	async function call(method: string, body?: unknown) {
		let response: Response;
		try {
			response = await doFetch(url, {
				method,
				headers: {
					authorization: `Bearer ${options.accessToken}`,
					"content-type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		} catch {
			throw new AuthRedirectError(
				"unavailable",
				"No pude hablar con Supabase.",
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new AuthRedirectError(
				"unauthorized",
				"Supabase rechazó el token de la plataforma.",
			);
		}
		if (!response.ok) {
			throw new AuthRedirectError("unavailable", "Supabase no respondió bien.");
		}
		return response.json().catch(() => ({}));
	}

	return {
		async read() {
			const json = (await call("GET")) as { uri_allow_list?: unknown };
			const raw =
				typeof json.uri_allow_list === "string" ? json.uri_allow_list : "";
			return raw
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
		},
		async write(list) {
			// Solo este campo: el PATCH es parcial y cualquier otro que se mande se pisa.
			await call("PATCH", { uri_allow_list: list.join(",") });
		},
	};
}

/**
 * Suma las entradas de los dominios activos y saca las de los que se quitan,
 * sin tocar nada más: lo que alguien cargó a mano en el panel se conserva.
 * Idempotente: dos altas casi simultáneas llegan al mismo resultado.
 */
export async function syncAuthRedirectUrls(
	redirects: AuthRedirects,
	change: { add: string[]; remove: string[] },
): Promise<{ changed: boolean }> {
	const removeEntries = new Set(change.remove.map(redirectEntryFor));
	const addEntries = change.add.map(redirectEntryFor);

	const current = await redirects.read();
	const next = current.filter((entry) => !removeEntries.has(entry));
	for (const entry of addEntries) {
		if (!next.includes(entry)) next.push(entry);
	}
	if (
		next.length === current.length &&
		next.every((entry, index) => entry === current[index])
	) {
		return { changed: false };
	}

	await redirects.write(next);

	const saved = await redirects.read();
	const missing = addEntries.some((entry) => !saved.includes(entry));
	const stale = [...removeEntries].some((entry) => saved.includes(entry));
	if (missing || stale) {
		throw new AuthRedirectError(
			"unconfirmed",
			"Supabase no guardó la lista de redirects como se pidió.",
		);
	}
	return { changed: true };
}

/** El adaptador real, o null si faltan el token o el proyecto (la consola avisa). */
export function supabaseAuthRedirectsFromEnv(
	env: Record<string, string | undefined>,
): AuthRedirects | null {
	const accessToken = env.SUPABASE_ACCESS_TOKEN;
	const projectRef = env.SUPABASE_PROJECT_REF;
	if (!accessToken || !projectRef) return null;
	return createSupabaseAuthRedirects({ accessToken, projectRef });
}
