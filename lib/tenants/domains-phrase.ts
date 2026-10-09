/** "@a.com", "@a.com o @b.com", "@a.com, @b.com o @c.com". */
export function domainsPhrase(domains: string[]): string {
	const tagged = domains.map((domain) => `@${domain}`);
	if (tagged.length <= 1) return tagged.join("");
	return `${tagged.slice(0, -1).join(", ")} o ${tagged[tagged.length - 1]}`;
}
