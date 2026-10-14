// Zips publicados de las skills en Storage (spec etapa 24.2b §5): bucket
// privado skill-packages, objeto <tenant_id>/<digest>.zip, links firmados.
// La ruta del objeto sale siempre del tenant del pedido.
import { createAdminClient } from "@/lib/supabase/admin";
import type {
	PackageIssueRecord,
	PackageLinkDeps,
	PackageObjects,
} from "../core/skills/package-link";
import { zipPackage } from "./skill-zip";
import { blobStore } from "./skills";

const BUCKET = "skill-packages";

function objectPath(tenantId: string, digest: string): string {
	return `${tenantId}/${digest}.zip`;
}

export function packageObjects(): PackageObjects {
	const bucket = () => createAdminClient().storage.from(BUCKET);
	return {
		async exists(tenantId, digest) {
			// Cualquier duda cuenta como "no está": se rearma y se sube con
			// upsert, que es inocuo porque el zip es reproducible.
			const { data } = await bucket().exists(objectPath(tenantId, digest));
			return data === true;
		},
		async put(tenantId, digest, zip) {
			const { error } = await bucket().upload(
				objectPath(tenantId, digest),
				zip,
				{ contentType: "application/zip", upsert: true },
			);
			if (error) {
				throw new Error(`skills: no pude guardar el paquete: ${error.message}`);
			}
		},
		async sign(tenantId, digest, { expiresIn, filename }) {
			const { data, error } = await bucket().createSignedUrl(
				objectPath(tenantId, digest),
				expiresIn,
				{ download: filename },
			);
			if (error || !data) {
				throw new Error(
					`skills: no pude firmar el paquete: ${error?.message ?? "sin datos"}`,
				);
			}
			return data.signedUrl;
		},
	};
}

export function packageIssueEvent(
	entry: PackageIssueRecord,
): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: entry.channel,
		type: "brain.skill_package_issued",
		summary: entry.slug,
		payload: { name: entry.name, version: entry.version, digest: entry.digest },
	};
}

export function packageLinkDeps(): PackageLinkDeps {
	return {
		objects: packageObjects(),
		blob: (tenantId, sha256) => blobStore().get(tenantId, sha256),
		zip: zipPackage,
		// events es append-only: solo insert. Se tira solo el mensaje de la base.
		async record(entry) {
			const { error } = await createAdminClient()
				.from("events")
				.insert(packageIssueEvent(entry));
			if (error) throw new Error(error.message);
		},
	};
}
