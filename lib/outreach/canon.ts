// Canon del tenant para redactar y reglas del gate (spec 03 §5.2 y §6.2):
// páginas del brain por tag. Si el brain falla, no se redacta ni se encola.
import { getBrainProvider } from "../brain/provider";
import { resolveBrainBinding } from "../brain/resolve";
import type { BrainPage, BrainProvider } from "../brain/types";
import { loadTenantBindings } from "../connectors/bindings";
import { createAdminClient } from "../supabase/admin";
import {
	emptyGateRules,
	type GateRules,
	mergeGateRules,
	parseGateBlocks,
} from "./gate-blocks";

export const CANON_TAGS_FOR_DRAFT = [
	"canon:icp",
	"canon:hooks",
	"canon:mensajes",
	"canon:objeciones",
] as const;
export const VOICE_TAG = "canon:voz";
export const GATE_TAG = "canon:gate";
const MAX_PAGES_PER_TAG = 5;

export class CanonUnavailableError extends Error {
	constructor(cause: unknown) {
		super("no pude leer el canon del tenant en el brain", { cause });
		this.name = "CanonUnavailableError";
	}
}

export interface CanonPage {
	tag: string;
	slug: string;
	title: string;
	body: string;
}

export interface Canon {
	available: boolean;
	pages: CanonPage[];
	voice: CanonPage[];
	rules: GateRules;
}

async function readTag(
	brain: BrainProvider,
	tag: string,
): Promise<BrainPage[]> {
	const found = await brain.search({
		query: "",
		tag,
		limit: MAX_PAGES_PER_TAG,
	});
	return Promise.all(found.map((summary) => brain.read(summary.slug)));
}

const toCanonPage =
	(tag: string) =>
	(page: BrainPage): CanonPage => ({
		tag,
		slug: page.slug,
		title: page.title,
		body: page.body,
	});

export async function loadCanon(
	brain: BrainProvider | null,
	executorSlug: string | null,
): Promise<Canon> {
	if (!brain)
		return { available: false, pages: [], voice: [], rules: emptyGateRules() };
	try {
		const executorTag = executorSlug ? `executor:${executorSlug}` : null;
		const [canonGroups, voicePages, executorPages, gatePages] =
			await Promise.all([
				Promise.all(
					CANON_TAGS_FOR_DRAFT.map(async (tag) =>
						(await readTag(brain, tag)).map(toCanonPage(tag)),
					),
				),
				readTag(brain, VOICE_TAG),
				executorTag ? readTag(brain, executorTag) : Promise.resolve([]),
				readTag(brain, GATE_TAG),
			]);
		const tenantVoice = voicePages.filter(
			(page) => !page.tags.some((tag) => tag.startsWith("executor:")),
		);
		const executorVoice = executorPages.filter((page) =>
			page.tags.includes(VOICE_TAG),
		);
		const rules = mergeGateRules(
			...gatePages.map((page) => parseGateBlocks(page.body, page.slug)),
			...executorVoice.map((page) => parseGateBlocks(page.body, page.slug)),
		);
		return {
			available: true,
			pages: [
				...canonGroups.flat(),
				...tenantVoice.map(toCanonPage(VOICE_TAG)),
			],
			voice: executorVoice.map(toCanonPage(VOICE_TAG)),
			rules,
		};
	} catch (error) {
		throw new CanonUnavailableError(error);
	}
}

/** El canon, o null si el brain no responde: cada servicio arma su negativa. */
export async function loadCanonOrNull(
	load: (executorSlug: string) => Promise<Canon>,
	executorSlug: string,
): Promise<Canon | null> {
	try {
		return await load(executorSlug);
	} catch (error) {
		if (error instanceof CanonUnavailableError) return null;
		throw error;
	}
}

export async function brainForTenant(
	tenantId: string,
): Promise<BrainProvider | null> {
	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	return binding ? getBrainProvider(binding, createAdminClient()) : null;
}
