// Tools del brain para un agente (spec etapa 11 §8.2). La aprobación de
// brain_upsert vive acá y no en el contrato: por MCP no aplica (D5).
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { AccessRule } from "../core/access/types.ts";
import { decideBrainUpsertResponse } from "../core/approval.ts";
import { brainContract } from "../core/contract.ts";
import { toToolError } from "../core/errors.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider } from "../core/types.ts";
import { type BrainActor, resolveActingProvider } from "./acting-provider.ts";

// Inyección para tests más el actor (JSON). En producción solo llega `actor`.
interface BrainToolOptions {
	actor?: BrainActor;
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
}

function buildBrainReadTools(
	contract: ReturnType<typeof brainContract>,
	binding: BrainBinding,
	deps: BrainToolOptions,
) {
	// execute() llama a resolveActingProvider directo, sin pasar por una función
	// local: eve compila estos callbacks para poder rehidratarlos entre
	// invocaciones (guides/dynamic-capabilities.md), y solo tolera cerrar
	// sobre datos JSON-serializables más llamadas a imports estables. Una
	// función guardada en una variable local (el `provider` que había acá
	// antes) es un valor no serializable y hace que eve descarte todo el
	// resolver en session.started sin avisar más que por log.
	//
	// Por lo mismo, los schemas se arman inline a partir de un dato JSON: eve
	// (0.59+) convierte la expresión de inputSchema en una fábrica durable y
	// captura solo lo que la expresión usa. Un schema guardado en una variable
	// (contract.search.input) es una captura no serializable.
	//
	// El actor del closure es JSON; la lógica de permisos vive en acting-provider.ts.
	const categories = binding.config.categories;
	const brain_search = defineTool({
		description: `${contract.search.description} Usalo antes de investigar o redactar.`,
		inputSchema: brainContract(categories).search.input,
		execute: async (input) => {
			try {
				const provider = await resolveActingProvider(binding, deps.actor, deps);
				return { ok: true as const, results: await provider.search(input) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	const brain_read = defineTool({
		description: contract.read.description,
		inputSchema: brainContract(categories).read.input,
		execute: async ({ slug }) => {
			try {
				const provider = await resolveActingProvider(binding, deps.actor, deps);
				return { ok: true as const, page: await provider.read(slug) };
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
	deps: BrainToolOptions,
) {
	// Schema inline por la misma razón que en buildBrainReadTools.
	const categories = binding.config.categories;
	return defineTool({
		description: `${contract.upsert.description} Siempre la aprueba un administrador.`,
		inputSchema: brainContract(categories).upsert.input,
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
				const provider = await resolveActingProvider(binding, deps.actor, deps);
				const result = await provider.upsert(input, {
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
	deps: BrainToolOptions = {},
): BrainReadTools | (BrainReadTools & { brain_upsert: BrainUpsertTool }) {
	const contract = brainContract(binding.config.categories);
	const readTools = buildBrainReadTools(contract, binding, deps);

	if (access === "read") return readTools;

	const brain_upsert = buildBrainUpsertTool(binding, contract, deps);
	return { ...readTools, brain_upsert };
}
