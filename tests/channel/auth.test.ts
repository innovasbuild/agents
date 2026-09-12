import { describe, expect, it } from "vitest";

const BASE = process.env.SPIKE_BASE_URL ?? "http://localhost:3000";

describe("canal eve", () => {
	it("rechaza a un caller sin sesión", async () => {
		const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/info`);
		expect([401, 403]).toContain(res.status);
	});

	it("deja pasar el health, que es público por diseño", async () => {
		const res = await fetch(`${BASE}/eve/agents/outreach/eve/v1/health`);
		expect(res.status).toBe(200);
	});
});
