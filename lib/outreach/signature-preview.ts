// Firma del ejecutor para la previsualización del chat. La tarjeta tiene que
// mostrar el mail como lo va a leer el destinatario, firma incluida, y eso sale
// de los mismos datos que usa composeMail al enviar (send.ts): la fila del
// ejecutor y la empresa del tenant.
import { z } from "zod";
import { signatureBlock } from "../gmail/signature";

const companySchema = z
	.object({
		company: z
			.object({ name: z.string().trim().min(1), url: z.string().trim().min(1) })
			.nullish(),
	})
	.partial();

export interface ExecutorSignatureRow {
	display_name: string | null;
	title: string | null;
	linkedin_url: string | null;
}

/**
 * Bloque de firma tal cual va al pie del mail, o null si el ejecutor todavía no
 * tiene nombre cargado (ahí el envío tampoco firma). `config` es el jsonb de
 * tenant_agents: si no trae empresa, la firma va sin ella.
 */
export function executorSignature(
	row: ExecutorSignatureRow | null,
	config: unknown,
): string | null {
	if (!row) return null;
	const parsed = companySchema.safeParse(config ?? {});
	return signatureBlock(
		{
			displayName: row.display_name,
			title: row.title,
			linkedinUrl: row.linkedin_url,
		},
		parsed.success ? (parsed.data.company ?? null) : null,
	);
}
