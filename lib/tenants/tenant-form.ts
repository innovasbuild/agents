import { z } from "zod";
import { type AuthMethod, isAuthMethod } from "@/lib/tenants/auth-methods";

// Módulo puro: lo importan la server action y el formulario del cliente.

const DOMAIN =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MODEL = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const LOGO_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/svg+xml": "svg",
	"image/webp": "webp",
};
const LOGO_MAX_BYTES = 1_048_576;

export function parseList(text: string): string[] {
	return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

const text = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
};

export function readAuthMethods(formData: FormData): string[] {
	return formData
		.getAll("auth_methods")
		.filter((v): v is string => typeof v === "string");
}

export const authMethodsSchema = z
	.array(z.string())
	.transform((values) => values.filter(isAuthMethod) as AuthMethod[])
	.refine((values) => values.length > 0, {
		error: "Elegí al menos un método de login.",
	});

export function readTenantForm(formData: FormData): unknown {
	return {
		displayName: text(formData, "display_name"),
		// Un dominio se pega como venga del mail: con arroba y con mayúsculas.
		allowedDomains: [
			...new Set(
				parseList(text(formData, "allowed_domains")).map((domain) =>
					domain.toLowerCase().replace(/^@/, ""),
				),
			),
		],
		// Un checkbox sin marcar no viaja en el form.
		selfSignupByDomain: formData.has("self_signup_by_domain"),
		allowedModels: parseList(text(formData, "allowed_models")),
		defaultModel: text(formData, "default_model"),
		authMethods: readAuthMethods(formData),
		primary: text(formData, "primary").trim(),
		secondary: text(formData, "secondary").trim(),
		active: formData.has("active"),
	};
}

const color = z.string().refine((value) => value === "" || COLOR.test(value), {
	error: "Los colores van como #RRGGBB.",
});

export const tenantInputSchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.min(1, { error: "El nombre no puede quedar vacío." })
			.max(80, { error: "El nombre no puede pasar los 80 caracteres." }),
		allowedDomains: z
			.array(
				z.string().regex(DOMAIN, {
					error: (issue) => `"${issue.input}" no es un dominio válido.`,
				}),
			)
			.max(50),
		selfSignupByDomain: z.boolean(),
		allowedModels: z
			.array(
				z
					.string()
					.max(200)
					.regex(MODEL, {
						error: (issue) =>
							`"${issue.input}" no tiene la forma proveedor/modelo.`,
					}),
			)
			.min(1, { error: "Tiene que haber al menos un modelo permitido." })
			.max(50),
		defaultModel: z.string(),
		authMethods: authMethodsSchema,
		primary: color,
		secondary: color,
		active: z.boolean(),
	})
	.superRefine((input, context) => {
		if (input.selfSignupByDomain && input.allowedDomains.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["allowedDomains"],
				message:
					"Para permitir el alta por dominio hace falta al menos un dominio.",
			});
		}
		if (!input.allowedModels.includes(input.defaultModel)) {
			context.addIssue({
				code: "custom",
				path: ["defaultModel"],
				message: "El modelo por defecto tiene que estar entre los permitidos.",
			});
		}
	});

export type TenantInput = z.infer<typeof tenantInputSchema>;

/**
 * Mezcla sobre lo que la fila ya tiene: `brand` es jsonb libre y puede traer
 * claves que este formulario no conoce.
 */
export function mergeBrand(
	existing: Record<string, unknown>,
	next: { primary: string; secondary: string; logoUrl?: string },
): Record<string, unknown> {
	const brand: Record<string, unknown> = { ...existing };

	for (const key of ["primary", "secondary"] as const) {
		if (next[key]) brand[key] = next[key];
		else delete brand[key];
	}
	if (next.logoUrl) brand.logo_url = next.logoUrl;

	return brand;
}

export function validateLogo(file: {
	type: string;
	size: number;
}): { ok: true; ext: string } | { ok: false; message: string } {
	const ext = LOGO_EXTENSIONS[file.type];
	if (!ext)
		return { ok: false, message: "El logo tiene que ser PNG, SVG o WebP." };
	if (file.size > LOGO_MAX_BYTES)
		return { ok: false, message: "El logo no puede pesar más de 1 MB." };
	return { ok: true, ext };
}
