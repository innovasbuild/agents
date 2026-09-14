// Configuración de outreach por tenant (spec 03 §4.3 y §4.8). Solo importa
// zod: lo usa scripts/outreach-config.mts con type stripping de Node.
import { z } from "zod";

export const DEFAULT_OUTREACH_MODELS = {
	draft_msg1: "anthropic/claude-opus-5",
	draft_followup: "anthropic/claude-sonnet-5",
	classify: "anthropic/claude-haiku-4.5",
	researcher: "anthropic/claude-haiku-4.5",
} as const;

export type OutreachModelRole = keyof typeof DEFAULT_OUTREACH_MODELS;

// Debe coincidir con GATE_IDIOMAS de gate.ts (hay test). No se importa porque
// gate.ts usa imports sin extensión que Node no resuelve desde un script.
export const SUPPORTED_IDIOMAS = ["es_ar", "es_es"] as const;

const modelId = z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/);

function isTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("es-AR", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export const outreachConfigSchema = z.object({
	timezone: z
		.string()
		.refine(isTimeZone, "zona horaria inválida")
		.default("America/Argentina/Buenos_Aires"),
	bcc: z.email().nullable().default(null),
	deal: z
		.object({ pipeline: z.string().min(1), stage: z.string().min(1) })
		.nullable()
		.default(null),
	models: z
		.object({
			draft_msg1: modelId,
			draft_followup: modelId,
			classify: modelId,
			researcher: modelId,
		})
		.partial()
		.default({}),
});

export type OutreachConfig = Omit<
	z.infer<typeof outreachConfigSchema>,
	"models"
> & {
	models: Record<OutreachModelRole, string>;
};

export function parseOutreachConfig(raw: unknown): OutreachConfig {
	const parsed = outreachConfigSchema.parse(raw ?? {});
	return {
		...parsed,
		models: { ...DEFAULT_OUTREACH_MODELS, ...parsed.models },
	};
}

const VALUE = /^[a-z0-9][a-z0-9_]{0,60}$/;
const valueSchema = z.object({
	value: z.string().regex(VALUE),
	label: z.string().trim().min(1).max(200),
});

export const outreachFileSchema = z
	.object({
		config: outreachConfigSchema,
		values: z.object({
			segmento: z.array(valueSchema).min(1),
			hook: z.array(valueSchema).min(1),
			vector: z
				.array(
					valueSchema.extend({
						default_hook: z.string().regex(VALUE).nullable(),
					}),
				)
				.min(1),
			idioma: z
				.array(valueSchema.extend({ value: z.enum(SUPPORTED_IDIOMAS) }))
				.min(1),
		}),
	})
	.superRefine((file, ctx) => {
		for (const [kind, list] of Object.entries(file.values)) {
			const seen = new Set<string>();
			for (const item of list) {
				if (seen.has(item.value)) {
					ctx.addIssue({
						code: "custom",
						path: ["values", kind],
						message: `valor repetido en values.${kind}: "${item.value}"`,
					});
				}
				seen.add(item.value);
			}
		}
		const hooks = new Set(file.values.hook.map((hook) => hook.value));
		for (const vector of file.values.vector) {
			if (vector.default_hook && !hooks.has(vector.default_hook)) {
				ctx.addIssue({
					code: "custom",
					path: ["values", "vector"],
					message: `el hook "${vector.default_hook}" no está en values.hook`,
				});
			}
		}
	});

export type OutreachFile = z.infer<typeof outreachFileSchema>;
export type ConfigValueKind = "segmento" | "vector" | "hook" | "idioma";

export interface ConfigValueRow {
	id: string;
	kind: ConfigValueKind;
	value: string;
	label: string;
	active: boolean;
	meta: Record<string, unknown>;
}

export interface ConfigValuesPlan {
	upserts: Array<{
		kind: ConfigValueKind;
		value: string;
		label: string;
		meta: Record<string, unknown>;
	}>;
	deactivate: ConfigValueRow[];
	unchanged: number;
}

const KINDS: ConfigValueKind[] = ["segmento", "hook", "vector", "idioma"];

export function planConfigValues(
	current: ConfigValueRow[],
	file: OutreachFile,
): ConfigValuesPlan {
	const byKey = new Map(
		current.map((row) => [`${row.kind}:${row.value}`, row]),
	);
	const wanted = new Set<string>();
	const plan: ConfigValuesPlan = { upserts: [], deactivate: [], unchanged: 0 };

	for (const kind of KINDS) {
		for (const item of file.values[kind]) {
			const meta: Record<string, unknown> =
				kind === "vector" && "default_hook" in item
					? { default_hook: item.default_hook }
					: {};
			const key = `${kind}:${item.value}`;
			wanted.add(key);
			const existing = byKey.get(key);
			if (
				existing?.active &&
				existing.label === item.label &&
				JSON.stringify(existing.meta) === JSON.stringify(meta)
			) {
				plan.unchanged++;
			} else {
				plan.upserts.push({ kind, value: item.value, label: item.label, meta });
			}
		}
	}
	for (const row of current) {
		if (row.active && !wanted.has(`${row.kind}:${row.value}`))
			plan.deactivate.push(row);
	}
	return plan;
}
