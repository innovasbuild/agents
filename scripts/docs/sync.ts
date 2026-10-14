// Genera docs/referencia/*.md a partir del inventario (spec etapa 25 §4.2).
// `renderReference` es pura y determinística: sin fechas, todo ordenado, así
// dos corridas sobre el mismo disco producen los mismos bytes.
import type { Inventory, Surface } from "./inventory.ts";

export const GENERATED_MARK =
	"<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->";

export interface ReferenceExtras {
	/** `TOOL_LABELS` de lib/agents/running-tool.ts, por nombre de tool. */
	toolLabels: Record<string, string>;
	/** `TOOLS_SIN_ETIQUETA` de lib/agents/running-tool.ts. */
	toolsSinEtiqueta: string[];
	/** `SERVICES_EXCLUIDOS` de lib/workflows/registry.ts, con su motivo. */
	servicesExcluidos: Record<string, string>;
}

function cell(text: string): string {
	return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function table(headers: string[], rows: string[][]): string {
	if (rows.length === 0) return "_Ninguno._\n";
	const lines = [
		`| ${headers.join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
	];
	return `${lines.join("\n")}\n`;
}

function code(text: string): string {
	return text ? `\`${text}\`` : "";
}

function page(title: string, intro: string, body: string): string {
	return [
		"---",
		`title: ${title}`,
		"category: referencia",
		"status: activo",
		"tags: [referencia, generado]",
		"generated: true",
		"---",
		GENERATED_MARK,
		"",
		`# ${title}`,
		"",
		intro,
		"",
		body,
	].join("\n");
}

function nameWithoutAgent(key: string): string {
	return key.slice(key.indexOf("/") + 1);
}

function meta(surface: Surface, name: string): string {
	return surface.meta?.[name] ?? "";
}

function nameAndFile(list: Surface[]): string[][] {
	return list.map((s) => [code(s.key), code(s.path)]);
}

function overflow(files: string[]): string {
	const shown = files.slice(0, 3).map(code).join(", ");
	return files.length > 3 ? `${shown} y ${files.length - 3} más` : shown;
}

export function renderReference(
	inv: Inventory,
	extras: ReferenceExtras,
): Record<string, string> {
	const sinEtiqueta = new Set(extras.toolsSinEtiqueta);
	const labelOf = (key: string): string => {
		const name = nameWithoutAgent(key);
		if (Object.hasOwn(extras.toolLabels, name)) return extras.toolLabels[name];
		return sinEtiqueta.has(name) ? "sin etiqueta a propósito" : "FALTA";
	};

	const nodes = table(
		["Nodo", "Nivel de efecto", "Tier", "Modelo fijo"],
		inv.nodes.map((n) => [
			code(n.key),
			meta(n, "effect"),
			meta(n, "tier") || "—",
			code(meta(n, "model")) || "—",
		]),
	);
	const workflows = table(
		["Workflow", "Agente", "Reclama", "Produce", "Nodos", "Caps"],
		inv.workflows.map((w) => [
			code(w.key),
			meta(w, "agent"),
			code(meta(w, "claims")),
			code(meta(w, "produces")) || "—",
			meta(w, "nodes").split(", ").filter(Boolean).map(code).join(", "),
			meta(w, "caps"),
		]),
	);
	const excluded = table(
		["Servicio", "Motivo"],
		Object.entries(extras.servicesExcluidos)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, reason]) => [code(key), reason]),
	);

	return {
		"comandos.md": page(
			"Comandos",
			"Los scripts de `package.json`.",
			table(
				["Script", "Comando"],
				inv.scripts.map((s) => [code(s.key), code(meta(s, "command"))]),
			),
		),
		"variables-de-entorno.md": page(
			"Variables de entorno",
			"Las variables que lee el código propio. Quedan afuera las que pone la plataforma o el sistema (`NODE_ENV`, `VERCEL_*`, `XDG_*`...).",
			table(
				["Variable", "La leen"],
				inv.envVars.map((v) => [
					code(v.key),
					overflow(meta(v, "files").split(",")),
				]),
			),
		),
		"tablas.md": page(
			"Tablas",
			"Las tablas de `public` y la migración que cada una crea.",
			table(
				["Tabla", "La crea"],
				inv.tables.map((t) => [code(t.key), code(t.path)]),
			),
		),
		"migraciones.md": page(
			"Migraciones",
			"Las migraciones de `supabase/migrations`, en orden.",
			table(["Migración", "Archivo"], nameAndFile(inv.migrations)),
		),
		"rutas.md": page(
			"Rutas",
			"Las páginas y los endpoints de `app/`.",
			table(
				["Ruta", "Tipo", "Archivo"],
				inv.routes.map((r) => [code(r.key), meta(r, "kind"), code(r.path)]),
			),
		),
		"tools-del-agente.md": page(
			"Tools del agente",
			"Las tools de `agents/*/tools/` y su etiqueta en castellano (`TOOL_LABELS`, lo que muestra el indicador de actividad del chat).",
			table(
				["Tool", "Etiqueta", "Archivo"],
				inv.tools.map((t) => [code(t.key), labelOf(t.key), code(t.path)]),
			),
		),
		"nodos-y-workflows.md": page(
			"Nodos y workflows",
			"Lo que declara `lib/workflows/registry.ts`. Las reglas para crear uno están en [orquestación](../arquitectura/orquestacion.md).",
			`## Nodos\n\n${nodes}\n## Workflows\n\n${workflows}\n## Servicios fuera del registro\n\n${excluded}`,
		),
		"proveedores.md": page(
			"Proveedores de conectores",
			"Lo que declara `lib/connectors/providers.ts`.",
			table(
				["Proveedor", "Capacidad", "Múltiple", "Kind", "Auth"],
				inv.providers.map((p) => [
					code(p.key),
					meta(p, "capability"),
					meta(p, "multiple") === "true" ? "sí" : "no",
					meta(p, "kind"),
					meta(p, "authKind"),
				]),
			),
		),
		"schedules.md": page(
			"Schedules",
			"Los procesos programados de `agents/*/schedules/`.",
			table(["Schedule", "Archivo"], nameAndFile(inv.schedules)),
		),
		"evals.md": page(
			"Evals",
			"Las evals de `agents/*/evals/`. Se corren con `npm run evals`.",
			table(["Eval", "Archivo"], nameAndFile(inv.evals)),
		),
	};
}
