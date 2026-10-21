// Catálogo de modelos de Vercel AI Gateway para elegir los permitidos de una
// empresa. El endpoint es público: no lleva clave.

const CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

export interface GatewayModel {
	id: string;
	name: string;
	vendor: string;
	/** USD por millón de tokens; null si el gateway no publica precio. */
	inputPerMillion: number | null;
	outputPerMillion: number | null;
}

interface RawModel {
	id?: unknown;
	name?: unknown;
	owned_by?: unknown;
	type?: unknown;
	pricing?: { input?: unknown; output?: unknown };
}

const perMillion = (value: unknown) => {
	const n = typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(n) ? n * 1_000_000 : null;
};

/**
 * Solo modelos de texto: el chat y los agentes no usan imagen, video ni
 * embeddings. Las variantes `-batch` no sirven para una conversación.
 */
export function parseGatewayCatalog(json: unknown): GatewayModel[] {
	const data = (json as { data?: unknown })?.data;
	if (!Array.isArray(data)) return [];
	return (data as RawModel[])
		.filter(
			(m) =>
				m.type === "language" &&
				typeof m.id === "string" &&
				!m.id.endsWith("-batch"),
		)
		.map((m) => {
			const id = m.id as string;
			return {
				id,
				name: typeof m.name === "string" ? m.name : id,
				vendor: typeof m.owned_by === "string" ? m.owned_by : id.split("/")[0],
				inputPerMillion: perMillion(m.pricing?.input),
				outputPerMillion: perMillion(m.pricing?.output),
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** Si el gateway no responde, la pantalla sigue con los modelos ya elegidos. */
export async function loadGatewayModels(): Promise<GatewayModel[]> {
	try {
		const response = await fetch(CATALOG_URL, {
			next: { revalidate: 86_400 },
		});
		if (!response.ok) return [];
		return parseGatewayCatalog(await response.json());
	} catch {
		return [];
	}
}

export function formatPrice(model: GatewayModel): string | null {
	const { inputPerMillion: input, outputPerMillion: output } = model;
	if (input === null || output === null) return null;
	const usd = (n: number) =>
		`US$ ${n < 1 ? n.toFixed(2) : n.toFixed(n % 1 === 0 ? 0 : 2)}`;
	return `${usd(input)} entrada · ${usd(output)} salida por millón de tokens`;
}
