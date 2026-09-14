const FREE_MAIL = new Set([
	"gmail.com",
	"googlemail.com",
	"hotmail.com",
	"hotmail.com.ar",
	"outlook.com",
	"live.com",
	"live.com.ar",
	"yahoo.com",
	"yahoo.com.ar",
	"icloud.com",
	"me.com",
	"proton.me",
]);

export function normalizeDomain(raw: string | null | undefined): string | null {
	const value = (raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/^www\./, "")
		.split(/[/?#]/)[0];
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

export function domainFromEmail(email: string): string | null {
	const domain = normalizeDomain(email.split("@")[1]);
	return domain && !FREE_MAIL.has(domain) ? domain : null;
}
