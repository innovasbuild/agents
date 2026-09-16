// tests/cola/cola-query.test.ts
import { describe, expect, it } from "vitest";
import { toColaRows } from "@/lib/outreach/cola-query";

const raw = {
	id: "11111111-1111-4111-8111-111111111111",
	subject: "Crecer sin sumar gente",
	body: "Hola.",
	to_email: "ana@acme.test",
	kind: "msg1",
	status: "pending",
	hook: "cuello_operativo",
	vector: "linkedin",
	expires_at: "2026-09-23T12:00:00Z",
	error: null,
	executor_user_id: "u1",
	executors: { slug: "mati" },
	contacts: { name: "Ana", company: "Acme", stage: "a_contactar" },
};

describe("toColaRows", () => {
	it("aplana los joins de contacto y ejecutor", () => {
		const [row] = toColaRows([raw]);

		expect(row).toMatchObject({
			ownerSlug: "mati",
			contactName: "Ana",
			contactCompany: "Acme",
			contactStage: "a_contactar",
			toEmail: "ana@acme.test",
		});
	});

	it("marca trabada una pieza en approved", () => {
		const [row] = toColaRows([{ ...raw, status: "approved" }]);

		expect(row.trabada).toBe(true);
	});

	it("no marca trabada una pieza pendiente", () => {
		expect(toColaRows([raw])[0].trabada).toBe(false);
	});

	it("tolera un contacto o ejecutor sin join resuelto", () => {
		const [row] = toColaRows([{ ...raw, executors: null, contacts: null }]);

		expect(row.ownerSlug).toBeNull();
		expect(row.contactName).toBeNull();
	});

	it("acepta el join como array, que es lo que devuelve PostgREST a veces", () => {
		const [row] = toColaRows([
			{
				...raw,
				executors: [{ slug: "marcos" }],
				contacts: [{ name: "Beto", company: "Beta", stage: "msg1_enviado" }],
			},
		]);

		expect(row.ownerSlug).toBe("marcos");
		expect(row.contactName).toBe("Beto");
	});
});
