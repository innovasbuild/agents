"use server";

import { z } from "zod";
import {
	loadEditorContext,
	loadNewPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";

// Lectura para "Nueva página": no revalida nada. La forma se valida en el
// borde; qué ve la persona lo decide su contexto del editor.
const inputSchema = z.object({
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
	folder: z.string().max(200),
});

export async function loadNewPageRules(
	raw: unknown,
): Promise<RulesPanelView | null> {
	const parsed = inputSchema.safeParse(raw);
	if (!parsed.success) return null;
	const ctx = await loadEditorContext(parsed.data.tenantSlug);
	if (ctx?.kind !== "ok") return null;
	return loadNewPageRulesPanel(ctx, parsed.data.folder);
}
