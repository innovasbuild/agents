// app/plataforma/[slug]/console/connections-section.tsx
"use client";

import {
	removeConnection,
	setConnectionEnabled,
	verifyConnection,
} from "../console-actions";
import { ConsoleButton } from "./console-button";

export interface ConnectionState {
	id: string;
	capability: string;
	provider: string;
	connectorUids: string[];
	enabled: boolean;
	verifiedAt: string | null;
	verifiedName: string | null;
}

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

export function ConnectionsSection({
	slug,
	tenantId,
	connections,
}: {
	slug: string;
	tenantId: string;
	connections: ConnectionState[];
}) {
	if (connections.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Todavía no hay conectores asociados.
			</p>
		);
	}
	return (
		<ul className="divide-y rounded-lg border bg-card" data-tenant={tenantId}>
			{connections.map((connection) => (
				<li
					className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
					key={connection.id}
				>
					<div className="min-w-0 flex-1">
						<div>
							{connection.provider}
							<span className="ml-2 text-muted-foreground text-xs">
								{connection.capability}
							</span>
						</div>
						{connection.connectorUids.length > 0 ? (
							<div className="font-mono text-muted-foreground text-xs">
								{connection.connectorUids.join(" · ")}
							</div>
						) : (
							<div className="text-muted-foreground text-xs">
								Conector de plataforma: cada persona autoriza su cuenta.
							</div>
						)}
						<div className="text-muted-foreground text-xs">
							{connection.verifiedAt
								? `Verificado el ${fecha(connection.verifiedAt)}${connection.verifiedName ? ` · ${connection.verifiedName}` : ""}`
								: connection.connectorUids.length > 0
									? "Sin verificar"
									: null}
						</div>
					</div>
					<span className="rounded-full border px-2 py-0.5 text-xs">
						{connection.enabled ? "Habilitado" : "Deshabilitado"}
					</span>
					<span className="inline-flex flex-wrap items-center gap-2">
						{connection.connectorUids.length > 0 ? (
							<ConsoleButton
								label="Verificar"
								run={() => verifyConnection(slug, connection.id)}
							/>
						) : null}
						<ConsoleButton
							label={connection.enabled ? "Deshabilitar" : "Habilitar"}
							run={() =>
								setConnectionEnabled(slug, connection.id, !connection.enabled)
							}
						/>
						<ConsoleButton
							confirmText="Se quita la asociación y el identificador queda libre. La llave sigue en Vercel: borrala ahí si ya no se usa."
							label="Quitar"
							run={() => removeConnection(slug, connection.id)}
						/>
					</span>
				</li>
			))}
		</ul>
	);
}
