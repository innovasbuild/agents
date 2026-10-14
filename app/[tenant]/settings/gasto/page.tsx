import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import {
	dayLabel,
	monthRange,
	type Period,
	parsePeriod,
	summarize,
	toSpendRows,
	usd,
} from "@/lib/usage/report";

const PERIODS: { key: Period; label: string }[] = [
	{ key: "actual", label: "Mes en curso" },
	{ key: "anterior", label: "Mes anterior" },
];

export default async function GastoPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ periodo?: string | string[] }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	// 404 y no 403, como el resto de settings: el gasto es del administrador.
	if (tenant.role === "tenant_member") notFound();

	const period = parsePeriod((await searchParams).periodo);
	const range = monthRange(period, new Date());

	let rows: ReturnType<typeof toSpendRows> | null = null;
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.rpc("tenant_spend_report", {
			p_tenant: tenant.id,
			p_from: range.from.toISOString(),
			p_to: range.to.toISOString(),
		} as never);
		if (error) console.error("gasto: tenant_spend_report:", error);
		else rows = toSpendRows((data as unknown[] | null) ?? []);
	} catch (error) {
		console.error("gasto: tenant_spend_report:", error);
	}

	const summary = rows === null ? null : summarize(rows);

	return (
		<div className="max-w-3xl space-y-8">
			<div>
				<Link
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
					href={`/${slug}/settings`}
				>
					← Configuración
				</Link>
				<h1 className="text-3xl leading-tight">Gasto en modelos de IA</h1>
			</div>

			<nav aria-label="Período" className="flex gap-4 text-sm">
				{PERIODS.map(({ key, label }) => (
					<Link
						aria-current={key === period ? "page" : undefined}
						className={
							key === period
								? "font-medium underline underline-offset-4"
								: "text-muted-foreground hover:text-foreground"
						}
						href={
							key === "actual"
								? `/${slug}/settings/gasto`
								: `/${slug}/settings/gasto?periodo=${key}`
						}
						key={key}
					>
						{label}
					</Link>
				))}
			</nav>

			{summary === null ? (
				<p className="text-muted-foreground text-sm">
					No pude leer el gasto. Recargá la página.
				</p>
			) : summary.byDay.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay gasto registrado en {range.label}.
				</p>
			) : (
				<>
					<section>
						<h2 className="mb-1 text-lg capitalize">{range.label}</h2>
						<p className="text-3xl">{usd(summary.total)}</p>
					</section>

					<section>
						<h2 className="mb-3 text-lg">Por origen</h2>
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead className="text-left text-muted-foreground">
									<tr>
										<th className="px-4 py-2 font-normal">Origen</th>
										<th className="px-4 py-2 text-right font-normal">Gasto</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{summary.byOrigin.map((row) => (
										<tr key={row.origin}>
											<td className="px-4 py-2">{row.label}</td>
											<td className="px-4 py-2 text-right tabular-nums">
												{usd(row.amount)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>

					<section>
						<h2 className="mb-3 text-lg">Por día</h2>
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead className="text-left text-muted-foreground">
									<tr>
										<th className="px-4 py-2 font-normal">Día</th>
										<th className="px-4 py-2 text-right font-normal">Gasto</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{summary.byDay.map((row) => (
										<tr key={row.day}>
											<td className="px-4 py-2">{dayLabel(row.day)}</td>
											<td className="px-4 py-2 text-right tabular-nums">
												{usd(row.amount)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				</>
			)}

			<p className="text-muted-foreground text-xs">
				Los días cortan a la medianoche UTC (21:00 de Buenos Aires). El gasto
				del chat se registra desde que se activó esta pantalla; lo anterior no
				figura.
			</p>
		</div>
	);
}
