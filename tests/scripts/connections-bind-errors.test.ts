import { describe, expect, it } from "vitest";
import { describeBindError } from "@/scripts/connections-bind-errors";

describe("describeBindError", () => {
	it("un segundo brain nombra el que ya está habilitado", () => {
		expect(
			describeBindError(
				{
					code: "23505",
					message:
						'duplicate key value violates unique constraint "tenant_connections_one_brain"',
				},
				"wiki",
			),
		).toBe(
			"el tenant ya tiene un brain habilitado (wiki): deshabilitalo antes de dar de alta otro",
		);
	});

	it("otro error pasa con su mensaje", () => {
		expect(
			describeBindError({ code: "42501", message: "permission denied" }, null),
		).toBe("no pude guardar el binding: permission denied");
	});
});
