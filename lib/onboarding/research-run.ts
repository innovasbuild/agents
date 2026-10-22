// Corre el research de carpetas de una empresa y deja el resultado en el store
// (spec 27 §5.2). Puro: sin next/* ni admin; el cableado real está en
// research-deps.ts. Nunca tira: cualquier falla queda como status error.
import type { generateText } from "ai";
import type { WebPageResult } from "../outreach/web-page";
import type { GatewayOptions } from "../workflows/gateway-options";
import { normalizeProposal } from "./folder-template";
import type { ResearchErrorCode, ResearchStore } from "./research-store";
import type { proposeFolders } from "./services/propose-folders";

export async function runFolderResearch(
	input: {
		tenantId: string;
		domain: string;
		displayName: string;
		hint: string | null;
		model: string;
	},
	deps: {
		store: ResearchStore;
		propose: typeof proposeFolders;
		readPage: (url: string) => Promise<WebPageResult>;
		providerOptions?: GatewayOptions;
	},
): Promise<void> {
	const { store } = deps;
	const { tenantId } = input;
	const fail = async (code: ResearchErrorCode, detail?: unknown) => {
		// El detalle crudo (Supabase, gateway, DNS) no va a la fila: un admin de
		// la empresa la puede leer.
		if (detail !== undefined)
			console.error("onboarding_research:", tenantId, code, detail);
		try {
			await store.fail(tenantId, code);
		} catch (error) {
			console.error("onboarding_research:", tenantId, error);
		}
	};
	try {
		await store.start(tenantId, input.hint);
	} catch (error) {
		return await fail("fallo_guardado", error);
	}
	let output: Awaited<ReturnType<typeof proposeFolders>>["output"];
	try {
		({ output } = await deps.propose(
			{
				domain: input.domain,
				displayName: input.displayName,
				hint: input.hint,
				model: input.model,
			},
			{
				// Lo inyecta la puerta que mide el gasto (research-deps.ts).
				generateText: undefined as unknown as typeof generateText,
				readPage: deps.readPage,
				providerOptions: deps.providerOptions,
			},
		));
	} catch (error) {
		return await fail("fallo_modelo", error);
	}
	if (!output) return await fail("sin_salida");
	// Con hint, las carpetas salen de las líneas de la persona: siempre sirve.
	// Sin hint y sin sitio, `found: false` queda para que la pantalla lo pida.
	const found = input.hint ? true : output.found;
	try {
		await store.finish(tenantId, { ...normalizeProposal(output), found });
	} catch (error) {
		await fail("fallo_guardado", error);
	}
}
