"use client";

import type { ColaRow } from "@/lib/outreach/cola-query";

// Versión de solo lectura. La Task 6 la reemplaza por la pantalla con
// acciones, estados en vuelo y Realtime.
export function ColaClient({
	rows,
}: {
	slug: string;
	tenantId: string;
	currentUserId: string;
	rows: ColaRow[];
}) {
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground">
				No hay piezas esperando. Pedile al agente que arme la cola desde el
				chat.
			</p>
		);
	}

	return (
		<ul className="flex flex-col gap-4">
			{rows.map((row) => (
				<li key={row.id} className="rounded-lg border p-4">
					<p className="font-medium">{row.subject}</p>
					<p className="text-muted-foreground text-sm">
						{row.contactName ?? row.toEmail}
						{row.ownerSlug ? ` · de ${row.ownerSlug}` : ""}
					</p>
				</li>
			))}
		</ul>
	);
}
