// Almacenamiento de las skills (tabla y bucket `skills`). Va aparte de
// skills.ts porque el canal MCP de eve carga este módulo, y skills.ts arrastra
// `tenants/resolve` (next/navigation), que eve no puede cargar.
import { createAdminClient } from "../../supabase/admin.ts";
import type { BlobStore } from "../core/skills/files.ts";
import {
	createSupabaseSkillStore,
	type SkillStore,
} from "../core/skills/store.ts";

const BUCKET = "skills";

export function skillStore(): SkillStore {
	return createSupabaseSkillStore(createAdminClient());
}

export function blobStore(): BlobStore {
	const bucket = () => createAdminClient().storage.from(BUCKET);
	return {
		async put(tenantId, sha256, bytes) {
			// El objeto se llama como su contenido: subirlo dos veces es inocuo.
			const { error } = await bucket().upload(`${tenantId}/${sha256}`, bytes, {
				contentType: "application/octet-stream",
				upsert: true,
			});
			if (error) {
				throw new Error(`skills: no pude guardar el archivo: ${error.message}`);
			}
		},
		async get(tenantId, sha256) {
			const { data, error } = await bucket().download(`${tenantId}/${sha256}`);
			if (error || !data) {
				console.error(
					`skills: no pude leer ${tenantId}/${sha256}: ${error?.message ?? "sin datos"}`,
				);
				return null;
			}
			return new Uint8Array(await data.arrayBuffer());
		},
	};
}
