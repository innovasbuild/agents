import { describe, expect, it, vi } from "vitest";
import { BrainRateLimited } from "@/lib/brain/errors";
import {
	createRateLimiter,
	type HitFn,
} from "@/lib/brain/mcp-server/rate-limit";

const limits = { readsPerMinute: 60, writesPerMinute: 10 };

describe("createRateLimiter", () => {
	it("pasa el límite que corresponde al tipo", async () => {
		const hit = vi.fn<HitFn>(async () => ({
			allowed: true,
			retryAfterSeconds: 0,
		}));
		const limiter = createRateLimiter({
			tenantId: "t",
			userId: "u",
			limits,
			hit,
		});
		await limiter.check("read");
		await limiter.check("write");
		expect(hit.mock.calls.map(([input]) => input)).toEqual([
			{ tenantId: "t", userId: "u", kind: "read", limit: 60 },
			{ tenantId: "t", userId: "u", kind: "write", limit: 10 },
		]);
	});

	it("la llamada 61 se corta con los segundos que faltan", async () => {
		let count = 0;
		const limiter = createRateLimiter({
			tenantId: "t",
			userId: "u",
			limits,
			hit: async ({ limit }) => {
				count += 1;
				return count <= limit
					? { allowed: true, retryAfterSeconds: 0 }
					: { allowed: false, retryAfterSeconds: 17 };
			},
		});
		for (let i = 0; i < 60; i += 1) await limiter.check("read");
		const error = await limiter.check("read").catch((caught) => caught);
		expect(error).toBeInstanceOf(BrainRateLimited);
		expect(error.retryAfterSeconds).toBe(17);
	});
});
