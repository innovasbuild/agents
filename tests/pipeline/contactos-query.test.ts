import { describe, expect, it } from "vitest";
import {
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
});

describe("parseContactFilters", () => {
	it("sin parámetros no filtra nada", () => {
		expect(parseContactFilters(new URLSearchParams())).toEqual({
			etapa: null,
			ejecutor: null,
			vector: null,
			hook: null,
			q: null,
		});
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
