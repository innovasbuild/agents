// Almacén de tenant_domains con la service role (spec 21.6 §4.1): la tabla no
// tiene grants de escritura para authenticated, solo la consola escribe. Sin
// imports de Next: lo usa un schedule de eve.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { DomainRow, DomainStatus, DomainStore } from "./service";

type Row = Database["public"]["Tables"]["tenant_domains"]["Row"];

const COLUMNS =
	"id, tenant_id, hostname, is_primary, status, last_error, verified_at, created_at";

function toRow(row: Row): DomainRow {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		hostname: row.hostname,
		isPrimary: row.is_primary,
		status: row.status as DomainStatus,
		lastError: row.last_error,
		verifiedAt: row.verified_at,
		createdAt: row.created_at,
	};
}

function must<T>(result: {
	data: T | null;
	error: { message: string } | null;
}): T {
	if (result.error) throw new Error(result.error.message);
	return result.data as T;
}

export function supabaseDomainStore(
	admin: SupabaseClient<Database>,
): DomainStore {
	return {
		async list(tenantId) {
			const data = must(
				await admin
					.from("tenant_domains")
					.select(COLUMNS)
					.eq("tenant_id", tenantId)
					.order("created_at"),
			);
			return (data as Row[]).map(toRow);
		},

		async get(id) {
			const { data, error } = await admin
				.from("tenant_domains")
				.select(COLUMNS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw new Error(error.message);
			return data ? toRow(data as Row) : null;
		},

		async listVerifying(limit) {
			const data = must(
				await admin
					.from("tenant_domains")
					.select(COLUMNS)
					.eq("status", "verifying")
					.order("created_at")
					.limit(limit),
			);
			return (data as Row[]).map(toRow);
		},

		async activeHostnames() {
			const data = must(
				await admin
					.from("tenant_domains")
					.select("hostname")
					.eq("status", "active")
					.order("hostname"),
			);
			return (data as { hostname: string }[]).map((r) => r.hostname);
		},

		async insert({ tenantId, hostname, createdBy }) {
			const { data, error } = await admin
				.from("tenant_domains")
				.insert({
					tenant_id: tenantId,
					hostname,
					created_by: createdBy,
				})
				.select(COLUMNS)
				.single();
			if (error) {
				if (error.code === "23505") return { ok: false, reason: "duplicate" };
				throw new Error(error.message);
			}
			return { ok: true, row: toRow(data as Row) };
		},

		async update(id, patch) {
			const { error } = await admin
				.from("tenant_domains")
				.update({
					...(patch.status !== undefined && { status: patch.status }),
					...(patch.lastError !== undefined && { last_error: patch.lastError }),
					...(patch.verifiedAt !== undefined && {
						verified_at: patch.verifiedAt,
					}),
					...(patch.isPrimary !== undefined && { is_primary: patch.isPrimary }),
				})
				.eq("id", id);
			if (error) throw new Error(error.message);
		},

		async clearPrimary(tenantId) {
			const { error } = await admin
				.from("tenant_domains")
				.update({ is_primary: false })
				.eq("tenant_id", tenantId)
				.eq("is_primary", true);
			if (error) throw new Error(error.message);
		},

		async remove(id) {
			const { error } = await admin
				.from("tenant_domains")
				.delete()
				.eq("id", id);
			if (error) throw new Error(error.message);
		},
	};
}
