// Fila de la regla de la raíz del brain (spec etapa 17 §4.3). Corre con Node
// directo: imports relativos con extensión .ts.
import { DEFAULT_ROOT_RULE } from "../lib/brain/core/access/types.ts";

// Violación de unicidad: el tenant ya tiene su regla de la raíz.
export const DUPLICATE_RULE = "23505";

export function rootRuleRow(tenantId: string) {
	return {
		tenant_id: tenantId,
		path: DEFAULT_ROOT_RULE.path,
		principal: DEFAULT_ROOT_RULE.principal,
		user_id: DEFAULT_ROOT_RULE.userId,
		level: DEFAULT_ROOT_RULE.level,
	};
}
