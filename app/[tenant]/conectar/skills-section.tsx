import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { MemberSkill } from "@/lib/brain/adapters/skills";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { skillPackageHref } from "@/lib/brain/core/skills/http";

// Skills publicadas que la persona puede usar (spec etapa 24.2b §8). null es
// "no se pudieron leer": nunca se muestra como una lista vacía.
export function SkillsSection({
	tenantSlug,
	skills,
}: {
	tenantSlug: string;
	skills: MemberSkill[] | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Tus skills</CardTitle>
				<CardDescription>
					Procedimientos que publicó tu empresa. Tu asistente los usa a través
					del brain.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				{skills === null ? (
					<p className="text-muted-foreground">
						No se pudieron leer tus skills. Recargá la página.
					</p>
				) : (
					<>
						<ul className="divide-y rounded-lg border">
							{skills.map((skill) => (
								<li key={skill.slug} className="space-y-1 px-3 py-2">
									<div className="flex flex-wrap items-center gap-3">
										<a
											className="mr-auto font-medium underline"
											href={pageHref(tenantSlug, skill.slug)}
										>
											{skill.name}
										</a>
										<a
											className="underline"
											href={skillPackageHref(tenantSlug, skill.slug)}
											download
										>
											Descargar paquete (v{skill.version})
										</a>
									</div>
									<p className="text-muted-foreground">{skill.description}</p>
								</li>
							))}
						</ul>
						<div className="space-y-2 text-muted-foreground">
							<p>
								<strong>Claude Code, Codex y Cursor:</strong> con el brain
								conectado, tu asistente carga estas skills solo y usa siempre la
								última versión.
							</p>
							<p>
								<strong>claude.ai y ChatGPT:</strong> tu asistente lee las
								instrucciones de cada skill. Para que además corra sus scripts,
								descargá el paquete y subilo como skill. Cuando se publique una
								versión nueva vas a tener que subirlo de nuevo.
							</p>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
