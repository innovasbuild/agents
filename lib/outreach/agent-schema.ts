import { z } from "zod";

// ctx.agent pide outputSchema como JSON Schema (spec 03 §13.1 S4). El tipo que
// devuelve zod no calza con el JsonObject de eve: la conversión vive solo acá.
export function toAgentOutputSchema(
	schema: z.ZodType,
): Record<string, unknown> {
	const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
	delete json.$schema;
	return json;
}
