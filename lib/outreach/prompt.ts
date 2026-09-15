// Prompt de redacción (spec 03 §6.2 skill outreach-redaccion). Plantilla
// genérica: todo lo del tenant entra como datos.
import { z } from "zod";
import type { CanonPage } from "./canon";
import { SUPPORTED_IDIOMAS } from "./config";
import type { Ficha } from "./ficha";
import type { GateViolation } from "./gate";

export const draftOutputSchema = z.object({
	subject: z.string().trim().min(1).max(200),
	body: z.string().trim().min(1).max(5000),
	hook: z.string().min(1),
	vector: z.string().min(1),
	idioma: z.enum(SUPPORTED_IDIOMAS),
	ancla: z.object({
		hecho: z.string().trim().min(1),
		fuente: z.string().trim().min(1),
	}),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

export interface DraftPromptInput {
	contact: {
		name: string | null;
		company: string | null;
		segment: string | null;
		vector: string | null;
		hook: string | null;
		idioma: string | null;
	};
	ficha: Ficha;
	canon: CanonPage[];
	voice: CanonPage[];
	allowed: { hooks: string[]; vectors: string[]; idiomas: string[] };
	defaultHook: string | null;
	previousViolations: GateViolation[];
}

const MAX_PAGE_CHARS = 1_500;

const clip = (text: string) =>
	text.length > MAX_PAGE_CHARS
		? `${text.slice(0, MAX_PAGE_CHARS)}\n[…recortado]`
		: text;

const pages = (list: CanonPage[]) =>
	list.length === 0
		? "(sin páginas)"
		: list
				.map((page) => `## ${page.title} (${page.tag})\n${clip(page.body)}`)
				.join("\n\n");

export function buildDraftPrompt(input: DraftPromptInput): string {
	const { contact, ficha } = input;
	const hechos = ficha.hechos
		.map((h) => `- ${h.hecho} (${h.url}${h.fecha ? `, ${h.fecha}` : ""})`)
		.join("\n");
	const violations = input.previousViolations.length
		? `\n# Corregí esto del intento anterior\n${input.previousViolations.map((v) => `- ${v.what}. En su lugar: ${v.fix}`).join("\n")}\n`
		: "";
	return `Redactá el primer mensaje por email para esta persona. Devolvé solo el objeto pedido.

# Destinatario
Nombre: ${contact.name ?? "(sin nombre)"}
Empresa: ${contact.company ?? ficha.name}
Segmento: ${contact.segment ?? "(sin segmento)"}
Vector cargado: ${contact.vector ?? "(sin vector)"}

# Ficha de la cuenta (solo estos hechos existen)
Produce y vende: ${ficha.produce ?? "sin dato"}
Qué se le rompe si crece: ${ficha.rompe_si_crece ?? "sin dato"}
Gap demostrable: ${ficha.gap_demostrable ?? "sin dato"}
Hechos con fuente:
${hechos}

# Canon del cliente
${pages(input.canon)}

# Voz del ejecutor
${pages(input.voice)}

# Reglas
- Cuatro partes cortas: por qué le escribís a esta persona (un hecho de la ficha, citado en "ancla" con su URL en "fuente"), el dolor en sus palabras, qué hacemos en una frase, y un pedido concreto.
- La primera línea después del saludo usa el hecho del ancla. No inventes hechos, cifras ni clientes.
- Texto plano, sin links de tracking, sin firma HTML, sin rayas ni comillas tipográficas, sin signos de apertura, sin emojis.
- Idioma del destinatario: uno de ${input.allowed.idiomas.join(", ")}. Si es es_ar, voseo.
- Asunto de hasta 50 caracteres que nombre el dolor, no el producto.
- hook: uno de ${input.allowed.hooks.join(", ")}; hook por defecto del vector: ${input.defaultHook ?? "ninguno"}.
- vector: uno de ${input.allowed.vectors.join(", ")}.
${violations}`;
}
