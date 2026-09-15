import { describe, expect, it } from "vitest";
import { toAgentOutputSchema } from "@/lib/outreach/agent-schema";
import { fichaSchema } from "@/lib/outreach/ficha";

describe("toAgentOutputSchema", () => {
	it("convierte zod a JSON Schema de objeto, sin $schema", () => {
		const schema = toAgentOutputSchema(fichaSchema);
		expect(schema.type).toBe("object");
		expect(schema.$schema).toBeUndefined();
		expect(Object.keys(schema.properties as object)).toContain("hechos");
	});
});
