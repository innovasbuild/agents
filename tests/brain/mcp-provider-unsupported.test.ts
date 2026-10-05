import { describe, expect, it } from "vitest";
import { BrainProviderError } from "@/lib/brain/core/errors";
import { createMcpBrainProvider } from "@/lib/brain/core/mcp";
import type { McpBrainConfig } from "@/lib/brain/core/mcp-config";

// Un brain externo se edita en su origen: no se lista ni tiene historial acá.
// El transporte tira si alguien intenta conectarse.
const provider = createMcpBrainProvider({
	config: {} as McpBrainConfig,
	transport: async () => {
		throw new Error("no debe conectarse");
	},
});

describe("proveedor mcp · list e history", () => {
	it("list falla con un error del brain", async () => {
		await expect(provider.list()).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("history falla con un error del brain", async () => {
		await expect(provider.history("comercial/icp")).rejects.toBeInstanceOf(
			BrainProviderError,
		);
	});
});
