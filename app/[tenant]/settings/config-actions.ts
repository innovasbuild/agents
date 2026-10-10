"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approvableNodes, isPolicy } from "@/lib/tenants/approvals";
import {
	adminOf,
	type ConfigResult,
	fromDbError,
	INVALIDO,
	type Supabase,
} from "./action-helpers";

// guid y no uuid: el seed local usa ids que no son v4.
const idSchema = z.guid();
const executorSchema = z.object({
	slug: z.string().min(1).max(31),
	displayName: z.string().max(120),
	title: z.string().max(120),
	linkedinUrl: z.string().max(300),
	dailyQuota: z.number().int(),
});

async function call(
	slug: string,
	supabase: Supabase,
	fn:
		| "set_executor"
		| "remove_executor"
		| "set_approval"
		| "set_connection_enabled",
	args: Record<string, unknown>,
): Promise<ConfigResult> {
	// rpc() no valida nombre ni argumentos contra los tipos en este repo: los
	// tests de esta acción afirman ambos.
	const { error } = await supabase.rpc(fn, args as never);
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}

export async function saveExecutor(
	slug: string,
	userId: string,
	input: {
		slug: string;
		displayName: string;
		title: string;
		linkedinUrl: string;
		dailyQuota: number;
	},
): Promise<ConfigResult> {
	if (!idSchema.safeParse(userId).success) return INVALIDO;
	const parsed = executorSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_executor", {
		p_tenant: admin.tenantId,
		p_user: userId,
		p_slug: parsed.data.slug,
		p_display_name: parsed.data.displayName,
		p_title: parsed.data.title,
		p_linkedin_url: parsed.data.linkedinUrl,
		p_daily_quota: parsed.data.dailyQuota,
	});
}

export async function removeExecutor(
	slug: string,
	userId: string,
): Promise<ConfigResult> {
	if (!idSchema.safeParse(userId).success) return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "remove_executor", {
		p_tenant: admin.tenantId,
		p_user: userId,
	});
}

export async function saveApproval(
	slug: string,
	agent: string,
	node: string,
	policy: string,
): Promise<ConfigResult> {
	if (typeof agent !== "string" || typeof node !== "string") return INVALIDO;
	if (typeof policy !== "string" || !isPolicy(policy)) return INVALIDO;
	// El registro vive en código: la base no puede saber qué nodo es de nivel 2.
	if (!approvableNodes(agent).includes(node)) {
		return { ok: false, message: "Ese paso no admite política." };
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_approval", {
		p_tenant: admin.tenantId,
		p_agent: agent,
		p_node: node,
		p_policy: policy,
	});
}

export async function toggleConnection(
	slug: string,
	connectionId: string,
	enabled: boolean,
): Promise<ConfigResult> {
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;
	if (typeof enabled !== "boolean") return INVALIDO;

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin.supabase, "set_connection_enabled", {
		p_tenant: admin.tenantId,
		p_connection: connectionId,
		p_enabled: enabled,
	});
}
