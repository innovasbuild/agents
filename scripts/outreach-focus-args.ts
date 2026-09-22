export interface OutreachFocusArgs {
	tenant: string;
	owner: string;
	file: string;
	apply: boolean;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseFocusArgs(argv: string[]): OutreachFocusArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");
	if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
		throw new Error(`slug de tenant inválido: "${tenant}"`);

	const owner = flag(argv, "owner");
	if (!owner) throw new Error("falta --owner <slug>");

	const file = flag(argv, "file");
	if (!file) throw new Error("falta --file <ruta al JSON del foco>");

	return { tenant, owner, file, apply: argv.includes("--apply") };
}
