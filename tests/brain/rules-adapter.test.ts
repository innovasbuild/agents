import { describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({
	createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { getBrainRules } from "@/lib/brain/adapters/rules";
import { EMPTY_RULES } from "@/lib/brain/core/rules-source";

describe("getBrainRules", () => {
	it("un brain externo por MCP no tiene reglas", () => {
		expect(getBrainRules({ provider: "mcp" } as never)).toBe(EMPTY_RULES);
	});

	it("un brain wiki lee de Supabase recién al pedir las reglas", () => {
		const source = getBrainRules({
			id: "b",
			tenantId: "t",
			provider: "wiki",
			config: {},
		} as never);
		expect(source).not.toBe(EMPTY_RULES);
		expect(createAdminClient).not.toHaveBeenCalled();
	});
});
