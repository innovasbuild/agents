import { describe, expect, it } from "vitest";
import { maxInviteRows, seatsUsed } from "@/lib/onboarding/seats";

describe("seatsUsed", () => {
	it("suma miembros, pendientes y filas cargadas", () => {
		expect(seatsUsed({ users: 1, pendingInvitations: 1, filledRows: 1 })).toBe(
			3,
		);
	});
});

describe("maxInviteRows", () => {
	it("empresa nueva: 2 filas", () => {
		expect(maxInviteRows({ users: 1, pendingInvitations: 0 })).toBe(2);
	});
	it("con una pendiente queda 1 fila", () => {
		expect(maxInviteRows({ users: 1, pendingInvitations: 1 })).toBe(1);
	});
	it("sin lugares no hay filas", () => {
		expect(maxInviteRows({ users: 1, pendingInvitations: 2 })).toBe(0);
	});
});
