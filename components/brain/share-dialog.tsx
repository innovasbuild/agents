"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	getShareState,
	grantAccess,
	revokeAccess,
	setGeneralAccess,
} from "@/app/[tenant]/brain/access-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ShareState } from "@/lib/brain/adapters/access-admin";

type Level = "lector" | "editor" | "administrador";
const LEVELS: Level[] = ["lector", "editor", "administrador"];
const LEVEL_LABEL: Record<Level, string> = {
	lector: "Lector",
	editor: "Editor",
	administrador: "Administrador",
};
// Cómo se nombra, entre paréntesis, lo que un nodo hereda.
const INHERIT_LABEL = {
	ninguno: "restringido",
	lector: "lector",
	editor: "editor",
	administrador: "administrador",
} as const;

type Loaded = { ok: true } & ShareState;
type Failed = { error: string };
type Outcome = { ok: boolean; message?: string };

const normalize = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
const nameOf = (path: string) =>
	path === "" ? "Brain" : path.slice(path.lastIndexOf("/") + 1);

export function ShareDialog({
	tenantSlug,
	path: initialPath,
	name: initialName,
	onClose,
}: {
	tenantSlug: string;
	path: string;
	name: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [path, setPath] = useState(initialPath);
	// Path vigente, actualizado en el mismo tick que goTo: una respuesta de
	// getShareState de otra carpeta se descarta en vez de pisar el estado.
	const currentPath = useRef(initialPath);
	const [name, setName] = useState(initialName);
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [newLevel, setNewLevel] = useState<Level>("lector");

	const load = useCallback(async () => {
		try {
			const result = await getShareState({ tenantSlug, path });
			if (currentPath.current !== path) return;
			setState(result.ok ? result : { error: result.message });
		} catch {
			if (currentPath.current !== path) return;
			setState({ error: "No se pudo cargar. Probá de nuevo." });
		}
	}, [tenantSlug, path]);

	useEffect(() => {
		void load();
	}, [load]);

	// Toda acción: se bloquean los controles, el error vuelve a la vista y,
	// si salió bien, se recarga el diálogo y el árbol.
	async function act(run: () => Promise<Outcome>) {
		setBusy(true);
		setError(null);
		try {
			const result = await run();
			if (!result.ok) {
				setError(result.message ?? "No se pudo guardar.");
				return;
			}
			setQuery("");
			await load();
			router.refresh();
		} catch {
			setError("No se pudo guardar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const goTo = (next: string) => {
		currentPath.current = next;
		setPath(next);
		setName(nameOf(next));
		setState(null);
		setError(null);
	};

	const body = (() => {
		if (state === null)
			return <p className="text-muted-foreground text-sm">Cargando…</p>;
		if ("error" in state)
			return (
				<p role="alert" className="text-sm">
					{state.error}
				</p>
			);

		const { view, people, admins, candidates } = state;
		const label = (id: string) =>
			people[id]?.name || people[id]?.email || "Sin nombre";
		const email = (id: string) => (people[id]?.name ? people[id]?.email : null);
		const taken = new Set(view.own.map((rule) => rule.userId));
		const q = normalize(query.trim());
		const matches = q
			? candidates
					.filter((id) => !taken.has(id))
					.filter((id) =>
						normalize(
							`${people[id]?.name ?? ""} ${people[id]?.email ?? ""}`,
						).includes(q),
					)
					.slice(0, 8)
			: [];
		const isRoot = path === "";
		const inherited = view.general.inherited;
		const generalValue = view.general.own ?? "inherit";

		return (
			<div className="space-y-6">
				<section className="space-y-2">
					<h3 className="text-sm font-medium">Agregar personas</h3>
					<div className="flex gap-2">
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Buscar por nombre o correo"
							aria-label="Buscar personas para dar acceso"
							disabled={busy}
							className="min-h-11"
						/>
						<Select
							value={newLevel}
							onValueChange={(v) => setNewLevel(v as Level)}
						>
							<SelectTrigger
								className="min-h-11 w-36"
								aria-label="Nivel para la persona nueva"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{LEVELS.map((level) => (
									<SelectItem key={level} value={level}>
										{LEVEL_LABEL[level]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{q && matches.length === 0 && (
						<p className="text-muted-foreground text-sm">
							No hay personas para agregar con ese nombre.
						</p>
					)}
					{matches.length > 0 && (
						<ul className="divide-y rounded-md border">
							{matches.map((id) => (
								<li key={id}>
									<button
										type="button"
										disabled={busy}
										onClick={() =>
											act(() =>
												grantAccess({
													tenantSlug,
													path,
													userId: id,
													level: newLevel,
												}),
											)
										}
										className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-left hover:bg-muted/50"
									>
										<span className="text-sm">{label(id)}</span>
										{email(id) && (
											<span className="text-muted-foreground text-xs">
												{email(id)}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Personas que tienen acceso</h3>
					<ul className="divide-y rounded-md border">
						{admins.map((id) => (
							<li
								key={`admin-${id}`}
								className="flex min-h-11 items-center gap-3 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(id)}</div>
									{email(id) && (
										<div className="truncate text-muted-foreground text-xs">
											{email(id)}
										</div>
									)}
								</div>
								<span className="text-muted-foreground text-sm">
									Administrador
								</span>
							</li>
						))}
						{view.own.map((rule) => (
							<li
								key={`own-${rule.userId}`}
								className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(rule.userId)}</div>
									{email(rule.userId) && (
										<div className="truncate text-muted-foreground text-xs">
											{email(rule.userId)}
										</div>
									)}
								</div>
								<Select
									value={rule.level}
									disabled={busy}
									onValueChange={(v) =>
										act(() =>
											grantAccess({
												tenantSlug,
												path,
												userId: rule.userId,
												level: v,
											}),
										)
									}
								>
									<SelectTrigger
										className="min-h-11 w-36"
										aria-label={`Nivel de ${label(rule.userId)}`}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{LEVELS.map((level) => (
											<SelectItem key={level} value={level}>
												{LEVEL_LABEL[level]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									disabled={busy}
									onClick={() =>
										act(() =>
											revokeAccess({ tenantSlug, path, userId: rule.userId }),
										)
									}
								>
									Quitar
								</Button>
							</li>
						))}
						{view.inherited.map((rule) => (
							<li
								key={`inh-${rule.userId}`}
								className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 opacity-60"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm">{label(rule.userId)}</div>
									<button
										type="button"
										disabled={busy}
										onClick={() => goTo(rule.from)}
										className="min-h-11 text-left text-muted-foreground text-xs underline"
									>
										heredado de {rule.from === "" ? "Brain" : rule.from}
									</button>
								</div>
								<span className="text-sm">{LEVEL_LABEL[rule.level]}</span>
							</li>
						))}
					</ul>
				</section>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Acceso general</h3>
					<Select
						value={generalValue}
						disabled={busy}
						onValueChange={(v) =>
							act(() => setGeneralAccess({ tenantSlug, path, level: v }))
						}
					>
						<SelectTrigger
							className="min-h-11 w-full"
							aria-label="Acceso general"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{!isRoot && (
								<SelectItem value="inherit">
									Heredar ({INHERIT_LABEL[inherited.level]})
								</SelectItem>
							)}
							<SelectItem value="ninguno">Restringido</SelectItem>
							<SelectItem value="lector">Todos los miembros: Lector</SelectItem>
							<SelectItem value="editor">Todos los miembros: Editor</SelectItem>
						</SelectContent>
					</Select>
				</section>
			</div>
		);
	})();

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Compartir "{name}"</DialogTitle>
					<DialogDescription>
						Quién ve y quién edita este lugar del brain.
					</DialogDescription>
				</DialogHeader>
				{body}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button type="button" className="min-h-11" onClick={onClose}>
						Listo
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
