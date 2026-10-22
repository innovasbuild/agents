// Cableado real de runFolderResearch: admin client, lectura de páginas públicas
// y consumo asentado en usage_entries. Aparte de research-run.ts para que el
// run puro se pruebe sin env. Imports relativos: lo usan módulos de eve.
import { generateText } from "ai";
import { fetchPublicPage, resolveHost } from "../outreach/web-page";
import { createAdminClient } from "../supabase/admin";
import { createGatewayOptions } from "../workflows/gateway-options";
import { createUsageRecorder, metered } from "../workflows/usage";
import type { runFolderResearch } from "./research-run";
import { createResearchStore } from "./research-store";
import { proposeFolders } from "./services/propose-folders";

export function folderResearchDeps(
	tenantId: string,
): Parameters<typeof runFolderResearch>[1] {
	const admin = createAdminClient();
	const gatewayOptionsFor = createGatewayOptions(admin);
	const propose = metered(
		async (...[input, deps]: Parameters<typeof proposeFolders>) =>
			proposeFolders(input, {
				...deps,
				generateText,
				providerOptions:
					deps.providerOptions ?? (await gatewayOptionsFor(tenantId)),
			}),
		{
			model: (input) => input.model,
			record: createUsageRecorder(admin),
			base: {
				tenantId,
				runId: null,
				workflow: null,
				node: "onboarding/propose-folders",
			},
		},
	);
	return {
		store: createResearchStore(admin),
		propose,
		readPage: (url) => fetchPublicPage(url, { fetchImpl: fetch, resolveHost }),
	};
}
