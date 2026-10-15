"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadNewPageRules } from "@/app/[tenant]/brain/rules-actions";
import { BrainMarkdown } from "@/components/brain/markdown";
import {
	RULES_LOAD_ERROR,
	typedFolder,
} from "@/lib/brain/core/editor/reserved";
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { BrainStatus } from "@/lib/brain/core/types";

export const RULES_DEBOUNCE_MS = 300;

// En "Nueva página" la ruta se escribe a mano: el panel sigue a su carpeta.
// Se pide una vez por carpeta, después de una pausa, y una respuesta vieja se
// descarta. `loaded` se marca solo al aplicar una respuesta: si se vuelve a una
// carpeta cuya respuesta se descartó, se pide de nuevo.
export function useFolderRules({
	enabled,
	tenantSlug,
	slug,
	initial,
}: {
	enabled: boolean;
	tenantSlug: string;
	slug: string;
	initial: RulesPanelView | null;
}): RulesPanelView | null {
	const [view, setView] = useState(initial);
	const folder = typedFolder(slug);
	const loaded = useRef(folder);
	useEffect(() => {
		if (!enabled || folder === null || folder === loaded.current) return;
		let stale = false;
		const timer = setTimeout(() => {
			loadNewPageRules({ tenantSlug, folder })
				.then((next) => {
					if (stale) return;
					loaded.current = folder;
					setView(next);
				})
				.catch(() => {
					if (!stale) setView({ kind: "error", message: RULES_LOAD_ERROR });
				});
		}, RULES_DEBOUNCE_MS);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [enabled, tenantSlug, folder]);
	return view;
}

// Informativo (spec etapa 26 §4.3): las reglas que reciben los asistentes antes
// de escribir acá. No exige nada a las personas.
export function RulesPanel({
	tenantSlug,
	view,
	pages,
}: {
	tenantSlug: string;
	view: RulesPanelView;
	pages: Array<{ slug: string; title: string; status: BrainStatus }>;
}) {
	const lookup = useMemo(
		() =>
			new Map(pages.map((p) => [p.slug, { title: p.title, status: p.status }])),
		[pages],
	);
	return (
		<details className="rounded-lg border bg-card text-card-foreground">
			<summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-medium text-sm lg:min-h-9">
				Reglas que aplican{" "}
				{view.kind === "rules" && (
					<span className="font-normal text-muted-foreground">
						({view.entries.length})
					</span>
				)}
			</summary>
			<div className="space-y-4 border-t px-4 py-3 text-sm">
				{view.kind === "error" ? (
					<p role="alert" className="text-destructive">
						{view.message}
					</p>
				) : (
					<>
						<p className="text-muted-foreground">
							Las reciben los asistentes antes de escribir en esta carpeta. Para
							vos son una guía: guardar no exige nada.
						</p>
						<ol className="space-y-4">
							{view.entries.map((entry) => (
								<li key={entry.slug} className="space-y-2">
									<div className="flex flex-wrap items-center gap-x-3">
										<span className="font-medium">{entry.title}</span>
										{entry.visible && (
											<Link
												href={pageHref(tenantSlug, entry.slug)}
												aria-label={`Abrir ${entry.title}`}
												className="inline-flex min-h-11 items-center underline lg:min-h-0"
											>
												Abrir
											</Link>
										)}
									</div>
									<div className="max-h-80 overflow-y-auto rounded-md bg-muted/50 p-3">
										<BrainMarkdown
											body={entry.body}
											tenantSlug={tenantSlug}
											pages={lookup}
										/>
									</div>
								</li>
							))}
						</ol>
					</>
				)}
			</div>
		</details>
	);
}
