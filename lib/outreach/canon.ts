// Canon del tenant para redactar y reglas del gate (spec 03 §5.2 y §6.2):
// páginas del brain por tag. Si el brain falla, o si el tenant no tiene canon
// cargado, no se redacta ni se encola ni se envía (ver loadCanonOrMissing).
import { getBrainProvider } from "../brain/adapters/provider";
import { resolveBrainBinding } from "../brain/core/resolve";
import { withoutSkills } from "../brain/core/skills/view";
import type { BrainPage, BrainProvider } from "../brain/core/types";
import { loadTenantBindings } from "../connectors/bindings";
import {
	type BlockPage,
	type IcpLevels,
	type Marco,
	parseIcpBlocks,
	parseMarcoBlocks,
} from "./canon-blocks";
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

class TooManyPagesError extends Error {}

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

/** Por qué no hay canon usable. Las dos causas frenan igual (sin el canon se
 * redactaría sin ICP ni voz y el gate correría sin los vetos ni el max_chars
 * del tenant), pero el ejecutor tiene que poder distinguirlas. */
export interface CanonMissing {
	missing: "brain_caido" | "sin_canon";
}

export function isCanonMissing<T extends object>(
	value: T | CanonMissing,
): value is CanonMissing {
	return "missing" in value;
}

/** Causa de la negativa `canon_no_disponible`; cada servicio le suma su cola. */
export function canonMissingText(canon: CanonMissing): string {
	return canon.missing === "brain_caido"
		? "no pude leer el canon del cliente en el brain"
		: "el brain del cliente no está conectado o no tiene el canon cargado";
}

/** El canon, o por qué no se puede usar: cada servicio arma su negativa. Un
 * canon vacío (sin binding de brain, o con brain sin páginas `canon:*`) se
 * trata igual que un brain caído; así la condición no se repite en los tres
 * servicios que lo consumen. */
export async function loadCanonOrMissing(
	load: (executorSlug: string) => Promise<Canon>,
	executorSlug: string,
): Promise<Canon | CanonMissing> {
	let canon: Canon;
	try {
		canon = await load(executorSlug);
	} catch (error) {
		if (error instanceof CanonUnavailableError)
			return { missing: "brain_caido" };
		throw error;
	}
	return canon.available && canon.pages.length > 0
		? canon
		: { missing: "sin_canon" };
}

export const ICP_TAG = "canon:icp";
export const MARCO_TAG = "canon:hooks";

/** Lo que el outreach lee de un bloque del canon, o por qué no pudo. Nunca
 * tira: quien llama decide qué hacer con cada motivo (spec 21.3 §3.3). */
export type CanonLoad<T> =
	| { ok: true; value: T }
	| {
			ok: false;
			reason: "sin_brain" | "brain_caido" | "falta" | "invalido";
			errors: string[];
	  };

// Solo páginas activas (spec O8): la búsqueda del brain devuelve borradores,
// y una plantilla sin completar no puede calificar ni reflejarse.
async function activeBlockPages(
	brain: BrainProvider,
	tag: string,
): Promise<BlockPage[]> {
	// Se pide una de más: si vuelve, hay más páginas que el tope y leer solo
	// las primeras ocultaría bloques (spec 21.3 §3.3).
	const found = await brain.search({
		query: "",
		tag,
		limit: MAX_PAGES_PER_TAG + 1,
	});
	if (found.length > MAX_PAGES_PER_TAG) throw new TooManyPagesError(tag);
	const pages = await Promise.all(found.map((s) => brain.read(s.slug)));
	return pages
		.filter((page) => page.status === "activo")
		.map((page) => ({ slug: page.slug, body: page.body }));
}

async function loadBlocks<T>(
	brain: BrainProvider | null,
	tag: string,
	parse: (pages: BlockPage[]) => {
		value: T | null;
		blocks: number;
		errors: string[];
	},
): Promise<CanonLoad<T>> {
	if (!brain) return { ok: false, reason: "sin_brain", errors: [] };
	let pages: BlockPage[];
	try {
		pages = await activeBlockPages(brain, tag);
	} catch (error) {
		if (error instanceof TooManyPagesError) {
			return {
				ok: false,
				reason: "invalido",
				errors: [
					`hay más de ${MAX_PAGES_PER_TAG} páginas con el tag ${tag}: es un error de carga, dejá como máximo ${MAX_PAGES_PER_TAG}`,
				],
			};
		}
		console.error(`canon: no pude leer ${tag}:`, error);
		return { ok: false, reason: "brain_caido", errors: [] };
	}
	const parsed = parse(pages);
	if (parsed.blocks === 0) return { ok: false, reason: "falta", errors: [] };
	if (parsed.errors.length > 0 || parsed.value === null) {
		return { ok: false, reason: "invalido", errors: parsed.errors };
	}
	return { ok: true, value: parsed.value };
}

export function loadIcpLevels(
	brain: BrainProvider | null,
): Promise<CanonLoad<IcpLevels>> {
	return loadBlocks(brain, ICP_TAG, (pages) => {
		const { icp, blocks, errors } = parseIcpBlocks(pages);
		return { value: icp, blocks, errors };
	});
}

export function loadMarco(
	brain: BrainProvider | null,
): Promise<CanonLoad<Marco>> {
	return loadBlocks(brain, MARCO_TAG, (pages) => {
		const { hooks, vectores, blocks, errors } = parseMarcoBlocks(pages);
		return { value: { hooks, vectores }, blocks, errors };
	});
}

export async function brainForTenant(
	tenantId: string,
): Promise<BrainProvider | null> {
	const binding = await resolveBrainBinding(tenantId, loadTenantBindings);
	// Lo que sale de acá alimenta al modelo: nunca ve skills/ (spec 24.1 S6).
	return binding ? withoutSkills(getBrainProvider(binding)) : null;
}
