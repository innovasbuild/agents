import { describe, expect, it } from "vitest";
import {
	ilikePattern,
	parseContactFilters,
	toContactRows,
} from "@/lib/outreach/contactos-query";

const raw = {
	id: "c1",
	contact_key: "em:ana@acme.test",
	name: "Ana",
	company: "Acme",
	email: "ana@acme.test",
	stage: "msg1_enviado",
	touches: 1,
	last_touch_at: "2026-09-14T12:00:00Z",
	next_step_at: "2026-09-18T12:00:00Z",
	vector: "linkedin",
	hook: "cuello_operativo",
	owner_user_id: "u1",
	executors: { slug: "mati" },
	accounts: { domain: "acme.test" },
};

describe("toContactRows", () => {
	it("aplana los joins de ejecutor y cuenta", () => {
		const [row] = toContactRows([raw]);

		expect(row).toMatchObject({
			ownerSlug: "mati",
			accountDomain: "acme.test",
			contactKey: "em:ana@acme.test",
		});
	});

	it("acepta el join como array, que es lo que devuelve PostgREST a veces", () => {
		const [row] = toContactRows([
			{
				...raw,
				executors: [{ slug: "marcos" }],
				accounts: [{ domain: "beta.test" }],
			},
		]);

		expect(row.ownerSlug).toBe("marcos");
		expect(row.accountDomain).toBe("beta.test");
	});

	it("tolera un contacto sin cuenta y sin dueño", () => {
		const [row] = toContactRows([{ ...raw, executors: null, accounts: null }]);

		expect(row.ownerSlug).toBeNull();
		expect(row.accountDomain).toBeNull();
	});

	it("normaliza touches ausente a cero en vez de dejarlo indefinido", () => {
		const [row] = toContactRows([{ ...raw, touches: null }]);

		expect(row.touches).toBe(0);
	});

	it("trae el carril y el puntaje del ICP", () => {
		const rows = toContactRows([
			{
				id: "1",
				contact_key: "em:a@b.test",
				stage: "a_contactar",
				touches: 0,
				icp: { lane: "calificado", encaje_empresa: { score: 1.8 } },
			},
		]);
		expect(rows[0]).toMatchObject({ icpLane: "calificado", icpScore: 1.8 });
	});

	it("un contacto sin calificar trae ambos en null", () => {
		const rows = toContactRows([
			{
				id: "1",
				contact_key: "em:a@b.test",
				stage: "a_contactar",
				touches: 0,
				icp: null,
			},
		]);
		expect(rows[0]).toMatchObject({ icpLane: null, icpScore: null });
	});
});

describe("parseContactFilters", () => {
	it("sin parámetros no filtra nada", () => {
		expect(parseContactFilters(new URLSearchParams())).toEqual({
			etapa: null,
			ejecutor: null,
			vector: null,
			hook: null,
			lane: null,
			q: null,
		});
	});

	it("parsea el filtro de carril desde la URL", () => {
		const filters = parseContactFilters(new URLSearchParams("lane=calificado"));
		expect(filters.lane).toBe("calificado");
	});

	it("toma la etapa que viene del link del embudo", () => {
		const filters = parseContactFilters(
			new URLSearchParams("etapa=msg1_enviado"),
		);

		expect(filters.etapa).toBe("msg1_enviado");
	});

	it("descarta una etapa que no existe en la escalera", () => {
		const filters = parseContactFilters(new URLSearchParams("etapa=inventada"));

		expect(filters.etapa).toBeNull();
	});

	it("recorta la búsqueda y descarta la que quedó vacía", () => {
		expect(parseContactFilters(new URLSearchParams("q=%20%20")).q).toBeNull();
		expect(parseContactFilters(new URLSearchParams("q=%20ana%20")).q).toBe(
			"ana",
		);
	});

	it("acota el largo de la búsqueda", () => {
		const largo = "a".repeat(500);
		const filters = parseContactFilters(new URLSearchParams(`q=${largo}`));

		expect(filters.q?.length).toBe(100);
	});

	it("descarta un ejecutor con forma de slug inválida", () => {
		expect(
			parseContactFilters(new URLSearchParams("ejecutor=MATI!")).ejecutor,
		).toBeNull();
		expect(
			parseContactFilters(new URLSearchParams("ejecutor=mati")).ejecutor,
		).toBe("mati");
	});
});

describe("ilikePattern", () => {
	it("envuelve el texto en comodines para un ilike", () => {
		expect(ilikePattern("ana")).toBe("%ana%");
	});

	it("saca las comas, que en PostgREST separan condiciones dentro de or()", () => {
		expect(ilikePattern("ana,acme")).not.toContain(",");
	});

	it("saca los paréntesis, que en PostgREST delimitan el grupo de or()", () => {
		const pattern = ilikePattern("ana(acme)");
		expect(pattern).not.toContain("(");
		expect(pattern).not.toContain(")");
	});

	it("saca los comodines que trae el usuario, para que no busque cualquier cosa", () => {
		expect(ilikePattern("a%b_c")).toBe("%abc%");
	});

	it("saca las comillas dobles, con las que PostgREST cita valores", () => {
		expect(ilikePattern('ana"acme')).not.toContain('"');
	});

	it("con un texto que era todo caracteres peligrosos devuelve null", () => {
		expect(ilikePattern(",,()")).toBeNull();
	});
});
