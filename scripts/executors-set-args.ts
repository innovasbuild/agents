export interface ExecutorsSetArgs {
	tenant: string;
	email: string;
	slug: string;
	crmOwnerId: string | null;
	displayName: string | null;
	title: string | null;
	linkedinUrl: string | null;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseExecutorsSetArgs(argv: string[]): ExecutorsSetArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");
	const rawEmail = flag(argv, "email");
	if (!rawEmail) throw new Error("falta --email <email del usuario>");
	const email = rawEmail.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new Error(`email inválido: "${rawEmail}"`);
	const slug = flag(argv, "slug");
	if (!slug) throw new Error("falta --slug <slug del ejecutor>");
	if (!/^[a-z][a-z0-9-]{0,30}$/.test(slug))
		throw new Error(`slug de ejecutor inválido: "${slug}"`);
	const linkedinUrl = flag(argv, "linkedin-url");
	if (
		linkedinUrl &&
		!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/.+/.test(linkedinUrl)
	)
		throw new Error(`linkedin-url inválida: "${linkedinUrl}"`);
	return {
		tenant,
		email,
		slug,
		crmOwnerId: flag(argv, "crm-owner-id"),
		displayName: flag(argv, "display-name"),
		title: flag(argv, "title"),
		linkedinUrl,
	};
}
