import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/auth", () => ({
	apiKeyHeaders: (uid: string, header: string, extra = {}) =>
		Object.assign(async () => ({ ...extra, [header]: `llave:${uid}` }), {
			uid,
			header,
		}),
	apiKeyBearer: (uid: string) => ({
		uid,
		getToken: async () => ({ token: uid }),
	}),
	tenantScopedConnect: (connector: string, tenantId: string) => ({
		connector,
		tenantId,
		getToken: async () => ({ token: `${connector}:${tenantId}` }),
		principalType: "user",
	}),
}));

const { buildTenantConnections, GOOGLE_PLACES_FIELD_MASK } = await import(
	"@/lib/connectors/catalog"
);
const platform = await import("@/lib/connectors/platform");
const { COLDIQ_OPERATIONS, coldiqOpenApi } = await import(
	"@/lib/connectors/leads/coldiq.openapi"
);

import type { Binding } from "@/lib/connectors/providers";

type AnyConnection = Record<string, unknown>;

function binding(overrides: Partial<Binding>): Binding {
	return {
		id: "binding-1",
		tenantId: "tenant-a",
		capability: "leads",
		provider: "coldiq",
		connectorUid: "tenant-a-coldiq",
		config: {},
		...overrides,
	};
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("leads", () => {
	const coldiq = binding({
		id: "binding-coldiq",
		capability: "leads",
		provider: "coldiq",
		connectorUid: "tenant-a-coldiq",
		config: {},
	});
	const places = binding({
		id: "binding-places",
		capability: "leads",
		provider: "google-places",
		connectorUid: "tenant-a-places",
		config: {},
	});

	it("dos proveedores de leads dan dos conexiones con nombres distintos", () => {
		const result = buildTenantConnections([coldiq, places]);
		expect(Object.keys(result).sort()).toEqual([
			"leads-coldiq",
			"leads-google-places",
		]);
	});

	it("ColdIQ es OpenAPI inline con Bearer del conector del binding", async () => {
		const result = buildTenantConnections([coldiq]) as unknown as Record<
			string,
			AnyConnection
		>;
		const connection = result["leads-coldiq"];
		expect(connection.baseUrl).toBe(platform.COLDIQ_BASE_URL);
		expect(connection.spec).toBe(coldiqOpenApi);
		expect(connection.operations).toEqual({ allow: [...COLDIQ_OPERATIONS] });
		expect(connection.instanceKey).toBe("binding-coldiq");
		expect(connection.approval).toBeUndefined();
		// eve normaliza el objeto `auth` a { getToken, principalType } antes de
		// devolverlo (defineOpenAPIConnection -> normalizeAuthorizationSpec), así
		// que `uid` no sobrevive: se verifica el mismo Bearer por-binding a
		// través de `getToken`, que sí pasa intacto.
		const auth = connection.auth as {
			getToken: () => Promise<{ token: string }>;
		};
		expect((await auth.getToken()).token).toBe("tenant-a-coldiq");
	});

	it("ColdIQ se omite sin conector", () => {
		expect(buildTenantConnections([{ ...coldiq, connectorUid: null }])).toEqual(
			{},
		);
		expect(warn).toHaveBeenCalled();
	});

	it("Places expone solo searchText con field mask fijo", async () => {
		const result = buildTenantConnections([places]) as unknown as Record<
			string,
			AnyConnection
		>;
		const connection = result["leads-google-places"];
		expect(connection.operations).toEqual({ allow: ["searchText"] });
		expect(connection.baseUrl).toBe("https://places.googleapis.com");
		const headers = connection.headers as () => Promise<Record<string, string>>;
		expect(await headers()).toEqual({
			"X-Goog-Api-Key": "llave:tenant-a-places",
			"X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
		});
	});
});

describe("buildTenantConnections", () => {
	it("omite proveedores desconocidos", () => {
		expect(
			buildTenantConnections([binding({ provider: "salesforce" })]),
		).toEqual({});
		expect(warn).toHaveBeenCalled();
	});

	it("un tenant sin bindings no tiene conexiones", () => {
		expect(buildTenantConnections([])).toEqual({});
	});

	it("omite un binding cuya capacidad no coincide con la del proveedor", () => {
		expect(buildTenantConnections([binding({ capability: "crm" })])).toEqual(
			{},
		);
	});

	it("avisa y omite un binding cuyo proveedor no produce conexión de eve", () => {
		expect(
			buildTenantConnections([
				binding({ capability: "mail", provider: "gmail" }),
			]),
		).toEqual({});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("no es una conexión de eve"),
		);
	});

	it("distingue 'binding incompleto' de 'sin builder todavía'", () => {
		buildTenantConnections([
			binding({
				capability: "leads",
				provider: "coldiq",
				connectorUid: null,
			}),
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("binding incompleto"),
		);
		expect(warn).not.toHaveBeenCalledWith(
			expect.stringContaining("sin builder todavía"),
		);
	});

	it("avisa y omite en colisión de nombre de conexión", () => {
		const first = binding({
			id: "binding-coldiq-1",
			capability: "leads",
			provider: "coldiq",
			connectorUid: "tenant-a-coldiq-1",
		});
		const second = binding({
			id: "binding-coldiq-2",
			capability: "leads",
			provider: "coldiq",
			connectorUid: "tenant-a-coldiq-2",
		});
		const result = buildTenantConnections([first, second]) as unknown as Record<
			string,
			{ instanceKey: string }
		>;
		expect(Object.keys(result)).toEqual(["leads-coldiq"]);
		expect(result["leads-coldiq"].instanceKey).toBe("binding-coldiq-1");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("nombre de conexión duplicado"),
		);
	});
});

