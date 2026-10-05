// Lecturas del editor (spec editor §4.3 y §6). Páginas y revisiones con el
// cliente de sesión: la RLS de lectura por membresía ya existe. El binding y
// los emails de autores con el cliente admin, siempre filtrados por el tenant
// que resolvió la sesión.
import { cache } from "react";
import { loadTenantBindings } from "@/lib/connectors/bindings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import type { BrainStatus } from "../core/types";
import { resolveBrainBinding } from "../resolve";

export type EditorContext =
	| { kind: "ok"; tenant: TenantAccess; canEdit: boolean; categories: string[] }
	| { kind: "no-brain"; tenant: TenantAccess }
	| { kind: "external"; tenant: TenantAccess };

export const loadEditorContext = cache(
	async (tenantSlug: string): Promise<EditorContext | null> => {
		const tenant = await resolveTenantAccess(tenantSlug);
		if (!tenant) return null;
		const binding = await resolveBrainBinding(tenant.id, loadTenantBindings);
		if (!binding) return { kind: "no-brain", tenant };
		if (binding.provider !== "wiki") return { kind: "external", tenant };
		return {
			kind: "ok",
			tenant,
			canEdit: tenant.role !== "tenant_member",
			categories: binding.config.categories,
		};
	},
);

export interface BrainPageRow {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number;
	updatedAt: string;
}

export const loadBrainPages = cache(
	async (tenantId: string): Promise<BrainPageRow[]> => {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase
			.from("brain_pages")
			.select(
				"slug, title, category, status, tags, frontmatter, body, revision, updated_at",
			)
			.eq("tenant_id", tenantId)
			.order("slug");
		if (error) throw new Error(`No pude leer el brain: ${error.message}`);
		return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
			slug: row.slug as string,
			title: row.title as string,
			category: row.category as string,
			status: row.status as BrainStatus,
			tags: (row.tags as string[] | null) ?? [],
			frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
			body: row.body as string,
			revision: row.revision as number,
			updatedAt: row.updated_at as string,
		}));
	},
);

export interface RevisionRow {
	revision: number;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	authorKind: "user" | "agent" | "import";
	authorEmail: string | null;
	reason: string;
	createdAt: string;
}

export async function loadRevisions(
	tenantId: string,
	slug: string,
): Promise<RevisionRow[] | null> {
	const supabase = await createServerSupabase();
	const { data: page } = await supabase
		.from("brain_pages")
		.select("id")
		.eq("tenant_id", tenantId)
		.eq("slug", slug)
		.maybeSingle();
	if (!page) return null;

	const { data, error } = await supabase
		.from("brain_revisions")
		.select(
			"revision, title, category, status, tags, frontmatter, body, author_kind, author_user_id, reason, created_at",
		)
		.eq("tenant_id", tenantId)
		.eq("page_id", page.id)
		.order("revision", { ascending: false });
	if (error) throw new Error(`No pude leer el historial: ${error.message}`);

	const rows = (data ?? []) as Array<Record<string, unknown>>;
	const emails = await memberEmails(tenantId, [
		...new Set(
			rows
				.map((r) => r.author_user_id as string | null)
				.filter((id): id is string => !!id),
		),
	]);

	return rows.map((row) => ({
		revision: row.revision as number,
		title: row.title as string,
		category: row.category as string,
		status: row.status as BrainStatus,
		tags: (row.tags as string[] | null) ?? [],
		frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
		body: row.body as string,
		authorKind: row.author_kind as RevisionRow["authorKind"],
		authorEmail: row.author_user_id
			? (emails.get(row.author_user_id as string) ?? null)
			: null,
		reason: row.reason as string,
		createdAt: row.created_at as string,
	}));
}

// Solo usuarios con membership en este tenant: un email de otra empresa no se
// muestra aunque haya quedado como autor.
async function memberEmails(
	tenantId: string,
	userIds: string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (userIds.length === 0) return result;
	const admin = createAdminClient();
	const { data: members } = await admin
		.from("memberships")
		.select("user_id")
		.eq("tenant_id", tenantId)
		.in("user_id", userIds);
	await Promise.all(
		((members ?? []) as Array<{ user_id: string }>).map(async ({ user_id }) => {
			const { data } = await admin.auth.admin.getUserById(user_id);
			if (data.user?.email) result.set(user_id, data.user.email);
		}),
	);
	return result;
}
