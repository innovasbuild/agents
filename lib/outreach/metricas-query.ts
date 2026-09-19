// /metricas: qué hook, vector, segmento y ejecutor funcionan mejor. PostgREST
// no cruza contacts con events en una sola consulta, así que el join es acá,
// en JS, sobre dos lecturas ya traídas.
import type { OutreachStage } from "./stage";

export type MetricDimension = "hook" | "vector" | "segmento" | "ejecutor";

export interface MetricRow {
	/** El value crudo, o "sin_clasificar"/"sin_dueno" cuando el contacto no lo tiene. */
	value: string;
	label: string;
	enviados: number;
	respondieron: number;
	/** Porcentaje redondeado de respondieron sobre enviados. 0 si enviados es 0. */
	tasa: number;
	rebotados: number;
}

export interface Metricas {
	hook: MetricRow[];
	vector: MetricRow[];
	segmento: MetricRow[];
	ejecutor: MetricRow[];
}

// Etapas que NO cuentan como respuesta: todavía no se tocó, se mandó el
// primer mensaje sin señal, se pasó la ventana sin respuesta, o el contacto
// nunca tuvo atribución. Cualquier otra etapa implica que hubo una señal real.
const SIN_RESPUESTA: readonly OutreachStage[] = [
	"a_contactar",
	"msg1_enviado",
	"sin_respuesta",
	"sin_atribucion",
];

const first = <T>(value: T | T[] | null | undefined): T | null => {
	if (value === null || value === undefined) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
};

interface Bucket {
	label: string;
	enviados: number;
	respondieron: number;
	rebotados: number;
}

function addTo(
	buckets: Map<string, Bucket>,
	value: string,
	label: string,
	patch: Partial<Omit<Bucket, "label">>,
) {
	const bucket = buckets.get(value) ?? {
		label,
		enviados: 0,
		respondieron: 0,
		rebotados: 0,
	};
	buckets.set(value, {
		label,
		enviados: bucket.enviados + (patch.enviados ?? 0),
		respondieron: bucket.respondieron + (patch.respondieron ?? 0),
		rebotados: bucket.rebotados + (patch.rebotados ?? 0),
	});
}

function toRows(buckets: Map<string, Bucket>): MetricRow[] {
	return [...buckets.entries()]
		.map(([value, bucket]) => ({
			value,
			label: bucket.label,
			enviados: bucket.enviados,
			respondieron: bucket.respondieron,
			tasa:
				bucket.enviados === 0
					? 0
					: Math.round((bucket.respondieron / bucket.enviados) * 100),
			rebotados: bucket.rebotados,
		}))
		.sort((a, b) => b.enviados - a.enviados || a.value.localeCompare(b.value));
}

export function toMetricas(
	contactsRaw: readonly unknown[],
	eventsRaw: readonly unknown[],
	configValuesRaw: readonly unknown[],
): Metricas {
	// value -> label, por kind. config_value_kind no incluye "ejecutor": ese
	// label sale del embed de executors, no de acá.
	const labelsByKind = new Map<string, Map<string, string>>();
	for (const entry of configValuesRaw) {
		const row = entry as { kind?: unknown; value?: unknown; label?: unknown };
		if (typeof row.kind !== "string" || typeof row.value !== "string") continue;
		const byValue = labelsByKind.get(row.kind) ?? new Map<string, string>();
		byValue.set(
			row.value,
			typeof row.label === "string" ? row.label : row.value,
		);
		labelsByKind.set(row.kind, byValue);
	}

	const bouncedKeys = new Set(
		eventsRaw
			.map((e) => (e as { contact_key?: unknown }).contact_key)
			.filter((k): k is string => typeof k === "string"),
	);

	const buckets: Record<MetricDimension, Map<string, Bucket>> = {
		hook: new Map(),
		vector: new Map(),
		segmento: new Map(),
		ejecutor: new Map(),
	};

	const labelFor = (kind: string, value: string) =>
		labelsByKind.get(kind)?.get(value) ?? value;

	for (const entry of contactsRaw) {
		const row = entry as Record<string, unknown>;
		const contactKey =
			typeof row.contact_key === "string" ? row.contact_key : null;
		const touches = typeof row.touches === "number" ? row.touches : 0;
		const enviado = touches > 0 ? 1 : 0;
		const respondio =
			enviado &&
			typeof row.stage === "string" &&
			!SIN_RESPUESTA.includes(row.stage as OutreachStage)
				? 1
				: 0;
		const rebotado = contactKey && bouncedKeys.has(contactKey) ? 1 : 0;
		const patch = {
			enviados: enviado,
			respondieron: respondio,
			rebotados: rebotado,
		};

		const hook = typeof row.hook === "string" ? row.hook : null;
		addTo(
			buckets.hook,
			hook ?? "sin_clasificar",
			hook ? labelFor("hook", hook) : "Sin clasificar",
			patch,
		);

		const vector = typeof row.vector === "string" ? row.vector : null;
		addTo(
			buckets.vector,
			vector ?? "sin_clasificar",
			vector ? labelFor("vector", vector) : "Sin clasificar",
			patch,
		);

		const segmento = typeof row.segment === "string" ? row.segment : null;
		addTo(
			buckets.segmento,
			segmento ?? "sin_clasificar",
			segmento ? labelFor("segmento", segmento) : "Sin clasificar",
			patch,
		);

		const ownerUserId =
			typeof row.owner_user_id === "string" ? row.owner_user_id : null;
		const owner = first(row.executors as { slug?: unknown } | null);
		const ownerSlug = typeof owner?.slug === "string" ? owner.slug : null;
		addTo(
			buckets.ejecutor,
			ownerUserId ?? "sin_dueno",
			ownerUserId ? (ownerSlug ?? ownerUserId) : "Sin dueño",
			patch,
		);
	}

	return {
		hook: toRows(buckets.hook),
		vector: toRows(buckets.vector),
		segmento: toRows(buckets.segmento),
		ejecutor: toRows(buckets.ejecutor),
	};
}
