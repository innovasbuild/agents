// Acceso a Supabase de las skills (spec etapa 24.1 §4.4). Sin lógica: los
// permisos van en publish.ts y files.ts, y las reglas en las funciones SQL,
// probadas con pgTAP. Recibe el cliente por parámetro.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WikiStoreError } from "../wiki-store.ts";
import type { SkillFile } from "./package.ts";

export type SkillAction = "publicar" | "retirar";

export interface SkillSnapshot {
	action: SkillAction;
	version: number;
	pageRevision: number;
	filesDigest: string;
	title: string;
	description: string;
	body: string;
	frontmatter: Record<string, unknown>;
	manifest: SkillFile[];
	digest: string;
	publishedAt: string;
}

export interface SkillOverviewRow {
	pageId: string;
	slug: string;
	revision: number;
	draftFilesDigest: string;
	current: SkillSnapshot | null;
}

export interface SkillAct {
	id: number;
	action: SkillAction;
	version: number;
	pageRevision: number;
	title: string;
	description: string;
	body: string;
	manifest: SkillFile[];
	digest: string;
	note: string;
	republishedFrom: number | null;
	actorUserId: string | null;
	createdAt: string;
}

export interface SkillStore {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	files(tenantId: string, pageId: string): Promise<SkillFile[]>;
	acts(tenantId: string, pageId: string): Promise<SkillAct[]>;
	putFile(p: {
		tenantId: string;
		pageId: string;
		path: string;
		sha256: string;
		size: number;
		actorUserId: string;
	}): Promise<string>;
	removeFile(p: {
		tenantId: string;
		pageId: string;
		path: string;
		actorUserId: string;
	}): Promise<string>;
	publish(p: {
		tenantId: string;
		pageId: string;
		expectedRevision: number | null;
		expectedFilesDigest: string | null;
		note: string;
		actorUserId: string;
		fromVersion: number | null;
	}): Promise<{ version: number; digest: string }>;
	withdraw(p: {
		tenantId: string;
		pageId: string;
		note: string;
		actorUserId: string;
	}): Promise<boolean>;
}

type Row = Record<string, unknown>;

function fail(error: {
	code?: string;
	message: string;
	details?: string | null;
}): never {
	throw new WikiStoreError(
		error.code ?? "",
		error.message,
		error.details ?? "",
	);
}

function toManifest(value: unknown): SkillFile[] {
	return Array.isArray(value) ? (value as SkillFile[]) : [];
}

export function createSupabaseSkillStore(client: SupabaseClient): SkillStore {
	return {
		async overview(tenantId) {
			const { data, error } = await client.rpc("brain_skill_overview", {
				p_tenant_id: tenantId,
			});
			if (error) fail(error);
			return ((data ?? []) as Row[]).map((row) => ({
				pageId: row.page_id as string,
				slug: row.slug as string,
				revision: row.revision as number,
				draftFilesDigest: row.draft_files_digest as string,
				current: row.action
					? {
							action: row.action as SkillAction,
							version: row.version as number,
							pageRevision: row.page_revision as number,
							filesDigest: row.files_digest as string,
							title: row.title as string,
							description: row.description as string,
							body: row.body as string,
							frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
							manifest: toManifest(row.manifest),
							digest: row.digest as string,
							publishedAt: row.published_at as string,
						}
					: null,
			}));
		},

		async files(tenantId, pageId) {
			const { data, error } = await client
				.from("brain_skill_files")
				.select("path, sha256, size")
				.eq("tenant_id", tenantId)
				.eq("page_id", pageId)
				.order("path");
			if (error) fail(error);
			return (data ?? []) as SkillFile[];
		},

		async acts(tenantId, pageId) {
			const { data, error } = await client
				.from("brain_skill_versions")
				.select(
					"id, action, version, page_revision, title, description, body, manifest, digest, note, republished_from, actor_user_id, created_at",
				)
				.eq("tenant_id", tenantId)
				.eq("page_id", pageId)
				.order("id", { ascending: false });
			if (error) fail(error);
			return ((data ?? []) as Row[]).map((row) => ({
				id: row.id as number,
				action: row.action as SkillAction,
				version: row.version as number,
				pageRevision: row.page_revision as number,
				title: row.title as string,
				description: row.description as string,
				body: row.body as string,
				manifest: toManifest(row.manifest),
				digest: row.digest as string,
				note: row.note as string,
				republishedFrom: (row.republished_from as number | null) ?? null,
				actorUserId: (row.actor_user_id as string | null) ?? null,
				createdAt: row.created_at as string,
			}));
		},

		async putFile(p) {
			const { data, error } = await client.rpc("brain_skill_put_file", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_path: p.path,
				p_sha256: p.sha256,
				p_size: p.size,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data as string;
		},

		async removeFile(p) {
			const { data, error } = await client.rpc("brain_skill_remove_file", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_path: p.path,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data as string;
		},

		async publish(p) {
			const { data, error } = await client.rpc("brain_publish_skill", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_expected_revision: p.expectedRevision,
				p_expected_files_digest: p.expectedFilesDigest,
				p_note: p.note,
				p_actor: p.actorUserId,
				p_from_version: p.fromVersion,
			});
			if (error) fail(error);
			const row = (
				data as Array<{ skill_version: number; skill_digest: string }> | null
			)?.[0];
			if (!row) throw new Error("La base no confirmó la publicación.");
			return { version: row.skill_version, digest: row.skill_digest };
		},

		async withdraw(p) {
			const { data, error } = await client.rpc("brain_withdraw_skill", {
				p_tenant_id: p.tenantId,
				p_page_id: p.pageId,
				p_note: p.note,
				p_actor: p.actorUserId,
			});
			if (error) fail(error);
			return data === true;
		},
	};
}
