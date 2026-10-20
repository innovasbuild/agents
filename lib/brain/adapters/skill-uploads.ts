// Subidas de skills desde un zip (spec etapa 24.6). Por ahora solo el evento.
// El canal MCP de eve carga este archivo: nada de next/* ni de @/lib/tenants.
import { createAdminClient } from "../../supabase/admin.ts";
import type { SkillImportRecord } from "../core/skills/upload.ts";

export function skillImportEvent(
	entry: SkillImportRecord,
): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: entry.channel,
		type: "brain.skill_imported",
		summary: entry.slug,
		payload: { mode: entry.mode, files: entry.files },
	};
}

export async function recordSkillImport(
	entry: SkillImportRecord,
): Promise<void> {
	// events es append-only: solo insert. Se tira solo el mensaje de la base.
	const { error } = await createAdminClient()
		.from("events")
		.insert(skillImportEvent(entry));
	if (error) throw new Error(error.message);
}
