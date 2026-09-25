const LABELS: Record<string, string> = {
	openid: "Saber quién sos",
	email: "Ver tu mail",
	profile: "Ver tu nombre y tu foto",
	phone: "Ver tu teléfono",
};

export function describeScopes(scope: string): string[] {
	const unique = [...new Set(scope.split(/\s+/).filter(Boolean))];
	return unique.map((item) => LABELS[item] ?? item);
}
