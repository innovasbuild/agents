// CSV de carga de contactos (spec 03 §6.4 import_contacts). Encabezado
// obligatorio; columnas desconocidas se ignoran.
import { normalizeEmail } from "./contact-key";
import { domainFromEmail, normalizeDomain } from "./domain";

export const MAX_CSV_ROWS = 50;
const COLUMNS = [
	"name",
	"email",
	"linkedin_url",
	"company",
	"domain",
	"segment",
	"vector",
] as const;

export interface CsvContactRow {
	line: number;
	name: string | null;
	email: string | null;
	linkedinUrl: string | null;
	company: string | null;
	domain: string | null;
	segment: string | null;
	vector: string | null;
}

function splitLine(line: string): string[] | null {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quoted) {
			if (char === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			cells.push(cell);
			cell = "";
		} else {
			cell += char;
		}
	}
	if (quoted) return null;
	cells.push(cell);
	return cells;
}

const clean = (value: string | undefined): string | null => {
	const trimmed = (value ?? "").trim();
	return trimmed ? trimmed : null;
};

const MAX_EMAIL_LENGTH = 320;

export function parseContactsCsv(text: string): {
	rows: CsvContactRow[];
	errors: Array<{ line: number; reason: string }>;
} {
	const lines = text.split(/\r?\n/);
	const header = (splitLine(lines[0] ?? "") ?? []).map((h) =>
		h.trim().toLowerCase(),
	);
	const index = Object.fromEntries(
		COLUMNS.map((column) => [column, header.indexOf(column)]),
	) as Record<(typeof COLUMNS)[number], number>;
	if (COLUMNS.every((column) => index[column] === -1)) {
		const semicolonHeader = (lines[0] ?? "")
			.split(";")
			.map((h) => h.trim().toLowerCase());
		const usesSemicolon = COLUMNS.some((column) =>
			semicolonHeader.includes(column),
		);
		return {
			rows: [],
			errors: [
				{
					line: 1,
					reason: usesSemicolon
						? "el CSV usa ';' como separador: exportalo con comas"
						: `el encabezado no tiene ninguna columna conocida (${COLUMNS.join(", ")})`,
				},
			],
		};
	}
	const body = lines
		.slice(1)
		.map((line, i) => ({ line: i + 2, text: line }))
		.filter((l) => l.text.trim());
	if (body.length > MAX_CSV_ROWS) {
		return {
			rows: [],
			errors: [
				{
					line: 1,
					reason: `el CSV tiene ${body.length} filas; el máximo por carga es ${MAX_CSV_ROWS}`,
				},
			],
		};
	}

	const rows: CsvContactRow[] = [];
	const errors: Array<{ line: number; reason: string }> = [];
	for (const { line, text: raw } of body) {
		const cells = splitLine(raw);
		if (!cells) {
			errors.push({ line, reason: "comillas sin cerrar" });
			continue;
		}
		const get = (column: (typeof COLUMNS)[number]) =>
			index[column] === -1 ? null : clean(cells[index[column]]);
		const rawEmail = get("email");
		const emailTooLong = (rawEmail?.length ?? 0) > MAX_EMAIL_LENGTH;
		// Una celda de más de 320 caracteres nunca es un email válido: se
		// descarta sin correr la regex y se reporta recortada.
		const email = rawEmail && !emailTooLong ? normalizeEmail(rawEmail) : null;
		if (rawEmail && !email) {
			const shown = emailTooLong ? `${rawEmail.slice(0, 40)}…` : rawEmail;
			errors.push({ line, reason: `email inválido: "${shown}"` });
		}
		rows.push({
			line,
			name: get("name"),
			email,
			linkedinUrl: get("linkedin_url"),
			company: get("company"),
			domain:
				normalizeDomain(get("domain")) ??
				(email ? domainFromEmail(email) : null),
			segment: get("segment"),
			vector: get("vector"),
		});
	}
	return { rows, errors };
}
