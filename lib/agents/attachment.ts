// Cómo se rotula un adjunto en el chat. Pura: la tarjeta le pasa lo que sabe
// del archivo (el File del compositor o la parte `file` que devuelve eve).

export type AttachmentKind = "sheet" | "document";

const SHEET_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "ods"]);

function extensionOf(filename: string | undefined): string {
	const dot = filename?.lastIndexOf(".") ?? -1;
	if (!filename || dot < 0 || dot === filename.length - 1) return "";
	return filename.slice(dot + 1).toLowerCase();
}

export function attachmentKind(
	filename: string | undefined,
	mediaType: string | undefined,
): AttachmentKind {
	if (SHEET_EXTENSIONS.has(extensionOf(filename))) return "sheet";
	if (mediaType?.includes("spreadsheet") || mediaType === "text/csv")
		return "sheet";
	return "document";
}

/** "PDF", "CSV"… la extensión en mayúsculas; sin extensión, "Archivo". */
export function attachmentTypeLabel(filename: string | undefined): string {
	return extensionOf(filename).toUpperCase() || "Archivo";
}

export function formatAttachmentSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Segunda línea de la tarjeta: "CSV · 12 KB", o solo el tipo si no hay tamaño. */
export function attachmentMeta(
	filename: string | undefined,
	size: number | undefined,
): string {
	const type = attachmentTypeLabel(filename);
	return size === undefined ? type : `${type} · ${formatAttachmentSize(size)}`;
}

/**
 * Mientras eve no confirmó el turno, el mensaje del usuario es el resumen
 * aplanado que arma el cliente: el texto con una línea `[file: nombre]` (o
 * `[file]`) por adjunto. Separa esas líneas del texto para poder mostrar las
 * tarjetas antes de que lleguen las partes `file` reales.
 */
export function splitFileMarkers(summary: string): {
	text: string;
	filenames: (string | undefined)[];
} {
	const filenames: (string | undefined)[] = [];
	const kept: string[] = [];
	for (const line of summary.split("\n")) {
		const match = /^\[file(?:: (.+))?\]$/.exec(line);
		if (match) filenames.push(match[1]);
		else kept.push(line);
	}
	return { text: kept.join("\n").trim(), filenames };
}
