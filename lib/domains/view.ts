// Lo que la consola muestra de un dominio: rótulos y las instrucciones de DNS
// que hay que pasarle al cliente (spec 21.6 §4.10). Sin imports de Next.
import type { DomainRow, DomainStatus } from "./service";
import type { VercelDomains } from "./vercel";

export const STATUS_LABELS: Record<DomainStatus, string> = {
	pending: "Pendiente",
	verifying: "Esperando el DNS",
	active: "Activo",
	failed: "Con error",
};

export interface DnsInstructions {
	/** Valor del registro CNAME, o null si Vercel no devolvió uno. */
	cname: string | null;
	/** Registro TXT de propiedad, solo si el dominio todavía no está verificado. */
	txt: { name: string; value: string } | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Qué registros tiene que crear el cliente para cada dominio que todavía no
 * está activo. Los valores salen de Vercel y no se escriben a mano. Una falla o
 * una demora de Vercel deja ese dominio sin instrucciones: la página sigue.
 */
export async function loadDnsInstructions(
	rows: DomainRow[],
	vercel: VercelDomains | null,
	timeoutMs = 4000,
): Promise<Map<string, DnsInstructions>> {
	const out = new Map<string, DnsInstructions>();
	if (!vercel) return out;

	await Promise.all(
		rows
			.filter((row) => row.status !== "active")
			.map(async (row) => {
				try {
					const [domain, config] = await withTimeout(
						Promise.all([
							vercel.get(row.hostname),
							vercel.config(row.hostname),
						]),
						timeoutMs,
					);
					const challenge = domain?.verified
						? undefined
						: domain?.verification.find((c) => c.type === "TXT");
					out.set(row.id, {
						cname: config.recommendedCname,
						txt: challenge
							? { name: challenge.domain, value: challenge.value }
							: null,
					});
				} catch (error) {
					console.error("dominios: no pude leer las instrucciones:", error);
				}
			}),
	);
	return out;
}
