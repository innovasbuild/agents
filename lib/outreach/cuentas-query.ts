// Lectura de /cuentas. La ficha es la misma que arma research_account: acá
// solo se le pone una pantalla, sin ninguna escritura.
import { type Ficha, fichaSchema, isFichaVigente } from "./ficha";

export interface AccountRow {
	id: string;
	domain: string;
	name: string;
	researchedAt: string;
	expiresAt: string;
	/** false si la ficha sigue vigente (isFichaVigente). */
	vencida: boolean;
	contactCount: number;
	/** null si el jsonb guardado no matchea el schema vigente de la ficha. */
	ficha: Ficha | null;
}

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";

export function toAccountRows(
	raw: readonly unknown[],
	now: Date,
): AccountRow[] {
	return raw.map((entry) => {
		const row = entry as Record<string, unknown>;
		const parsedFicha = fichaSchema.safeParse(row.ficha);
		const contactsEmbed = row.contacts as
			| { count?: unknown }[]
			| null
			| undefined;
		const contactCount =
			typeof contactsEmbed?.[0]?.count === "number"
				? contactsEmbed[0].count
				: 0;
		const expiresAt = str(row.expires_at);

		return {
			id: str(row.id),
			domain: str(row.domain),
			name: str(row.name),
			researchedAt: str(row.researched_at),
			expiresAt,
			vencida: !isFichaVigente(new Date(expiresAt), now),
			contactCount,
			ficha: parsedFicha.success ? parsedFicha.data : null,
		};
	});
}
