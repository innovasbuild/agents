"use client";

import { useState } from "react";
import { type BudgetRow, resourceLabel } from "@/lib/workflows/settings";
import { setBudget } from "../console-actions";
import { ConsoleButton } from "./console-button";

const amount = (value: number) =>
	value.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

function Row({
	slug,
	tenantId,
	budget,
}: {
	slug: string;
	tenantId: string;
	budget: BudgetRow;
}) {
	const [limit, setLimit] = useState(String(budget.dailyLimit));
	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
			<div className="min-w-0 flex-1">
				<div>{resourceLabel(budget.resource)}</div>
				<div className="text-muted-foreground text-xs">
					Gastado hoy: {amount(budget.spent)}
					{budget.dailyLimit <= 0
						? " · Sin presupuesto: los procesos que lo usan no corren."
						: ""}
				</div>
			</div>
			<input
				aria-label={`Límite diario de ${resourceLabel(budget.resource)}`}
				className="h-9 w-28 rounded-md border border-input bg-transparent px-2 text-sm"
				inputMode="decimal"
				onChange={(event) => setLimit(event.target.value)}
				value={limit}
			/>
			<ConsoleButton
				label="Guardar"
				run={() => setBudget(slug, tenantId, budget.resource, limit)}
			/>
		</li>
	);
}

export function BudgetsSection({
	slug,
	tenantId,
	budgets,
}: {
	slug: string;
	tenantId: string;
	budgets: BudgetRow[];
}) {
	return (
		<div className="space-y-2">
			<p className="text-muted-foreground text-sm">
				Tope diario por recurso para los procesos automáticos de la empresa. El
				cliente lo ve, pero no lo cambia.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{budgets.map((budget) => (
					<Row
						budget={budget}
						key={budget.resource}
						slug={slug}
						tenantId={tenantId}
					/>
				))}
			</ul>
		</div>
	);
}
