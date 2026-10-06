import { z } from "zod";
import { isAllowedDomain } from "@/lib/invitations/domain";
import {
	authMethodsSchema,
	parseList,
	readAuthMethods,
} from "@/lib/tenants/tenant-form";

// Mismo regex que tenants_slug_format en la base.
const SLUG = /^[a-z][a-z0-9-]{1,38}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const text = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
};

export function readCreateForm(formData: FormData): unknown {
	return {
		displayName: text(formData, "display_name"),
		slug: text(formData, "slug").trim(),
		allowedDomains: [
			...new Set(
				parseList(text(formData, "allowed_domains")).map((d) =>
					d.toLowerCase().replace(/^@/, ""),
				),
			),
		],
		authMethods: readAuthMethods(formData),
		primary: text(formData, "primary").trim(),
		secondary: text(formData, "secondary").trim(),
		adminEmail: text(formData, "admin_email").trim().toLowerCase(),
		allowExternalAdmin: formData.has("allow_external_admin"),
	};
}

const color = z.string().refine((v) => v === "" || COLOR.test(v), {
	error: "Los colores van como #RRGGBB.",
});

export const createTenantSchema = z
	.object({
		displayName: z
			.string()
			.trim()
			.min(1, { error: "El nombre no puede quedar vacío." })
			.max(80, { error: "El nombre no puede pasar los 80 caracteres." }),
		slug: z.string().regex(SLUG, {
			error:
				"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		}),
		allowedDomains: z.array(z.string()).max(50),
		authMethods: authMethodsSchema,
		primary: color,
		secondary: color,
		adminEmail: z.email({
			error: "El correo del primer administrador no es válido.",
		}),
		allowExternalAdmin: z.boolean(),
	})
	.superRefine((input, context) => {
		// Se valida ANTES de crear la empresa: un error acá no puede dejar una
		// empresa sin admin.
		if (
			!input.allowExternalAdmin &&
			!isAllowedDomain(input.adminEmail, input.allowedDomains)
		) {
			context.addIssue({
				code: "custom",
				path: ["adminEmail"],
				message:
					'Ese correo no es de los dominios permitidos. Marcá "Permitir correo externo" si es a propósito.',
			});
		}
	});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
