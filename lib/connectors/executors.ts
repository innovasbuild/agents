import { createAdminClient } from "../supabase/admin";

export async function markGmailAuthorized(
	tenantId: string,
	userId: string,
): Promise<void> {
	const { error } = await createAdminClient().from("executors").upsert(
		{
			tenant_id: tenantId,
			user_id: userId,
			gmail_authorized_at: new Date().toISOString(),
		},
		{ onConflict: "tenant_id,user_id" },
	);
	if (error)
		throw new Error(`No pude registrar la casilla de Gmail: ${error.message}`);
}
