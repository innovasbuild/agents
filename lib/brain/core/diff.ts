// Diff de revisiones del brain (spec editor §6.1). LCS de líneas: las páginas
// pesan hasta 200 KB, del orden de miles de líneas, y se compara de a dos.

export type DiffBlock = {
	kind: "equal" | "added" | "removed";
	lines: string[];
};

function splitLines(text: string): string[] {
	return text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(a: string, b: string): DiffBlock[] {
	const x = splitLines(a);
	const y = splitLines(b);
	const n = x.length;
	const m = y.length;
	// lcs[i][j]: largo de la subsecuencia común más larga de x[i..] y y[j..].
	const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			lcs[i][j] =
				x[i] === y[j]
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);

	const blocks: DiffBlock[] = [];
	const push = (kind: DiffBlock["kind"], line: string) => {
		const last = blocks.at(-1);
		if (last?.kind === kind) last.lines.push(line);
		else blocks.push({ kind, lines: [line] });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) {
			push("equal", x[i]);
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("removed", x[i++]);
		else push("added", y[j++]);
	}
	while (i < n) push("removed", x[i++]);
	while (j < m) push("added", y[j++]);
	return blocks;
}

export interface MetaSnapshot {
	title: string;
	category: string;
	status: string;
	tags: string[];
}

export interface MetaChange {
	field: "title" | "category" | "status";
	from: string;
	to: string;
}

export function diffMeta(a: MetaSnapshot, b: MetaSnapshot) {
	const changes: MetaChange[] = [];
	for (const field of ["title", "category", "status"] as const)
		if (a[field] !== b[field])
			changes.push({ field, from: a[field], to: b[field] });
	return {
		changes,
		tagsAdded: b.tags.filter((t) => !a.tags.includes(t)),
		tagsRemoved: a.tags.filter((t) => !b.tags.includes(t)),
	};
}
