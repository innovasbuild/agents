import { describe, expect, it } from "vitest";
import {
	DUPLICATE_RULE,
	rootRuleRow,
} from "../../scripts/connections-bind-rule";

describe("rootRuleRow", () => {
	it("abre la raíz a todos los miembros del tenant, en lectura", () => {
		expect(rootRuleRow("tenant-a")).toEqual({
			tenant_id: "tenant-a",
			path: "",
			principal: "members",
			user_id: null,
			level: "lector",
		});
	});

	it("reconoce el error de duplicado de Postgres", () => {
		expect(DUPLICATE_RULE).toBe("23505");
	});
});
