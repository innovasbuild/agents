"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice, type GatewayModel } from "@/lib/tenants/gateway-models";

/**
 * Los modelos que la empresa ya tiene quedan siempre a la vista; el resto del
 * catálogo del gateway va plegado bajo "Ver más". Lo que se envía son los
 * hidden: así plegar la lista no pierde nada de lo marcado.
 */
export function ModelPicker({
	catalog,
	initial,
	selected,
	onChange,
}: {
	catalog: GatewayModel[];
	initial: string[];
	selected: string[];
	onChange: (selected: string[]) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [query, setQuery] = useState("");

	const byId = useMemo(
		() => new Map(catalog.map((model) => [model.id, model])),
		[catalog],
	);
	// Lo que estaba al abrir y lo que se marcó después: no salta de lugar al
	// desmarcarlo, así se puede volver a marcar sin buscarlo.
	const [pinned, setPinned] = useState(initial);
	const rest = catalog.filter((model) => !pinned.includes(model.id));

	const needle = query.trim().toLowerCase();
	const filtered = needle
		? rest.filter(
				(model) =>
					model.id.toLowerCase().includes(needle) ||
					model.name.toLowerCase().includes(needle),
			)
		: rest;
	const groups = new Map<string, GatewayModel[]>();
	for (const model of filtered) {
		groups.set(model.vendor, [...(groups.get(model.vendor) ?? []), model]);
	}

	function toggle(id: string, checked: boolean) {
		if (checked) {
			if (!pinned.includes(id)) setPinned([...pinned, id]);
			onChange([...selected, id]);
		} else {
			onChange(selected.filter((m) => m !== id));
		}
	}

	const row = (id: string) => {
		const model = byId.get(id);
		const price = model ? formatPrice(model) : null;
		return (
			<label key={id} className="flex min-h-11 items-start gap-2 py-1 text-sm">
				<input
					type="checkbox"
					className="mt-1"
					checked={selected.includes(id)}
					onChange={(event) => toggle(id, event.target.checked)}
				/>
				<span className="min-w-0">
					<span className="block break-all font-mono text-xs">{id}</span>
					{price ? (
						<span className="block text-muted-foreground text-xs">{price}</span>
					) : null}
				</span>
			</label>
		);
	};

	return (
		<fieldset className="space-y-1">
			<legend className="text-sm">Modelos permitidos</legend>
			{selected.map((id) => (
				<input key={id} type="hidden" name="allowed_models" value={id} />
			))}
			{pinned.map(row)}

			{catalog.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No pude traer el catálogo de AI Gateway. Probá de nuevo más tarde para
					sumar modelos.
				</p>
			) : (
				<>
					<Button
						type="button"
						variant="link"
						className="h-auto px-0"
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded
							? "Ocultar el resto del catálogo"
							: `Ver más modelos (${rest.length})`}
					</Button>
					{expanded ? (
						<div className="space-y-3 rounded-md border p-3">
							<Input
								type="search"
								placeholder="Buscar por proveedor o modelo"
								aria-label="Buscar modelo"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<div className="max-h-96 space-y-3 overflow-y-auto">
								{[...groups].map(([vendor, models]) => (
									<div key={vendor}>
										<p className="font-medium text-muted-foreground text-xs uppercase">
											{vendor}
										</p>
										{models.map((model) => row(model.id))}
									</div>
								))}
								{groups.size === 0 ? (
									<p className="text-muted-foreground text-sm">
										Ningún modelo coincide.
									</p>
								) : null}
							</div>
						</div>
					) : null}
				</>
			)}
			<p className="text-muted-foreground text-xs">
				Precios de AI Gateway en dólares.
			</p>
		</fieldset>
	);
}
