import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ upserts: [] as unknown[][] }));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			upsert: async (...args: unknown[]) => {
				calls.upserts.push(args);
				return { error: null };
			},
		}),
	}),
}));

const { markGmailAuthorized } = await import("@/lib/connectors/executors");

describe("markGmailAuthorized", () => {
	it("hace upsert por tenant y usuario con la fecha", async () => {
		await markGmailAuthorized("tenant-a", "user-1");
		const [values, options] = calls.upserts[0] as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(values).toMatchObject({ tenant_id: "tenant-a", user_id: "user-1" });
		expect(typeof values.gmail_authorized_at).toBe("string");
		expect(options).toEqual({ onConflict: "tenant_id,user_id" });
	});
});
