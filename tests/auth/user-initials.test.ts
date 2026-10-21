import { describe, expect, it } from "vitest";
import { userInitials } from "@/lib/auth/user-initials";

describe("userInitials", () => {
	it("toma las iniciales de la parte local del mail", () => {
		expect(userInitials("matias.okeefe@innov.as")).toBe("MO");
		expect(userInitials("marcos_perez@innov.as")).toBe("MP");
		expect(userInitials("it@innov.as")).toBe("I");
	});

	it("sin mail no inventa: devuelve null", () => {
		expect(userInitials(undefined)).toBeNull();
		expect(userInitials("")).toBeNull();
		expect(userInitials("@innov.as")).toBeNull();
	});
});
