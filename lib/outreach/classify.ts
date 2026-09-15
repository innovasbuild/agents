// Clasificación de respuestas del sweep (spec 03 §8.2).
import { z } from "zod";
import type { OutreachStage } from "./stage";

export const REPLY_CATEGORIES = [
	"no_interesado",
	"respuesta_neutra",
	"en_conversacion",
	"reunion_agendada",
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const replyClassificationSchema = z.object({
	categoria: z.enum(REPLY_CATEGORIES),
	resumen: z.string().trim().min(1).max(500),
	cita: z.string().trim().min(1).max(4000),
});

export function stageForReply(category: ReplyCategory): OutreachStage {
	return category;
}

export function wantsDeal(category: ReplyCategory): boolean {
	return category === "en_conversacion" || category === "reunion_agendada";
}
