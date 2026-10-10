import { describe, expect, it, vi } from "vitest";
import type { CanonLoad } from "@/lib/outreach/canon";
import { createIcpCache } from "@/lib/outreach/icp-cache";

const OK = { ok: true, value: {} } as unknown as CanonLoad<never>;
const DOWN: CanonLoad<never> = { ok: false, reason: "brain_caido", errors: [] };

describe("createIcpCache", () => {
	it("un resultado ok se lee una vez por tenant y corrida", async () => {
		const read = vi.fn(async () => OK);
		const load = createIcpCache(read);
		await load("t1", "r1");
		await load("t1", "r1");
		expect(read).toHaveBeenCalledTimes(1);
		await load("t2", "r1");
		await load("t1", "r2");
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("un fallo no se cachea: el próximo ítem vuelve a leer", async () => {
		const read = vi
			.fn<() => Promise<CanonLoad<never>>>()
			.mockResolvedValueOnce(DOWN)
			.mockResolvedValueOnce(OK);
		const load = createIcpCache(read);
		expect(await load("t1", "r1")).toEqual(DOWN);
		expect(await load("t1", "r1")).toEqual(OK);
		expect(await load("t1", "r1")).toEqual(OK);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("una lectura que tira tampoco se cachea", async () => {
		const read = vi
			.fn<() => Promise<CanonLoad<never>>>()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(OK);
		const load = createIcpCache(read);
		await expect(load("t1", "r1")).rejects.toThrow("boom");
		expect(await load("t1", "r1")).toEqual(OK);
	});
});
