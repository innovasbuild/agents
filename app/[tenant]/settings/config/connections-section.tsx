"use client";

import { toggleConnection } from "../config-actions";
import { ActionButton } from "../usuarios/row-actions";

export interface ConnectionView {
	id: string;
	capability: string;
	provider: string;
	enabled: boolean;
	lockedByPlatform: boolean;
}

function Control({
	slug,
	connection,
}: {
	slug: string;
	connection: ConnectionView;
}) {
	if (connection.capability === "brain") {
		return (
			<span className="text-muted-foreground text-xs">Lo maneja INNOV.AS</span>
		);
	}
	if (connection.lockedByPlatform) {
		return (
			<span className="text-muted-foreground text-xs">
				Deshabilitado por INNOV.AS
			</span>
		);
	}
	return (
		<ActionButton
			confirmText={
				connection.enabled
					? "¿Deshabilitar este conector? El agente deja de usarlo hasta que lo habilites."
					: undefined
			}
			label={connection.enabled ? "Deshabilitar" : "Habilitar"}
			run={() => toggleConnection(slug, connection.id, !connection.enabled)}
		/>
	);
}

export function ConnectionsSection({
	slug,
	connections,
}: {
	slug: string;
	connections: ConnectionView[];
}) {
	if (connections.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Todavía no hay conexiones configuradas.
			</p>
		);
	}
	return (
		<ul className="divide-y rounded-lg border bg-card">
			{connections.map((connection) => (
				<li
					className="flex flex-wrap items-center gap-3 px-4 py-3"
					key={connection.id}
				>
					<span className="font-medium text-sm">{connection.provider}</span>
					<span className="text-muted-foreground text-sm">
						{connection.capability}
					</span>
					<span
						className={
							connection.enabled
								? "ml-auto text-sm"
								: "ml-auto text-muted-foreground text-sm"
						}
					>
						{connection.enabled ? "Habilitada" : "Deshabilitada"}
					</span>
					<Control connection={connection} slug={slug} />
				</li>
			))}
		</ul>
	);
}
