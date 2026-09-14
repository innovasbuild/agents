// Quién puede aprobar un brain_upsert (spec brain §3). El rol y el tenant los
// estampa el canal (agents/outreach/channels/eve.ts) desde memberships.
import type { ApprovalResponseDecision } from "eve/tools/approval";

export const BRAIN_APPROVER_ROLES: readonly string[] = [
	"tenant_admin",
	"platform_admin",
];

export function decideBrainUpsertResponse(
	responder: { attributes?: Record<string, unknown> } | null | undefined,
	tenantId: string,
): ApprovalResponseDecision {
	const attributes = responder?.attributes ?? {};
	if (attributes.tenantId !== tenantId) {
		return {
			status: "rejected",
			reason: "Solo puede aprobar alguien de este mismo cliente.",
		};
	}
	if (
		typeof attributes.role !== "string" ||
		!BRAIN_APPROVER_ROLES.includes(attributes.role)
	) {
		return {
			status: "rejected",
			reason:
				"Solo un administrador del cliente puede aprobar cambios en el brain.",
		};
	}
	return { status: "allowed" };
}
