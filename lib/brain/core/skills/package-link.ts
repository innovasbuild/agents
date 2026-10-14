// Link de descarga del paquete publicado de una skill (spec etapa 24.2b §5).
// Puro: recibe la skill ya autorizada por quien llama (el catálogo por MCP,
// los controles de la ruta por web) y no decide permisos. El zip se guarda
// por digest y se arma solo la primera vez que alguien lo pide.
import type { PackageEntry } from "./files.ts";
import { skillName } from "./package.ts";
import { renderSkillMd } from "./skill-md.ts";
import type { SkillSnapshot } from "./store.ts";

export const PACKAGE_LINK_SECONDS = { mcp: 600, web: 60 } as const;

export type PackageChannel = keyof typeof PACKAGE_LINK_SECONDS;

export interface PackageLink {
	name: string;
	version: number;
	filename: string;
	url: string;
	expiresIn: number;
}

export interface PackageObjects {
	exists(tenantId: string, digest: string): Promise<boolean>;
	put(tenantId: string, digest: string, zip: Uint8Array): Promise<void>;
	sign(
		tenantId: string,
		digest: string,
		options: { expiresIn: number; filename: string },
	): Promise<string>;
}

export interface PackageIssueRecord {
	tenantId: string;
	userId: string;
	channel: PackageChannel;
	slug: string;
	name: string;
	version: number;
	digest: string;
}

export interface PackageLinkDeps {
	objects: PackageObjects;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	zip(entries: PackageEntry[]): Uint8Array;
	record(entry: PackageIssueRecord): Promise<void>;
}

export interface PackageRequest {
	tenantId: string;
	userId: string;
	channel: PackageChannel;
	slug: string;
	snapshot: SkillSnapshot;
}

export function packageFilename(name: string, version: number): string {
	return `${name}-v${version}.zip`;
}

// Carpeta <name>/ con el SKILL.md armado desde la copia y los archivos del
// manifiesto. Si falta un blob, lanza: nunca un paquete incompleto.
export async function publishedEntries(
	name: string,
	snapshot: SkillSnapshot,
	blob: (sha256: string) => Promise<Uint8Array | null>,
): Promise<PackageEntry[]> {
	const entries: PackageEntry[] = [
		{
			path: `${name}/SKILL.md`,
			bytes: new TextEncoder().encode(
				renderSkillMd({
					name,
					description: snapshot.description,
					frontmatter: snapshot.frontmatter,
					body: snapshot.body,
				}),
			),
		},
	];
	for (const file of snapshot.manifest) {
		const bytes = await blob(file.sha256);
		if (!bytes) throw new Error(`skills: falta el contenido de ${file.path}`);
		entries.push({ path: `${name}/${file.path}`, bytes });
	}
	return entries;
}

export async function issuePackageLink(
	request: PackageRequest,
	deps: PackageLinkDeps,
): Promise<PackageLink> {
	const { tenantId, snapshot } = request;
	const name = skillName(request.slug);

	// El digest identifica el contenido publicado y el zip es reproducible:
	// dos pedidos simultáneos suben los mismos bytes.
	if (!(await deps.objects.exists(tenantId, snapshot.digest))) {
		const entries = await publishedEntries(name, snapshot, (sha256) =>
			deps.blob(tenantId, sha256),
		);
		await deps.objects.put(tenantId, snapshot.digest, deps.zip(entries));
	}

	const filename = packageFilename(name, snapshot.version);
	const expiresIn = PACKAGE_LINK_SECONDS[request.channel];
	const url = await deps.objects.sign(tenantId, snapshot.digest, {
		expiresIn,
		filename,
	});

	try {
		await deps.record({
			tenantId,
			userId: request.userId,
			channel: request.channel,
			slug: request.slug,
			name,
			version: snapshot.version,
			digest: snapshot.digest,
		});
	} catch (error) {
		// El registro no puede frenar la entrega del link.
		console.error("skills: no pude registrar el link del paquete", error);
	}

	return { name, version: snapshot.version, filename, url, expiresIn };
}
