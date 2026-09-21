// Argumentos de npm run workflows:set. Importa el registry con extensión: Node
// corre los scripts con type stripping, y el registry solo tiene un import de
// tipo, que se borra.
import { isWorkflow } from "../lib/workflows/registry.ts";

export interface WorkflowsSetArgs {
	tenant: string;
	workflow: string;
	/** null: no se toca. */
	enabled: boolean | null;
	cadenceMinutes: number | null;
	itemsPerTick: number | null;
	budget: { resource: string; dailyLimit: number } | null;
	apply: boolean;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

function intFlag(
	argv: string[],
	name: string,
	min: number,
	max: number,
): number | null {
	const raw = flag(argv, name);
	if (raw === null) return null;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max)
		throw new Error(
			`--${name} tiene que ser un entero entre ${min} y ${max}: "${raw}"`,
		);
	return value;
}

export function parseWorkflowsSetArgs(argv: string[]): WorkflowsSetArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");
	if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
		throw new Error(`slug de tenant inválido: "${tenant}"`);
	const workflow = flag(argv, "workflow");
	if (!workflow) throw new Error("falta --workflow <nombre>");
	if (!isWorkflow(workflow))
		throw new Error(`"${workflow}" no está en lib/workflows/registry.ts`);

	const enable = argv.includes("--enable");
	const disable = argv.includes("--disable");
	if (enable && disable) throw new Error("--enable y --disable a la vez");

	const rawBudget = flag(argv, "budget");
	let budget: WorkflowsSetArgs["budget"] = null;
	if (rawBudget !== null) {
		const match = /^([a-z][a-z0-9_]{0,40})=(\d+(?:\.\d{1,6})?)$/.exec(
			rawBudget,
		);
		if (!match)
			throw new Error(
				`--budget va como recurso=monto, por ejemplo model_usd=2: "${rawBudget}"`,
			);
		budget = { resource: match[1], dailyLimit: Number(match[2]) };
	}

	return {
		tenant,
		workflow,
		enabled: enable ? true : disable ? false : null,
		// Mismos límites que parseTenantWorkflowConfig (lib/workflows/config.ts),
		// que igual revalida en cada tick.
		cadenceMinutes: intFlag(argv, "cadence", 5, 10_080),
		itemsPerTick: intFlag(argv, "items", 1, 1_000),
		budget,
		apply: argv.includes("--apply"),
	};
}

export function mergeWorkflowConfig(
	current: Record<string, unknown>,
	args: Pick<WorkflowsSetArgs, "cadenceMinutes" | "itemsPerTick">,
): Record<string, unknown> {
	return {
		...current,
		...(args.cadenceMinutes !== null
			? { cadence_minutes: args.cadenceMinutes }
			: {}),
		...(args.itemsPerTick !== null
			? { items_per_tick: args.itemsPerTick }
			: {}),
	};
}