describe("crm HubSpot", () => {
	const hubspot = binding({
		id: "binding-crm",
		capability: "crm",
		provider: "hubspot",
		connectorUid: null,
		config: {},
	});
	const crmName = "crm-binding-crm";

	it("el nombre de conexión incluye el id del binding (evita colisión cross-tenant) y usa el MCP y el allow del spike", () => {
		const result = buildTenantConnections([hubspot]) as unknown as Record<
			string,
			AnyConnection
		>;
		expect(result).toHaveProperty(crmName);
		const crm = result[crmName];
		expect(crm.url).toBe(platform.HUBSPOT_MCP_URL);
		expect(crm.tools).toEqual({ allow: [...platform.HUBSPOT_READ_TOOLS] });
		expect(crm.instanceKey).toBe("binding-crm");
	});

	it("autoriza con el conector de plataforma atado al tenant del binding", async () => {
		const result = buildTenantConnections([hubspot]) as unknown as Record<
			string,
			AnyConnection
		>;
		const crm = result[crmName];
		// eve normaliza auth a { getToken, principalType }, preservando la función.
		// El token encoda el conector y tenant para probar que tenantScopedConnect
		// recibió los argumentos correctos (previene cross-tenant credential leakage).
		const auth = crm.auth as {
			getToken: () => Promise<{ token: string }>;
		};
		expect((await auth.getToken()).token).toBe(
			`${platform.HUBSPOT_CONNECTOR_UID}:tenant-a`,
		);
	});

	it("es solo lectura: sin política de aprobación", () => {
		const result = buildTenantConnections([hubspot]) as unknown as Record<
			string,
			AnyConnection
		>;
		expect(result[crmName].approval).toBeUndefined();
	});

	it("un tenant sin binding de crm no expone crm", () => {
		expect(buildTenantConnections([binding({})])).not.toHaveProperty(crmName);
	});

	it("gmail nunca produce conexión", () => {
		expect(
			buildTenantConnections([
				binding({
					capability: "mail",
					provider: "gmail",
					connectorUid: null,
					config: {},
				}),
			]),
		).toEqual({});
	});

	it("dos tenants con su propio binding de hubspot nunca comparten el nombre de conexión (spike S7: fuga de credenciales OAuth cross-tenant)", () => {
		const tenantA = binding({
			id: "binding-crm-tenant-a",
			tenantId: "tenant-a",
			capability: "crm",
			provider: "hubspot",
			connectorUid: null,
		});
		const tenantB = binding({
			id: "binding-crm-tenant-b",
			tenantId: "tenant-b",
			capability: "crm",
			provider: "hubspot",
			connectorUid: null,
		});

		const namesA = Object.keys(buildTenantConnections([tenantA]));
		const namesB = Object.keys(buildTenantConnections([tenantB]));

		expect(namesA).toHaveLength(1);
		expect(namesB).toHaveLength(1);
		expect(namesA[0]).not.toBe(namesB[0]);
	});
});
