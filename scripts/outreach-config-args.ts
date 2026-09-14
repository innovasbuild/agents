export interface OutreachConfigArgs {
	tenant: string;
	apply: boolean;
}

export function parseOutreachConfigArgs(argv: string[]): OutreachConfigArgs {
	const index = argv.indexOf("--tenant");
	const tenant = index === -1 ? null : argv[index + 1];
	if (!tenant || tenant.startsWith("--"))
		throw new Error("falta --tenant <slug>");
	if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
		throw new Error(`slug de tenant inválido: "${tenant}"`);
	return { tenant, apply: argv.includes("--apply") };
}
