// Normalización de config_values para /settings/outreach (spec 21.3 §6.1).
export type ListKind = "segmento" | "idioma" | "hook" | "vector";

export interface ListValueRow {
	kind: ListKind;
	value: string;
	label: string;
	active: boolean;
	defaultHook: string | null;
}

const ORDER: ListKind[] = ["segmento", "idioma", "hook", "vector"];

export function toListValues(raw: readonly unknown[]): ListValueRow[] {
	return raw
		.flatMap((entry) => {
			const row = entry as Record<string, unknown>;
			const kind = row.kind as ListKind;
			if (!ORDER.includes(kind) || typeof row.value !== "string") return [];
			const meta = (row.meta ?? {}) as Record<string, unknown>;
			return [
				{
					kind,
					value: row.value,
					label: typeof row.label === "string" ? row.label : row.value,
					active: row.active === true,
					defaultHook:
						typeof meta.default_hook === "string" ? meta.default_hook : null,
				},
			];
		})
		.sort(
			(a, b) =>
				ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
				a.label.localeCompare(b.label, "es"),
		);
}
