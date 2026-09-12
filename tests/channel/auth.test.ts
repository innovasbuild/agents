import { describe, expect, it } from "vitest";

const BASE = process.env.SPIKE_BASE_URL ?? "http://localhost:3000";

// Estos tests hacen HTTP real contra un dev server corriendo. Sin
// SPIKE_BASE_URL seteada, se skippean para que `npm test` dé verde en un
// checkout limpio, sin necesitar un server levantado.
describe.skipIf(!process.env.SPIKE_BASE_URL)("canal eve", () => {
	it("rechaza a un caller sin sesión", async () => {
		const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/info`);
		expect([401, 403]).toContain(res.status);
	});

	it("deja pasar el health, que es público por diseño", async () => {
		const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/health`);
		expect(res.status).toBe(200);
	});

	it("exige sesión para continuar una sesión existente, no solo para crearla", async () => {
		const response = await fetch(
			`${process.env.SPIKE_BASE_URL}/eve/agents/outreach/eve/v1/session/wrun_inexistente`,
			{ method: "POST", body: JSON.stringify({ message: "hola" }) },
		);

		expect(response.status).toBe(401);
	});
});
