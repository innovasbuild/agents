import { describe, expect, it } from "vitest";
import {
	ancestorChain,
	parentPath,
	resolveAccess,
} from "@/lib/brain/core/access/resolve-access";
import {
	type AccessRule,
	atLeast,
	DEFAULT_ROOT_RULE,
	type Level,
	maxLevel,
	type Principal,
} from "@/lib/brain/core/access/types";

const member = (userId: string): Principal => ({
	kind: "user",
	userId,
	role: "tenant_member",
});
const general = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const person = (path: string, userId: string, level: Level): AccessRule => ({
	path,
	principal: "user",
	userId,
	level,
});

describe("parentPath y ancestorChain", () => {
	it("sube de a un segmento hasta la raíz", () => {
		expect(parentPath("a/b/c")).toBe("a/b");
		expect(parentPath("a")).toBe("");
		expect(parentPath("")).toBeNull();
	});

	it("la cadena empieza en la raíz y termina en el nodo", () => {
		expect(ancestorChain("a/b/c")).toEqual(["", "a", "a/b", "a/b/c"]);
		expect(ancestorChain("a")).toEqual(["", "a"]);
		expect(ancestorChain("")).toEqual([""]);
	});
});

describe("niveles", () => {
	it("atLeast compara por orden y trata null como sin acceso", () => {
		expect(atLeast("administrador", "editor")).toBe(true);
		expect(atLeast("editor", "editor")).toBe(true);
		expect(atLeast("lector", "editor")).toBe(false);
		expect(atLeast(null, "lector")).toBe(false);
	});

	it("maxLevel elige el mayor y respeta null", () => {
		expect(maxLevel("lector", "editor")).toBe("editor");
		expect(maxLevel(null, "lector")).toBe("lector");
		expect(maxLevel(null, null)).toBeNull();
	});
});

// Los casos de la spec §3.3.
describe("resolveAccess · tabla de la spec", () => {
	const cases: Array<{
		name: string;
		rules: AccessRule[];
		principal: Principal;
		path: string;
		expected: Level | null;
	}> = [
		{
			name: "raíz abierta, miembro sin reglas",
			rules: [general("", "lector")],
			principal: member("ana"),
			path: "comercial/icp",
			expected: "lector",
		},
		{
			name: "carpeta restringida oculta lo de adentro",
			rules: [general("", "lector"), general("direccion", "ninguno")],
			principal: member("ana"),
			path: "direccion/presupuesto",
			expected: null,
		},
		{
			name: "una persona con lectura en la carpeta restringida la ve",
			rules: [
				general("", "lector"),
				general("direccion", "ninguno"),
				person("direccion", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "direccion/presupuesto",
			expected: "lector",
		},
		{
			name: "y ve la carpeta misma",
			rules: [
				general("", "lector"),
				general("direccion", "ninguno"),
				person("direccion", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "direccion",
			expected: "lector",
		},
		{
			name: "lo dado arriba por persona no se quita abajo",
			rules: [person("", "marcos", "editor"), general("direccion", "ninguno")],
			principal: member("marcos"),
			path: "direccion/presupuesto",
			expected: "editor",
		},
		{
			name: "el acceso general más profundo gana: editor en comercial",
			rules: [general("", "lector"), general("comercial", "editor")],
			principal: member("ana"),
			path: "comercial/icp",
			expected: "editor",
		},
		{
			name: "y una subcarpeta restringida lo vuelve a cerrar",
			rules: [
				general("", "lector"),
				general("comercial", "editor"),
				general("comercial/interno", "ninguno"),
			],
			principal: member("ana"),
			path: "comercial/interno/notas",
			expected: null,
		},
		{
			name: "raíz cerrada y una página suelta dada a una persona",
			rules: [
				general("", "ninguno"),
				person("comercial/icp", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "comercial/icp",
			expected: "lector",
		},
		{
			name: "la carpeta de esa página suelta sigue oculta",
			rules: [
				general("", "ninguno"),
				person("comercial/icp", "cecilia", "lector"),
			],
			principal: member("cecilia"),
			path: "comercial",
			expected: null,
		},
		{
			name: "un tenant_admin ve todo aunque la raíz esté cerrada",
			rules: [general("", "ninguno"), general("direccion", "ninguno")],
			principal: { kind: "user", userId: "root", role: "tenant_admin" },
			path: "direccion/presupuesto",
			expected: "administrador",
		},
	];

	it.each(cases)("$name", ({ rules, principal, path, expected }) => {
		expect(resolveAccess(rules, principal, path)).toBe(expected);
	});
});

describe("resolveAccess · bordes", () => {
	it("una regla por persona sobre un slug no abre a sus hermanos", () => {
		const rules = [
			general("", "ninguno"),
			person("direccion/presupuesto", "cecilia", "lector"),
		];
		expect(
			resolveAccess(rules, member("cecilia"), "direccion/presupuesto"),
		).toBe("lector");
		expect(
			resolveAccess(rules, member("cecilia"), "direccion/otra"),
		).toBeNull();
		expect(resolveAccess(rules, member("cecilia"), "direccion")).toBeNull();
	});

	it("las reglas de otra persona no cuentan", () => {
		const rules = [
			general("", "ninguno"),
			person("direccion", "cecilia", "editor"),
		];
		expect(
			resolveAccess(rules, member("beto"), "direccion/presupuesto"),
		).toBeNull();
	});

	it("sin ninguna regla de acceso general el tenant sigue leyendo (lector)", () => {
		expect(resolveAccess([], member("ana"), "comercial/icp")).toBe("lector");
		expect(
			resolveAccess(
				[person("x", "otra", "editor")],
				member("ana"),
				"comercial/icp",
			),
		).toBe("lector");
	});

	it("la regla de la raíz por defecto es lector para todos los miembros", () => {
		expect(DEFAULT_ROOT_RULE).toEqual({
			path: "",
			principal: "members",
			userId: null,
			level: "lector",
		});
	});

	it("un platform_admin con rol de usuario, el agente, la plataforma y el import son administradores", () => {
		const rules = [general("", "ninguno")];
		const principals: Principal[] = [
			{ kind: "user", userId: "root", role: "platform_admin" },
			{ kind: "agent", agent: "outreach" },
			{ kind: "platform" },
			{ kind: "import" },
		];
		for (const principal of principals) {
			expect(resolveAccess(rules, principal, "direccion/presupuesto")).toBe(
				"administrador",
			);
		}
	});
});
