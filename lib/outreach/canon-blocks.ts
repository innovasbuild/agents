// lib/outreach/canon-blocks.ts
// Bloques de canon que el outreach lee del brain (spec 21.3 §3.1 y §3.2):
// ```icp en la página canon:icp, ```hooks y ```vectores en las canon:hooks.
// Mismo formato de líneas que ```gate (gate-blocks.ts). Puro: no tira.
import { createHash } from "node:crypto";

export interface BlockPage {
	slug: string;
	body: string;
}

export interface IcpLevels {
	encaje_empresa: string[];
	rol_decisor: string[];
	excluir: string;
}

export interface ListValue {
	value: string;
	label: string;
}

export interface VectorValue extends ListValue {
	default_hook: string | null;
}

export interface Marco {
	hooks: ListValue[];
	vectores: VectorValue[];
}

// Mismo criterio que el check de config_values.value.
const VALUE = /^[a-z0-9][a-z0-9_]{0,60}$/;

interface Entry {
	key: string;
	value: string;
	raw: string;
	/** "pagina, línea N", para mostrarle a la persona. */
	at: string;
	slug: string;
}

function readBlocks(
	pages: BlockPage[],
	name: string,
): { entries: Entry[]; slugs: string[] } {
	const entries: Entry[] = [];
	const slugs: string[] = [];
	const pattern = new RegExp(
		`\`\`\`${name}[ \\t]*\\r?\\n([\\s\\S]*?)\`\`\``,
		"g",
	);
	for (const page of pages) {
		for (const block of page.body.matchAll(pattern)) {
			slugs.push(page.slug);
			const firstLine =
				page.body.slice(0, block.index ?? 0).split("\n").length + 1;
			block[1].split(/\r?\n/).forEach((rawLine, index) => {
				const line = rawLine.replace(/\s+#.*$/, "").trim();
				if (!line || line.startsWith("#")) return;
				const separator = line.indexOf(":");
				entries.push({
					key: separator === -1 ? "" : line.slice(0, separator).trim(),
					value:
						separator === -1
							? ""
							: line
									.slice(separator + 1)
									.trim()
									.replace(/\s+/g, " "),
					raw: line,
					at: `${page.slug}, línea ${firstLine + index}`,
					slug: page.slug,
				});
			});
		}
	}
	return { entries, slugs };
}

const LEVEL_KEYS = { encaje: "encaje_empresa", rol: "rol_decisor" } as const;

export function parseIcpBlocks(pages: BlockPage[]): {
	icp: IcpLevels | null;
	blocks: number;
	errors: string[];
} {
	const { entries, slugs } = readBlocks(pages, "icp");
	if (slugs.length === 0) return { icp: null, blocks: 0, errors: [] };
	if (slugs.length > 1) {
		return {
			icp: null,
			blocks: slugs.length,
			errors: [`hay más de un bloque icp: ${slugs.join(", ")}. Dejá uno solo.`],
		};
	}
	const slug = slugs[0];
	const errors: string[] = [];
	const levels = {
		encaje_empresa: [] as string[],
		rol_decisor: [] as string[],
	};
	const excluir: string[] = [];

	for (const entry of entries) {
		if (
			entry.key !== "encaje" &&
			entry.key !== "rol" &&
			entry.key !== "excluir"
		) {
			errors.push(`${entry.at}: directiva no reconocida: "${entry.raw}"`);
			continue;
		}
		if (entry.value.length < 10 || entry.value.length > 400) {
			errors.push(
				`${entry.at}: el nivel tiene que tener entre 10 y 400 caracteres`,
			);
			continue;
		}
		if (entry.key === "excluir") excluir.push(entry.value);
		else levels[LEVEL_KEYS[entry.key]].push(entry.value);
	}

	// Las cuentas se hacen sobre lo que el bloque trae, no sobre lo que pasó la
	// validación de largo: un nivel corto ya dio su propio error.
	const count = (key: string) =>
		entries.filter((entry) => entry.key === key).length;
	for (const key of ["encaje", "rol"] as const) {
		const n = count(key);
		if (n < 2 || n > 10) {
			errors.push(
				`${slug}: el bloque icp necesita entre 2 y 10 líneas ${key} (tiene ${n})`,
			);
		}
	}
	if (count("excluir") !== 1) {
		errors.push(
			`${slug}: el bloque icp necesita exactamente una línea excluir (tiene ${count("excluir")})`,
		);
	}

	return {
		icp: errors.length === 0 ? { ...levels, excluir: excluir[0] } : null,
		blocks: 1,
		errors,
	};
}

function readList(
	entries: Entry[],
	noun: "hook" | "vector",
	errors: string[],
): Array<ListValue & { rest: string; at: string }> {
	const seen = new Map<string, string>();
	const out: Array<ListValue & { rest: string; at: string }> = [];
	for (const entry of entries) {
		if (!VALUE.test(entry.key)) {
			errors.push(
				`${entry.at}: identificador inválido: "${entry.key || entry.raw}" (minúsculas, dígitos y guion bajo)`,
			);
			continue;
		}
		const arrow = entry.value.lastIndexOf(" => ");
		const label =
			noun === "vector" && arrow !== -1
				? entry.value.slice(0, arrow).trim()
				: entry.value;
		const rest =
			noun === "vector" && arrow !== -1
				? entry.value.slice(arrow + 4).trim()
				: "";
		if (label.length < 1 || label.length > 200) {
			errors.push(
				`${entry.at}: el rótulo tiene que tener entre 1 y 200 caracteres`,
			);
			continue;
		}
		const previous = seen.get(entry.key);
		if (previous) {
			errors.push(
				`${entry.at}: el ${noun} "${entry.key}" ya está en ${previous}`,
			);
			continue;
		}
		seen.set(entry.key, entry.at);
		out.push({ value: entry.key, label, rest, at: entry.at });
	}
	return out;
}

export function parseMarcoBlocks(pages: BlockPage[]): Marco & {
	blocks: number;
	errors: string[];
} {
	const hookBlocks = readBlocks(pages, "hooks");
	const vectorBlocks = readBlocks(pages, "vectores");
	const blocks = hookBlocks.slugs.length + vectorBlocks.slugs.length;
	if (blocks === 0) return { hooks: [], vectores: [], blocks: 0, errors: [] };

	const errors: string[] = [];
	const hooks = readList(hookBlocks.entries, "hook", errors);
	const vectors = readList(vectorBlocks.entries, "vector", errors);
	const hookValues = new Set(hooks.map((hook) => hook.value));
	for (const vector of vectors) {
		if (vector.rest && !hookValues.has(vector.rest)) {
			errors.push(
				`${vector.at}: el vector "${vector.value}" apunta al hook "${vector.rest}", que no está en ningún bloque hooks`,
			);
		}
	}
	if (hooks.length === 0) {
		errors.push(
			"faltan hooks: tiene que haber al menos uno en un bloque hooks",
		);
	}
	if (vectors.length === 0) {
		errors.push(
			"faltan vectores: tiene que haber al menos uno en un bloque vectores",
		);
	}

	return {
		hooks: hooks.map(({ value, label }) => ({ value, label })),
		vectores: vectors.map(({ value, label, rest }) => ({
			value,
			label,
			default_hook: rest || null,
		})),
		blocks,
		errors,
	};
}

/** Huella de los niveles (spec O2): cambia si cambia un nivel, no si cambia
 * la prosa de alrededor. Los espacios ya vienen normalizados del parser. */
export function icpRevision(icp: IcpLevels): string {
	return createHash("sha256")
		.update(JSON.stringify([icp.encaje_empresa, icp.rol_decisor, icp.excluir]))
		.digest("hex")
		.slice(0, 16);
}
