"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

function authorizationId(formData: FormData): string {
	const value = formData.get("authorization_id");
	return typeof value === "string" ? value : "";
}

async function decide(formData: FormData, approve: boolean): Promise<never> {
	const id = authorizationId(formData);
	const supabase = await createServerSupabase();
	const { data, error } = approve
		? await supabase.auth.oauth.approveAuthorization(id, {
				skipBrowserRedirect: true,
			})
		: await supabase.auth.oauth.denyAuthorization(id, {
				skipBrowserRedirect: true,
			});
	if (error || !data) {
		redirect(
			`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=1`,
		);
	}
	redirect(data.redirect_url);
}

export async function approveConsent(formData: FormData): Promise<void> {
	await decide(formData, true);
}

export async function denyConsent(formData: FormData): Promise<void> {
	await decide(formData, false);
}
