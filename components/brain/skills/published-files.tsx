import { skillFileHref, skillPackageHref } from "@/lib/brain/core/skills/http";
import type { SkillFile } from "@/lib/brain/core/skills/package";

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// Archivos de una versión publicada, para quien solo lee la skill.
export function PublishedFiles({
	tenantSlug,
	slug,
	version,
	files,
}: {
	tenantSlug: string;
	slug: string;
	version: number;
	files: SkillFile[];
}) {
	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="mr-auto font-medium text-sm">Archivos de la skill</h2>
				<a
					className="text-sm underline"
					href={skillPackageHref(tenantSlug, slug)}
					download
				>
					Descargar paquete (v{version})
				</a>
			</div>
			{files.length > 0 && (
				<ul className="divide-y rounded-lg border text-sm">
					{files.map((file) => (
						<li key={file.path} className="flex items-center gap-3 px-3 py-2">
							<a
								className="mr-auto break-all underline"
								href={skillFileHref(tenantSlug, slug, file.path)}
								target="_blank"
								rel="noreferrer"
							>
								{file.path}
							</a>
							<span className="shrink-0 text-muted-foreground">
								{formatSize(file.size)}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
