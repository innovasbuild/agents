// Normalización compartida del gate y de contact_key: minúsculas y sin
// diacríticos, igual que normalizar() de gate.py.
export function stripAccents(text: string): string {
	return text.normalize("NFD").replace(/\p{Mn}/gu, "");
}

export function normalizeText(text: string): string {
	return stripAccents(text.toLowerCase());
}
