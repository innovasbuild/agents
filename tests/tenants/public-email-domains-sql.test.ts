import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/tenants/public-email-domains";

describe("is_public_email_domain (SQL) vs PUBLIC_EMAIL_DOMAINS", () => {
	it("tienen exactamente los mismos dominios", () => {
		const sql = readFileSync(
			"supabase/migrations/20261012120000_join_by_domain.sql",
			"utf8",
		);
		const fn = sql.match(
			/function public\.is_public_email_domain[\s\S]*?array\[([\s\S]*?)\]/,
		);
		expect(fn).not.toBeNull();
		const dominios = [...(fn?.[1] ?? "").matchAll(/'([^']+)'/g)].map(
			(m) => m[1],
		);
		expect(dominios.length).toBeGreaterThan(0);
		expect([...dominios].sort()).toEqual([...PUBLIC_EMAIL_DOMAINS].sort());
	});
});
