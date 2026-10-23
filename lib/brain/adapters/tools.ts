// Tools del brain para un agente (spec etapa 11 §8.2). La aprobación de
// brain_upsert vive acá y no en el contrato: por MCP no aplica (D5).
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { AccessRule } from "../core/access/types.ts";
import { decideBrainUpsertResponse } from "../core/approval.ts";
import { brainContract } from "../core/contract.ts";
import { agentReservedSlug, toToolError } from "../core/errors.ts";
import type { BrainBinding } from "../core/resolve.ts";
import { isReservedSlug, withoutRoot } from "../core/rules.ts";
import {
	type RulesSource,
	requireRules,
	withoutSkillRules,
} from "../core/rules-source.ts";
import { assistantCategories } from "../core/skills/package.ts";
import { rejectSkillWrite, withoutSkills } from "../core/skills/view.ts";
import type { BrainProvider } from "../core/types.ts";
import {
	type BrainActor,
	resolveActingBrain,
	resolveActingProvider,
	resolveActingRules,
} from "./acting-provider.ts";

// Inyección para tests más el actor (JSON). En producción solo llega `actor`.
interface BrainToolOptions {
	actor?: BrainActor;
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
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
	// Un asistente no ve la categoría skill (spec 24.1 S6).
	const categories = assistantCategories(binding.config.categories);
	const brain_search = defineTool({
		description: `${contract.search.description} Usalo antes de investigar o redactar.`,
		inputSchema: brainContract(categories).search.input,
		execute: async (input) => {
			try {
				const provider = withoutSkills(
					await resolveActingProvider(binding, deps.actor, deps),
				);
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
				const acting = await resolveActingBrain(binding, deps.actor, deps);
				const page = await withoutSkills(acting.provider).read(slug);
				// Después de leer: lo que no se ve ya respondió not_found.
				return {
					ok: true as const,
					page,
					rules: withoutRoot(
						await withoutSkillRules(acting.rules).cascade(slug),
					),
				};
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	const brain_rules = defineTool({
		description: contract.rules.description,
		inputSchema: brainContract(categories).rules.input,
		execute: async ({ path }) => {
			try {
				// Ni el agente sin persona ve las reglas de skills/ (spec 24.1 S6).
				const rules = withoutSkillRules(
					await resolveActingRules(binding, deps.actor, deps),
				);
				return { ok: true as const, rules: await rules.cascade(path) };
			} catch (error) {
				return toToolError(error);
			}
		},
	});

	return { brain_search, brain_read, brain_rules };
}

function buildBrainUpsertTool(
	binding: BrainBinding,
	contract: ReturnType<typeof brainContract>,
	deps: BrainToolOptions,
) {
	// Schema inline por la misma razón que en buildBrainReadTools.
	// Un asistente no ve la categoría skill (spec 24.1 S6).
	const categories = assistantCategories(binding.config.categories);
	return defineTool({
		description: `${contract.upsert.description} Siempre la aprueba un administrador. Si la subcarpeta de la ruta no existe, se crea junto con la página (por ejemplo comercial/embolsado/leeme crea comercial/embolsado): así se arma una carpeta nueva, con su primera página. Las carpetas de primer nivel no se crean por acá: esas las crea un administrador. Vos no escribís páginas 00-reglas ni 00-plantilla: si hace falta un cambio ahí, proponelo en la conversación.`,
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
				// Una skill se rechaza como skill, antes que las reglas (spec 24.1 S6).
				rejectSkillWrite(input);
				// Las reglas son gobierno: las decide una persona (spec etapa 26 D10).
				if (isReservedSlug(input.slug)) throw agentReservedSlug(input.slug);
				const acting = await resolveActingBrain(binding, deps.actor, deps);
				const write = await requireRules(acting.rules, input);
				const result = await withoutSkills(acting.provider).upsert(write, {
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
	const contract = brainContract(
		assistantCategories(binding.config.categories),
	);
	const readTools = buildBrainReadTools(contract, binding, deps);

	if (access === "read") return readTools;

	const brain_upsert = buildBrainUpsertTool(binding, contract, deps);
	return { ...readTools, brain_upsert };
}
