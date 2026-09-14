// Reglas del gate que vienen del brain (spec 03 §5.2): bloques ```gate en la
// página canon:gate del tenant y en la voz del ejecutor. Los vetos NO son
// regex: vienen de datos editables y se compilan a una expresión acotada.
import { normalizeText } from "./text";

export interface GateVeto {
	phrase: string;
	literal: boolean;
	source: string;
}

export interface GateRules {
	vetos: GateVeto[];
	maxChars: { all: number | null; byChannel: Record<string, number> };
	formal: boolean;
	errors: string[];
}

export function emptyGateRules(): GateRules {
	return {
		vetos: [],
		maxChars: { all: null, byChannel: {} },
		formal: false,
		errors: [],
	};
}

const BLOCK = /```gate[ \t]*\r?\n([\s\S]*?)```/g;

function minOrNull(current: number | null | undefined, next: number): number {
	return current === null || current === undefined
		? next
		: Math.min(current, next);
}

function applyMaxChars(rules: GateRules, value: string): boolean {
	const match = value.match(/^(?:([a-z][a-z_]*)=)?(\d{1,5})$/);
	if (!match) return false;
	const limit = Number(match[2]);
	if (match[1]) {
		rules.maxChars.byChannel[match[1]] = minOrNull(
			rules.maxChars.byChannel[match[1]],
			limit,
		);
	} else {
		rules.maxChars.all = minOrNull(rules.maxChars.all, limit);
	}
	return true;
}

export function parseGateBlocks(markdown: string, source: string): GateRules {
	const rules = emptyGateRules();
	for (const block of markdown.matchAll(BLOCK)) {
		for (const rawLine of block[1].split(/\r?\n/)) {
			const line = rawLine.replace(/\s+#.*$/, "").trim();
			if (!line || line.startsWith("#")) continue;
			const separator = line.indexOf(":");
			const key = separator === -1 ? "" : line.slice(0, separator).trim();
			const value = separator === -1 ? "" : line.slice(separator + 1).trim();

			if ((key === "veto" || key === "veto_literal") && value) {
				rules.vetos.push({
					phrase: value,
					literal: key === "veto_literal",
					source,
				});
				continue;
			}
			if (key === "max_chars" && applyMaxChars(rules, value)) continue;
			if (key === "formal" && (value === "true" || value === "false")) {
				rules.formal = rules.formal || value === "true";
				continue;
			}
			rules.errors.push(
				`${source}: directiva del gate no reconocida: "${line}"`,
			);
		}
	}
	return rules;
}

export function mergeGateRules(...all: GateRules[]): GateRules {
	const merged = emptyGateRules();
	for (const rules of all) {
		merged.vetos.push(...rules.vetos);
		merged.errors.push(...rules.errors);
		merged.formal = merged.formal || rules.formal;
		if (rules.maxChars.all !== null) {
			merged.maxChars.all = minOrNull(merged.maxChars.all, rules.maxChars.all);
		}
		for (const [channel, limit] of Object.entries(rules.maxChars.byChannel)) {
			merged.maxChars.byChannel[channel] = minOrNull(
				merged.maxChars.byChannel[channel],
				limit,
			);
		}
	}
	return merged;
}

const GAP = "[^.]{0,40}";

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileSegment(segment: string): string | null {
	const text = segment.trim();
	if (!text) return null;
	let pattern = "";
	let cursor = 0;
	for (const group of text.matchAll(/\(([^()]*)\)/g)) {
		const index = group.index ?? 0;
		const before = text.slice(cursor, index);
		if (/[()|]/.test(before)) return null;
		const options = group[1].split("|").map((option) => option.trim());
		if (options.some((option) => !option)) return null;
		pattern += `${escapeRegExp(before)}(?:${options.map(escapeRegExp).join("|")})`;
		cursor = index + group[0].length;
	}
	const tail = text.slice(cursor);
	if (/[()|]/.test(tail)) return null;
	return pattern + escapeRegExp(tail);
}

/** Expresión acotada (sin cuantificadores anidados) o null si la frase está mal formada.
 * Acepta como máximo un hueco " ... " (dos segmentos) para evitar backtracking catastrófico. */
export function compileVeto(veto: GateVeto): RegExp | null {
	const phrase = normalizeText(veto.phrase).replace(/\s+/g, " ").trim();
	if (!phrase || phrase.length > 200) return null;
	if (veto.literal) return new RegExp(escapeRegExp(phrase), "g");
	const segments = phrase.split(" ... ").map(compileSegment);
	if (segments.length > 2) return null;
	if (segments.some((segment) => segment === null)) return null;
	return new RegExp(`\\b${segments.join(GAP)}\\b`, "g");
}
