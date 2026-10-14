"use server";

import { gateway } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	type ReconcileLine,
	reconcile,
	reconcileRange,
} from "@/lib/usage/reconcile";
import { parsePeriod, toPlatformRows } from "@/lib/usage/report";

export type ReconcileResult =
	| { ok: true; startDate: string; endDate: string; lines: ReconcileLine[] }
	| { ok: false; message: string };

/**
 * Compara el libro contra el reporte del AI Gateway (spec 21.5 §5.3). A
 * pedido: cada consulta al reporte se cobra, así que no corre al cargar la
 * página. El resultado no se guarda.
 */
export async function reconcileSpend(
	period: unknown,
): Promise<ReconcileResult> {
	// Fuera del try: puede redirigir tirando.
	const actor = await requirePlatformAdmin();
	if (!actor) return { ok: false, message: "No tenés permiso." };

	const range = reconcileRange(parsePeriod(period), new Date());
	if (!range) {
		return {
			ok: false,
			message:
				"Todavía no hay un día cerrado este mes. Probá mañana o conciliá el mes anterior.",
		};
	}

	let tenants: { id: string; slug: string; name: string }[];
	let ledger: { tenantId: string; amount: number }[];
	try {
		const admin = createAdminClient();
		const [tenantsResult, ledgerResult] = await Promise.all([
			admin.from("tenants").select("id, slug, display_name"),
			admin.rpc("platform_spend_report", {
				p_from: range.from.toISOString(),
				p_to: range.to.toISOString(),
			} as never),
		]);
		const error = tenantsResult.error ?? ledgerResult.error;
		if (error) throw new Error(error.message);
		tenants = (
			(tenantsResult.data ?? []) as {
				id: string;
				slug: string;
				display_name: string;
			}[]
		).map((row) => ({ id: row.id, slug: row.slug, name: row.display_name }));
		// Postgres devuelve numeric como string: toPlatformRows lo pasa a número.
		ledger = toPlatformRows((ledgerResult.data as unknown[] | null) ?? []);
	} catch (error) {
		console.error("conciliación: libro:", error);
		return {
			ok: false,
			message: "No pude leer el libro de consumo. Probá de nuevo.",
		};
	}

	try {
		const dates = { startDate: range.startDate, endDate: range.endDate };
		const [byTag, byDay] = await Promise.all([
			gateway.getSpendReport({ ...dates, groupBy: "tag" }),
			gateway.getSpendReport({ ...dates, groupBy: "day" }),
		]);
		return {
			ok: true,
			...dates,
			lines: reconcile({
				tenants,
				ledger,
				gatewayByTag: byTag.results,
				gatewayTotal: byDay.results.reduce(
					(sum, row) => sum + row.totalCost,
					0,
				),
			}),
		};
	} catch (error) {
		console.error("conciliación: gateway:", error);
		const reason = error instanceof Error ? error.message : "error desconocido";
		return { ok: false, message: `El gateway rechazó la consulta: ${reason}` };
	}
}
