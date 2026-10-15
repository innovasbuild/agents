// Qué se ve de una skill según por dónde se mire (spec etapa 24.1 §7).
// withoutSkills: los asistentes (tools del agente y endpoint MCP) no ven nada
// bajo skills/. No se resuelve con withAccess porque el agente es
// administrador en el brain.
// withSkillView: en la web, quien edita ve el borrador y quien solo lee ve la
// copia publicada; sin versión vigente, para un lector la skill no existe.
import { atLeast, type Level } from "../access/types.ts";
import { BrainForbidden, BrainNotFound } from "../errors.ts";
import type { BrainPage, BrainProvider, BrainWrite } from "../types.ts";
import { isSkillSlug, SKILL_CATEGORY } from "./package.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow } from "./store.ts";

// Las sugerencias de "no existe" salen del proveedor y podrían nombrar skills.
async function readHidingSkills(
	provider: BrainProvider,
	slug: string,
	readOptions: { suggestions?: boolean } | undefined,
	visible: (slug: string) => boolean = () => false,
): Promise<BrainPage> {
	try {
		// Sin opciones, la llamada llega al proveedor igual que sin envoltorio.
		return await (readOptions
			? provider.read(slug, readOptions)
			: provider.read(slug));
	} catch (error) {
		if (error instanceof BrainNotFound) {
			throw new BrainNotFound(
				error.slug,
				error.suggestions.filter((s) => !isSkillSlug(s) || visible(s)),
			);
		}
		throw error;
	}
}

// Un asistente no escribe skills. Se exporta para chequearlo antes de pedir
// reglas: así el rechazo es el de skills y no uno de reglas.
export function rejectSkillWrite(
	write: Pick<BrainWrite, "slug" | "category">,
): void {
	if (isSkillSlug(write.slug) || write.category === SKILL_CATEGORY) {
		throw new BrainForbidden(
			"Las skills no se editan con brain_upsert: si tu cliente ofrece skill_create y skill_draft_edit, usalas; publicar se hace desde la plataforma.",
		);
	}
}

export function withoutSkills(provider: BrainProvider): BrainProvider {
	return {
		async search(input) {
			return (await provider.search(input)).filter(
				(result) => !isSkillSlug(result.slug),
			);
		},
		async read(slug, options) {
			if (isSkillSlug(slug)) throw new BrainNotFound(slug, []);
			return readHidingSkills(provider, slug, options);
		},
		async list() {
			return (await provider.list()).filter((page) => !isSkillSlug(page.slug));
		},
		async history(slug) {
			return isSkillSlug(slug) ? null : provider.history(slug);
		},
		async upsert(write, author) {
			rejectSkillWrite(write);
			return provider.upsert(write, author);
		},
	};
}

export function withSkillView(
	provider: BrainProvider,
	options: {
		levelOf: (slug: string) => Level | null;
		overview: () => Promise<SkillOverviewRow[]>;
	},
): BrainProvider {
	// Una lectura por envoltorio: el contexto del editor vive un request.
	let loaded: Promise<Map<string, SkillOverviewRow>> | null = null;
	const rows = () => {
		loaded ??= options
			.overview()
			.then((list) => new Map(list.map((row) => [row.slug, row])));
		return loaded;
	};
	const seesDraft = (slug: string) => atLeast(options.levelOf(slug), "editor");

	const published = async (page: BrainPage): Promise<BrainPage | null> => {
		const snapshot = publishedSnapshot((await rows()).get(page.slug));
		if (!snapshot) return null;
		return {
			...page,
			// Nada del borrador llega a quien solo lee: la revisión es la que se
			// publicó, y las etiquetas y el estado no se publican.
			revision: snapshot.pageRevision,
			status: "activo",
			tags: [],
			title: snapshot.title,
			frontmatter: snapshot.frontmatter,
			body: snapshot.body,
			updatedAt: snapshot.publishedAt,
		};
	};

	return {
		async search(input) {
			// El fragmento sale del borrador: solo para quien lo puede ver.
			return (await provider.search(input)).filter(
				(result) => !isSkillSlug(result.slug) || seesDraft(result.slug),
			);
		},
		async read(slug, readOptions) {
			// Las sugerencias solo nombran skills cuyo borrador puede ver quien lee.
			const page = await readHidingSkills(
				provider,
				slug,
				readOptions,
				seesDraft,
			);
			if (!isSkillSlug(slug) || seesDraft(slug)) return page;
			const view = await published(page);
			if (!view) throw new BrainNotFound(slug, []);
			return view;
		},
		async list() {
			const pages = await provider.list();
			const out: BrainPage[] = [];
			for (const page of pages) {
				if (!isSkillSlug(page.slug) || seesDraft(page.slug)) {
					out.push(page);
					continue;
				}
				const view = await published(page);
				if (view) out.push(view);
			}
			return out;
		},
		async history(slug) {
			// Las revisiones son del borrador.
			if (isSkillSlug(slug) && !seesDraft(slug)) return null;
			return provider.history(slug);
		},
		upsert: (write, author) => provider.upsert(write, author),
	};
}
