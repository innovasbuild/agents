// Configuración de outreach por tenant (spec 03 §4.3 y §4.8). Se edita en
// /<slug>/settings/outreach (spec 21.3). Los niveles del ICP no están acá:
// viven en el brain.
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
	// Empresa que firma los mails (spec firma de outreach): sin esto la firma
	// muestra nombre y puesto del ejecutor pero no linkea a la empresa.
	company: z
		.object({ name: z.string().trim().min(1).max(120), url: z.url() })
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

export type ConfigValueKind = "segmento" | "vector" | "hook" | "idioma";
