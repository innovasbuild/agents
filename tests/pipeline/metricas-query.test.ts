import { describe, expect, it } from "vitest";
import { toMetricas } from "@/lib/outreach/metricas-query";

const contacto = (over: Record<string, unknown> = {}) => ({
	contact_key: "em:default@test.com",
	hook: "cuello_operativo",
	vector: "linkedin",
	segment: "agro",
	touches: 1,
	stage: "msg1_enviado",
	owner_user_id: "u1",
	executors: { slug: "mati" },
	...over,
});

const configValues = [
	{ kind: "hook", value: "cuello_operativo", label: "Cuello operativo" },
	{ kind: "vector", value: "linkedin", label: "LinkedIn" },
	{ kind: "segmento", value: "agro", label: "Agro" },
];

describe("toMetricas", () => {
	it("cuenta un contacto como enviado si tiene al menos un toque", () => {
		const m = toMetricas([contacto({ touches: 1 })], [], configValues);

		expect(m.hook.find((r) => r.value === "cuello_operativo")?.enviados).toBe(
			1,
		);
	});

	it("no cuenta como enviado un contacto sin toques", () => {
		const m = toMetricas([contacto({ touches: 0 })], [], configValues);

		expect(m.hook.find((r) => r.value === "cuello_operativo")?.enviados).toBe(
			0,
		);
	});

	it("cuenta como respondió una etapa fuera del set de sin respuesta", () => {
		const m = toMetricas(
			[contacto({ stage: "en_conversacion", touches: 1 })],
			[],
			configValues,
		);

		expect(
			m.hook.find((r) => r.value === "cuello_operativo")?.respondieron,
		).toBe(1);
	});

	it("no cuenta como respondió sin_respuesta, que es específicamente lo contrario", () => {
		const m = toMetricas(
			[contacto({ stage: "sin_respuesta", touches: 1 })],
			[],
			configValues,
		);

		expect(
			m.hook.find((r) => r.value === "cuello_operativo")?.respondieron,
		).toBe(0);
	});

	it("calcula la tasa como porcentaje redondeado de respondieron sobre enviados", () => {
		const m = toMetricas(
			[
				contacto({
					contact_key: "em:a@test.com",
					stage: "en_conversacion",
					touches: 1,
				}),
				contacto({
					contact_key: "em:b@test.com",
					stage: "msg1_enviado",
					touches: 1,
				}),
				contacto({
					contact_key: "em:c@test.com",
					stage: "msg1_enviado",
					touches: 1,
				}),
			],
			[],
			configValues,
		);

		// 1 de 3 respondió: 33%.
		expect(m.hook.find((r) => r.value === "cuello_operativo")?.tasa).toBe(33);
	});

	it("la tasa es 0 y no NaN cuando no hubo envíos", () => {
		const m = toMetricas(
			[contacto({ touches: 0, stage: "a_contactar" })],
			[],
			configValues,
		);

		expect(m.hook.find((r) => r.value === "cuello_operativo")?.tasa).toBe(0);
	});

	it("cuenta un contacto como rebotado si aparece en los eventos de rebote", () => {
		const m = toMetricas(
			[contacto({ contact_key: "em:a@test.com" })],
			[{ contact_key: "em:a@test.com" }],
			configValues,
		);

		expect(m.hook.find((r) => r.value === "cuello_operativo")?.rebotados).toBe(
			1,
		);
	});

	it("un contacto sin hook cae en el bucket sin_clasificar", () => {
		const m = toMetricas([contacto({ hook: null })], [], configValues);

		const bucket = m.hook.find((r) => r.value === "sin_clasificar");
		expect(bucket?.label).toBe("Sin clasificar");
		expect(bucket?.enviados).toBe(1);
	});

	it("usa el label de config_values cuando existe", () => {
		const m = toMetricas([contacto()], [], configValues);

		expect(m.hook.find((r) => r.value === "cuello_operativo")?.label).toBe(
			"Cuello operativo",
		);
	});

	it("cae al value crudo como label si config_values no tiene esa etapa", () => {
		const m = toMetricas([contacto({ hook: "hook_nuevo" })], [], []);

		expect(m.hook.find((r) => r.value === "hook_nuevo")?.label).toBe(
			"hook_nuevo",
		);
	});

	it("agrupa por ejecutor usando el slug del embed", () => {
		const m = toMetricas(
			[contacto({ owner_user_id: "u1", executors: { slug: "mati" } })],
			[],
			[],
		);

		expect(m.ejecutor.find((r) => r.value === "u1")?.label).toBe("mati");
	});

	it("un contacto sin dueño cae en sin_dueño", () => {
		const m = toMetricas(
			[contacto({ owner_user_id: null, executors: null })],
			[],
			[],
		);

		expect(m.ejecutor.find((r) => r.value === "sin_dueno")?.label).toBe(
			"Sin dueño",
		);
	});

	it("con cero contactos devuelve las cuatro dimensiones vacías, sin explotar", () => {
		const m = toMetricas([], [], []);

		expect(m).toEqual({ hook: [], vector: [], segmento: [], ejecutor: [] });
	});
});
