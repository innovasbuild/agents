import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	monthRange,
	platformTotals,
	toPlatformRows,
	usd,
} from "@/lib/usage/report";
import { ReconcilePanel } from "./reconcile-panel";

interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
}

const ZERO = { today: 0, month: 0, previous: 0 };

export default async function GastoPlataformaPage() {
	// 404 y no 403: un 403 confirma que la consola existe.
	const actor = await requirePlatformAdmin();
	if (!actor) notFound();

	const now = new Date();
	const current = monthRange("actual", now);
	const previous = monthRange("anterior", now);

	let tenants: TenantRow[] = [];
	let loaded: ReturnType<typeof platformTotals> | null = null;
	try {
		// platform_spend_report es de service_role: se llama recién después de
		// comprobar que quien entra es platform_admin.
		const admin = createAdminClient();
		const [tenantsResult, ledgerResult] = await Promise.all([
			admin
				.from("tenants")
				.select("id, slug, display_name")
				.order("display_name"),
			admin.rpc("platform_spend_report", {
				p_from: previous.from.toISOString(),
				p_to: current.to.toISOString(),
			} as never),
		]);
		const error = tenantsResult.error ?? ledgerResult.error;
		if (error) {
			console.error("gasto de plataforma:", error);
		} else {
			tenants = (tenantsResult.data ?? []) as TenantRow[];
			loaded = platformTotals(
				toPlatformRows((ledgerResult.data as unknown[] | null) ?? []),
				now,
			);
		}
	} catch (error) {
		console.error("gasto de plataforma:", error);
	}
	// const: el narrowing de un `let` no llega a los callbacks del JSX.
	const totals = loaded;

	const sum = { ...ZERO };
	if (totals) {
		for (const tenant of tenants) {
			const row = totals.get(tenant.id) ?? ZERO;
			sum.today += row.today;
			sum.month += row.month;
			sum.previous += row.previous;
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
								<th
									className="px-4 py-2 text-right font-normal capitalize"
									scope="col"
								>
									{current.label}
								</th>
								<th
									className="px-4 py-2 text-right font-normal capitalize"
									scope="col"
								>
									{previous.label}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{tenants.map((tenant) => {
								const row = totals.get(tenant.id) ?? ZERO;
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
											{usd(row.today)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(row.month)}
										</td>
										<td className="px-4 py-2 text-right tabular-nums">
											{usd(row.previous)}
										</td>
									</tr>
								);
							})}
						</tbody>
						<tfoot className="border-t font-medium">
							<tr>
								<td className="px-4 py-2">Total</td>
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
