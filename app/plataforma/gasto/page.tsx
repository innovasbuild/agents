import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	capitalizeFirst,
	monthRange,
	toPlatformRows,
	usd,
} from "@/lib/usage/report";
import { ReconcilePanel } from "./reconcile-panel";

interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
}

const DAY_MS = 86_400_000;

interface Totals {
	today: Map<string, number>;
	month: Map<string, number>;
	previous: Map<string, number>;
}

export default async function GastoPlataformaPage() {
	// 404 y no 403: un 403 confirma que la consola existe.
	const actor = await requirePlatformAdmin();
	if (!actor) notFound();

	const now = new Date();
	const current = monthRange("actual", now);
	const previous = monthRange("anterior", now);
	const todayStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const todayEnd = new Date(todayStart.getTime() + DAY_MS);

	let tenants: TenantRow[] = [];
	let loaded: Totals | null = null;
	try {
		// platform_spend_report es de service_role: se llama recién después de
		// comprobar que quien entra es platform_admin. Devuelve una fila por
		// empresa y por rango (no por día): PostgREST corta en 1000 filas sin
		// avisar.
		const admin = createAdminClient();
		const report = (from: Date, to: Date) =>
			admin.rpc("platform_spend_report", {
				p_from: from.toISOString(),
				p_to: to.toISOString(),
			} as never);
		const [tenantsResult, todayResult, monthResult, previousResult] =
			await Promise.all([
				admin
					.from("tenants")
					.select("id, slug, display_name")
					.order("display_name"),
				report(todayStart, todayEnd),
				report(current.from, current.to),
				report(previous.from, previous.to),
			]);
		const error =
			tenantsResult.error ??
			todayResult.error ??
			monthResult.error ??
			previousResult.error;
		if (error) {
			console.error("gasto de plataforma:", error);
		} else {
			const byTenant = (data: unknown) =>
				new Map(
					toPlatformRows((data as unknown[] | null) ?? []).map((row) => [
						row.tenantId,
						row.amount,
					]),
				);
			tenants = (tenantsResult.data ?? []) as TenantRow[];
			loaded = {
				today: byTenant(todayResult.data),
				month: byTenant(monthResult.data),
				previous: byTenant(previousResult.data),
			};
		}
	} catch (error) {
		console.error("gasto de plataforma:", error);
	}
	// const: el narrowing de un `let` no llega a los callbacks del JSX.
	const totals = loaded;

	const sum = { today: 0, month: 0, previous: 0 };
	if (totals) {
		for (const tenant of tenants) {
			sum.today += totals.today.get(tenant.id) ?? 0;
			sum.month += totals.month.get(tenant.id) ?? 0;
			sum.previous += totals.previous.get(tenant.id) ?? 0;
		}
	}

	return (
		<div className="max-w-3xl space-y-10">
			<div>
				<Link
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
					href="/plataforma"
				>
					← Empresas
				</Link>
				<h1 className="text-3xl leading-tight">Gasto en modelos de IA</h1>
				<p className="text-muted-foreground text-sm">
					Lo asentado en el libro de consumo, con los días en UTC.
				</p>
			</div>

			{totals === null ? (
				<p className="text-muted-foreground text-sm" role="alert">
					No pude leer el gasto. Recargá la página.
				</p>
			) : (
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="text-left text-muted-foreground">
							<tr>
								<th className="px-4 py-2 font-normal" scope="col">
									Empresa
								</th>
								<th className="px-4 py-2 text-right font-normal" scope="col">
									Hoy
								</th>
								<th className="px-4 py-2 text-right font-normal " scope="col">
									{capitalizeFirst(current.label)}
								</th>
								<th className="px-4 py-2 text-right font-normal " scope="col">
									{capitalizeFirst(previous.label)}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{tenants.map((tenant) => {
								return (
									<tr key={tenant.id}>
										<td className="px-4 py-2">
											<Link
												className="underline underline-offset-4"
												href={`/plataforma/${tenant.slug}`}
											>
												{tenant.display_name}
											</Link>
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(totals.today.get(tenant.id) ?? 0)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(totals.month.get(tenant.id) ?? 0)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(totals.previous.get(tenant.id) ?? 0)}
										</td>
									</tr>
								);
							})}
						</tbody>
						<tfoot className="border-t font-medium">
							<tr>
								<th className="px-4 py-2 text-left font-medium" scope="row">
									Total
								</th>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.today)}
								</td>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.month)}
								</td>
								<td className="px-4 py-2 text-right tabular-nums">
									{usd(sum.previous)}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			)}

			<ReconcilePanel />
		</div>
	);
}
