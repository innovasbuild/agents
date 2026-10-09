// Métodos de login que una empresa puede ofrecer en su landing (spec alta A1).
// Sumar uno es: agregarlo acá, al check de tenants.auth_methods, al mapeo de
// public.current_login_method() y un botón en LoginForm.
export const AUTH_METHODS = ["email", "google", "microsoft"] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
	email: "Link por correo",
	google: "Google",
	microsoft: "Microsoft",
};

export function isAuthMethod(value: string): value is AuthMethod {
	return (AUTH_METHODS as readonly string[]).includes(value);
}
