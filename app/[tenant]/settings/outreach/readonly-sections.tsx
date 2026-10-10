// app/[tenant]/settings/outreach/readonly-sections.tsx
// Lo que el cliente ve pero no edita acá (spec 21.3 §4.1): el ICP y el marco
// viven en el brain, y el presupuesto lo fija INNOV.AS.
import Link from "next/link";
import type { CanonLoad } from "@/lib/outreach/canon";
import type { IcpLevels } from "@/lib/outreach/canon-blocks";
import type { ListValueRow } from "@/lib/outreach/outreach-settings-query";
import { type BudgetRow, resourceLabel } from "@/lib/workflows/settings";
import { RereadButton } from "./lists-section";

const BrainLink = ({ slug, children }: { slug: string; children: string }) => (
	<Link
		className="text-sm underline underline-offset-4"
		href={`/${slug}/brain`}
	>
		{children}
	</Link>
);

const ICP_MISSING: Record<string, string> = {
	sin_brain: "La empresa no tiene brain habilitado.",
	brain_caido: "No pude leer el brain. Recargá la página.",
	falta:
		"Todavía no hay un ICP. Completá el bloque icp de la página con el tag canon:icp y pasala a estado activo.",
};

export function IcpSummary({
	slug,
	icp,
}: {
	slug: string;
	icp: CanonLoad<IcpLevels>;
}) {
	if (!icp.ok) {
		return (
			<div className="space-y-2">
				<p className="text-muted-foreground text-sm">
					{icp.reason === "invalido"
						? "El bloque icp del brain no es válido, así que no se califica a nadie:"
						: ICP_MISSING[icp.reason]}
				</p>
				{icp.errors.length > 0 ? (
					<ul className="list-disc pl-5 text-destructive text-sm">
						{icp.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				) : null}
				<BrainLink slug={slug}>Abrir el brain →</BrainLink>
			</div>
		);
	}
	const { encaje_empresa, rol_decisor, excluir } = icp.value;
	return (
		<div className="space-y-3 text-sm">
			{(
				[
					["Encaje de la empresa", encaje_empresa],
					["Rol de la persona", rol_decisor],
				] as const
			).map(([title, levels]) => (
				<div key={title}>
					<h3 className="mb-1 font-medium">{title}</h3>
					<ol className="list-decimal pl-5 text-muted-foreground">
						{levels.map((level) => (
							<li key={level}>{level}</li>
						))}
					</ol>
				</div>
			))}
			<p>
				<span className="font-medium">Se excluye si:</span>{" "}
				<span className="text-muted-foreground">{excluir}</span>
			</p>
			<BrainLink slug={slug}>Editar en el brain →</BrainLink>
		</div>
	);
}

export function MarcoSummary({
	slug,
	values,
	lastFailure,
}: {
	slug: string;
	values: ListValueRow[];
	lastFailure: { at: string; errors: string[] } | null;
}) {
	const active = (kind: ListValueRow["kind"]) =>
		values.filter((row) => row.kind === kind && row.active);
	return (
		<div className="space-y-3 text-sm">
			<p className="text-muted-foreground">
				Salen de los bloques hooks y vectores de las páginas del brain con el
				tag canon:hooks. Se actualizan solos al guardar esas páginas.
			</p>
			{lastFailure ? (
				<div className="rounded-lg border border-destructive/40 px-4 py-3">
					<p className="text-destructive">
						La última lectura del brain falló, así que sigue vigente la lista
						anterior:
					</p>
					<ul className="list-disc pl-5 text-destructive">
						{lastFailure.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			) : null}
			{(
				[
					["Hooks", active("hook")],
					["Vectores", active("vector")],
				] as const
			).map(([title, rows]) => (
				<div key={title}>
					<h3 className="mb-1 font-medium">{title}</h3>
					{rows.length === 0 ? (
						<p className="text-muted-foreground">Todavía no hay ninguno.</p>
					) : (
						<ul className="divide-y rounded-lg border bg-card">
							{rows.map((row) => (
								<li
									className="flex flex-wrap gap-x-3 px-4 py-2"
									key={row.value}
								>
									<span className="min-w-0 flex-1">{row.label}</span>
									<span className="font-mono text-muted-foreground text-xs">
										{row.value}
										{row.defaultHook ? ` → ${row.defaultHook}` : ""}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			))}
			<div className="flex flex-wrap items-center gap-4">
				<BrainLink slug={slug}>Editar en el brain →</BrainLink>
				<RereadButton slug={slug} />
			</div>
		</div>
	);
}

const amount = (value: number) =>
	value.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

export function BudgetSummary({ budgets }: { budgets: BudgetRow[] }) {
	return (
		<div className="space-y-2 text-sm">
			<p className="text-muted-foreground">
				Es el tope diario de los procesos automáticos. Lo fija INNOV.AS; el
				gasto del chat también cuenta.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{budgets.map((budget) => (
					<li
						className="flex flex-wrap gap-x-3 px-4 py-3"
						key={budget.resource}
					>
						<span className="min-w-0 flex-1">
							{resourceLabel(budget.resource)}
						</span>
						<span className="tabular-nums">
							{amount(budget.spent)} de {amount(budget.dailyLimit)} hoy
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
