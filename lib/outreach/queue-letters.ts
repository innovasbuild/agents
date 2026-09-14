// Letras de la cola por letras del canon: A, B, …, Z, AA, AB…
function letter(index: number): string {
	let n = index + 1;
	let out = "";
	while (n > 0) {
		const rest = (n - 1) % 26;
		out = String.fromCharCode(65 + rest) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

export function assignLetters<T extends { created_at: string }>(
	items: T[],
): Array<T & { letter: string }> {
	return [...items]
		.sort((a, b) => a.created_at.localeCompare(b.created_at))
		.map((item, index) => ({ ...item, letter: letter(index) }));
}
