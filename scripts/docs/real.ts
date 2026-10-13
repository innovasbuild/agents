// El render de la referencia con las entradas reales del repo. Lo usan
// `docs:sync` y los tests de frescura, así no se desvían.
import {
	TOOL_LABELS,
	TOOLS_SIN_ETIQUETA,
} from "../../lib/agents/running-tool.ts";
import { SERVICES_EXCLUIDOS } from "../../lib/workflows/registry.ts";
import { inventory } from "./inventory.ts";
import { renderReference } from "./sync.ts";

export async function renderRealReference(
	root: string,
): Promise<Record<string, string>> {
	return renderReference(await inventory(root), {
		toolLabels: TOOL_LABELS,
		toolsSinEtiqueta: [...TOOLS_SIN_ETIQUETA],
		servicesExcluidos: SERVICES_EXCLUIDOS,
	});
}
