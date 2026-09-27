import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "../types";

/** Slug de página a partir del catch-all de la URL; null si no es válido (→ 404). */
export function slugFromParams(segments: string[] | undefined): string | null {
	if (!segments || segments.length === 0) return null;
	let slug: string;
	try {
		slug = segments.map((s) => decodeURIComponent(s)).join("/");
	} catch {
		return null;
	}
	return slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
		? slug
		: null;
}

export function pageHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/p/${pageSlug}`;
}

export function editHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/editar/${pageSlug}`;
}

export function historyHref(tenantSlug: string, pageSlug: string): string {
	return `/${tenantSlug}/brain/historial/${pageSlug}`;
}
