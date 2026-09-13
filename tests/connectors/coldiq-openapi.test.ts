import { describe, expect, it } from "vitest";
import {
	COLDIQ_OPERATIONS,
	coldiqOpenApi,
} from "@/lib/connectors/leads/coldiq.openapi";

type Schema = { type?: string; properties?: Record<string, Schema>; maximum?: number };
type Operation = {
	operationId: string;
	requestBody: { content: { "application/json": { schema: Schema } } };
};
const paths = (coldiqOpenApi as { paths: Record<string, { post: Operation }> }).paths;
const operations = Object.entries(paths).map(([path, item]) => ({ path, op: item.post }));

describe("documento OpenAPI de ColdIQ", () => {
	it("tiene exactamente las operaciones permitidas, con operationId", () => {
		expect(operations.map((o) => o.op.operationId).sort()).toEqual(
			[...COLDIQ_OPERATIONS].sort(),
		);
	});

	it("no incluye operaciones bulk", () => {
		for (const { path } of operations) expect(path).not.toMatch(/bulk|jobs/);
	});

	it("el body solo acepta input individual: sin lotes, proveedor ni tope de créditos", () => {
		for (const { op } of operations) {
			const body = op.requestBody.content["application/json"].schema;
			expect(Object.keys(body.properties ?? {})).toEqual(["input"]);
			expect(body.properties?.input.type).toBe("object");
		}
	});

	it("ningún límite de resultados supera 25", () => {
		for (const { op } of operations) {
			const input = op.requestBody.content["application/json"].schema.properties?.input;
			const limit = input?.properties?.limit;
			if (limit) expect(limit.maximum).toBeLessThanOrEqual(25);
		}
	});
});
