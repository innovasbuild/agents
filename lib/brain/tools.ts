// Tools del brain para un agente (spec etapa 11 §8.2). La aprobación de
// brain_upsert vive acá y no en el contrato: por MCP no aplica (D5).
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { decideBrainUpsertResponse } from "./approval.ts";
import { brainContract } from "./contract.ts";
import { toToolError } from "./errors.ts";
import { getBrainProvider } from "./provider.ts";
import type { BrainBinding } from "./resolve.ts";
import type { BrainProvider } from "./types.ts";

function buildBrainReadTools(
	contract: ReturnType<typeof brainContract>,
	provider: () => BrainProvider,
) {
	const brain_search = defineTool({
		description: `${contract.search.description} Usalo antes de investigar o redactar.`,
		inputSchema: contract.search.input,
		execute: async (input) => {
			try {
				return { ok: true as const, results: await provider().search(input) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	const brain_read = defineTool({
		description: contract.read.description,
		inputSchema: contract.read.input,
		execute: async ({ slug }) => {
			try {
				return { ok: true as const, page: await provider().read(slug) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	return { brain_search, brain_read };
}

function buildBrainUpsertTool(
	binding: BrainBinding,
	contract: ReturnType<typeof brainContract>,
	provider: () => BrainProvider,
) {
	return defineTool({
		description: `${contract.upsert.description} Siempre la aprueba un administrador.`,
		inputSchema: contract.upsert.input,
		approval: {
			request: always(),
			response: ({ responder }) =>
				decideBrainUpsertResponse(responder, binding.tenantId),
		},
		execute: async (input, toolCtx) => {
			const initiator = toolCtx.session.auth.initiator;
			const userId =
				initiator?.principalType === "user" ? initiator.principalId : null;
			try {
				const result = await provider().upsert(input, {
					kind: "agent",
					userId,
					sessionId: toolCtx.session.id,
				});
				return { ok: true as const, ...result };
			} catch (error) {
				return toToolError(error);
			}
		},
	});
}

type BrainReadTools = ReturnType<typeof buildBrainReadTools>;
type BrainUpsertTool = ReturnType<typeof buildBrainUpsertTool>;

export function createBrainTools(
	binding: BrainBinding,
	access: "read" | "read_write",
	deps: { provider?: (binding: BrainBinding) => BrainProvider } = {},
): BrainReadTools | (BrainReadTools & { brain_upsert: BrainUpsertTool }) {
	const provider = () => (deps.provider ?? getBrainProvider)(binding);
	const contract = brainContract(binding.config.categories);
	const readTools = buildBrainReadTools(contract, provider);

	if (access === "read") return readTools;

	const brain_upsert = buildBrainUpsertTool(binding, contract, provider);
	return { ...readTools, brain_upsert };
}
