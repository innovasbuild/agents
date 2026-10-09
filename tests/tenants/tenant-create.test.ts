import { describe, expect, it } from "vitest";
import {
	createTenantSchema,
	readCreateForm,
} from "@/lib/tenants/tenant-create";

function form(overrides: Record<string, string | string[] | null> = {}) {
	const values: Record<string, string | string[] | null> = {
		display_name: "Acme",
		slug: "acme",
		allowed_domains: "acme.test",
		auth_methods: ["email"],
		primary: "#112233",
		secondary: "",
		admin_email: "Ana@Acme.test",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value === null) continue;
		if (Array.isArray(value)) for (const v of value) data.append(key, v);
		else data.set(key, value);
	}
	return data;
}

const parse = (o?: Record<string, string | string[] | null>) =>
	createTenantSchema.safeParse(readCreateForm(form(o)));
const message = (o: Record<string, string | string[] | null>) => {
	const r = parse(o);
	return r.success ? null : r.error.issues[0]?.message;
};

describe("createTenantSchema", () => {
	it("acepta un alta válida y normaliza el correo", () => {
		const result = parse();

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			displayName: "Acme",
			slug: "acme",
			allowedDomains: ["acme.test"],
			authMethods: ["email"],
			primary: "#112233",
			secondary: "",
			adminEmail: "ana@acme.test",
			allowExternalAdmin: false,
		});
	});

	it("rechaza un slug con mayúsculas o espacios", () => {
		expect(message({ slug: "Acme SA" })).toBe(
			"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		);
	});

	it("rechaza un slug de una sola letra", () => {
		expect(message({ slug: "a" })).toBe(
			"El slug va en minúsculas, con números y guiones, y empieza con letra.",
		);
	});

	it("exige al menos un método de login", () => {
		expect(message({ auth_methods: null })).toBe(
			"Elegí al menos un método de login.",
		);
	});

	it("rechaza un método desconocido", () => {
		expect(message({ auth_methods: ["saml"] })).toBe(
			"Elegí al menos un método de login.",
		);
	});

	it("rechaza un correo de admin inválido", () => {
		expect(message({ admin_email: "ana" })).toBe(
			"El correo del primer administrador no es válido.",
		);
	});

	it("rechaza un admin externo sin el tilde", () => {
		expect(message({ admin_email: "ana@gmail.com" })).toBe(
			'Ese correo no es de los dominios permitidos. Marcá "Permitir correo externo" si es a propósito.',
		);
	});

	it("acepta un admin externo con el tilde", () => {
		const result = parse({
			admin_email: "ana@gmail.com",
			allow_external_admin: "on",
		});

		expect(result.success).toBe(true);
		expect(result.data?.allowExternalAdmin).toBe(true);
	});

	it("sin dominios declarados cualquier correo es interno", () => {
		expect(
			parse({ allowed_domains: "", admin_email: "ana@gmail.com" }).success,
		).toBe(true);
	});
});
