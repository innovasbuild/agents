import { describe, expect, it } from "vitest";
import {
	mergeBrand,
	parseList,
	readTenantForm,
	tenantInputSchema,
	validateLogo,
} from "@/lib/tenants/tenant-form";

function form(overrides: Record<string, string | null> = {}) {
	const values: Record<string, string | null> = {
		display_name: "INNOV.AS",
		allowed_domains: "innov.as",
		self_signup_by_domain: "on",
		allowed_models: "anthropic/claude-sonnet-5\nanthropic/claude-haiku-4-5",
		default_model: "anthropic/claude-sonnet-5",
		primary: "#1D4ED8",
		secondary: "",
		active: "on",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null) data.set(key, value);
	}
	return data;
}

const parse = (overrides?: Record<string, string | null>) =>
	tenantInputSchema.safeParse(readTenantForm(form(overrides)));

const message = (overrides: Record<string, string | null>) => {
	const result = parse(overrides);
	return result.success ? null : result.error.issues[0]?.message;
};

describe("parseList", () => {
	it("separa por comas, espacios y saltos de línea, sin vacíos ni repetidos", () => {
		expect(parseList(" a.com, b.com\n\na.com  c.com ")).toEqual([
			"a.com",
			"b.com",
			"c.com",
		]);
	});

	it("devuelve lista vacía para texto en blanco", () => {
		expect(parseList("  \n ")).toEqual([]);
	});
});

describe("tenantInputSchema", () => {
	it("acepta un formulario válido", () => {
		const result = parse();

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			displayName: "INNOV.AS",
			allowedDomains: ["innov.as"],
			selfSignupByDomain: true,
			allowedModels: [
				"anthropic/claude-sonnet-5",
				"anthropic/claude-haiku-4-5",
			],
			defaultModel: "anthropic/claude-sonnet-5",
			primary: "#1D4ED8",
			secondary: "",
			active: true,
		});
	});

	it("normaliza dominios pegados con arroba, mayúsculas y repetidos", () => {
		const result = parse({ allowed_domains: "@Innov.AS, demo.test\ninnov.as" });

		expect(result.data?.allowedDomains).toEqual(["innov.as", "demo.test"]);
	});

	it("lee un checkbox ausente como falso", () => {
		const result = parse({ active: null, self_signup_by_domain: null });

		expect(result.data?.active).toBe(false);
		expect(result.data?.selfSignupByDomain).toBe(false);
	});

	it("rechaza un nombre vacío", () => {
		expect(message({ display_name: "   " })).toBe(
			"El nombre no puede quedar vacío.",
		);
	});

	it("rechaza un nombre de más de 80 caracteres", () => {
		expect(message({ display_name: "x".repeat(81) })).toBe(
			"El nombre no puede pasar los 80 caracteres.",
		);
	});

	it("rechaza un dominio mal escrito", () => {
		expect(message({ allowed_domains: "innov" })).toBe(
			'"innov" no es un dominio válido.',
		);
	});

	it("rechaza el alta por dominio sin dominios", () => {
		expect(message({ allowed_domains: "" })).toBe(
			"Para permitir el alta por dominio hace falta al menos un dominio.",
		);
	});

	it("rechaza la lista de modelos vacía", () => {
		expect(message({ allowed_models: "" })).toBe(
			"Tiene que haber al menos un modelo permitido.",
		);
	});

	it("rechaza un modelo sin proveedor", () => {
		expect(message({ allowed_models: "claude-sonnet-5" })).toBe(
			'"claude-sonnet-5" no tiene la forma proveedor/modelo.',
		);
	});

	it("rechaza un modelo por defecto que no está entre los permitidos", () => {
		expect(message({ allowed_models: "anthropic/claude-haiku-4-5" })).toBe(
			"El modelo por defecto tiene que estar entre los permitidos.",
		);
	});

	it("rechaza un color que no es #RRGGBB", () => {
		expect(message({ primary: "azul" })).toBe(
			"Los colores van como #RRGGBB.",
		);
	});
});

describe("mergeBrand", () => {
	it("conserva las claves que el formulario no conoce", () => {
		expect(
			mergeBrand(
				{ primary: "#000000", logo_url: "innovas/logo.png", font: "Geist" },
				{ primary: "#1D4ED8", secondary: "#0F172A" },
			),
		).toEqual({
			primary: "#1D4ED8",
			secondary: "#0F172A",
			logo_url: "innovas/logo.png",
			font: "Geist",
		});
	});

	it("saca un color que se dejó vacío", () => {
		expect(
			mergeBrand(
				{ primary: "#000000", secondary: "#111111" },
				{ primary: "", secondary: "#111111" },
			),
		).toEqual({ secondary: "#111111" });
	});

	it("pisa el logo solo cuando llega uno nuevo", () => {
		expect(
			mergeBrand(
				{ logo_url: "innovas/logo.png" },
				{ primary: "", secondary: "", logoUrl: "innovas/logo-2.png" },
			),
		).toEqual({ logo_url: "innovas/logo-2.png" });
	});
});

describe("validateLogo", () => {
	it("acepta png, svg y webp y devuelve la extensión", () => {
		expect(validateLogo({ type: "image/png", size: 10 })).toEqual({
			ok: true,
			ext: "png",
		});
		expect(validateLogo({ type: "image/svg+xml", size: 10 })).toEqual({
			ok: true,
			ext: "svg",
		});
		expect(validateLogo({ type: "image/webp", size: 10 })).toEqual({
			ok: true,
			ext: "webp",
		});
	});

	it("rechaza otro tipo de archivo", () => {
		expect(validateLogo({ type: "image/jpeg", size: 10 })).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
	});

	it("rechaza un archivo de más de 1 MB", () => {
		expect(validateLogo({ type: "image/png", size: 1_048_577 })).toEqual({
			ok: false,
			message: "El logo no puede pesar más de 1 MB.",
		});
	});
});
