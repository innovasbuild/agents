// Cómo entra cada método OAuth por Supabase. Microsoft es el proveedor
// "azure" y exige pedir el scope email (guía de Supabase para Azure).
export const OAUTH_PROVIDERS = {
	google: {
		provider: "google",
		scopes: "openid email profile",
		label: "Entrar con Google",
	},
	microsoft: {
		provider: "azure",
		scopes: "email",
		label: "Entrar con Microsoft",
	},
} as const satisfies Record<
	string,
	{ provider: "google" | "azure"; scopes: string; label: string }
>;

export type OAuthMethod = keyof typeof OAUTH_PROVIDERS;
