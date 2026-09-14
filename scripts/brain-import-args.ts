export interface ImportArgs {
	tenant: string;
	from: string;
	apply: boolean;
	force: string[];
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseImportArgs(argv: string[]): ImportArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");

	const from = flag(argv, "from");
	if (!from) throw new Error("falta --from <carpeta de la bóveda>");

	const force: string[] = [];
	argv.forEach((arg, index) => {
		if (arg !== "--force") return;
		const value = argv[index + 1];
		if (!value || value.startsWith("--"))
			throw new Error("--force necesita un slug");
		force.push(value);
	});

	return { tenant, from, apply: argv.includes("--apply"), force };
}
