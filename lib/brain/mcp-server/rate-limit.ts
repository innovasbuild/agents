// Límite por minuto del endpoint MCP del brain (spec etapa 11 §6).
import { BrainRateLimited } from "../errors.ts";
import type { McpLimits } from "../limits.ts";

export type HitFn = (input: {
	tenantId: string;
	userId: string;
	kind: "read" | "write";
	limit: number;
}) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;

export interface RateLimiter {
	check(kind: "read" | "write"): Promise<void>;
}

export function createRateLimiter(input: {
	tenantId: string;
	userId: string;
	limits: McpLimits;
	hit: HitFn;
}): RateLimiter {
	return {
		async check(kind) {
			const limit =
				kind === "read"
					? input.limits.readsPerMinute
					: input.limits.writesPerMinute;
			const result = await input.hit({
				tenantId: input.tenantId,
				userId: input.userId,
				kind,
				limit,
			});
			if (!result.allowed) throw new BrainRateLimited(result.retryAfterSeconds);
		},
	};
}
