import type { CSSProperties } from "react";
import type { TenantBrand } from "@/lib/tenants/resolve";

const LIGHT = "#FFFFFF";
const DARK = "#0A0A0A";

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Luminancia relativa (WCAG 2.1). El color primario lo carga el cliente, así
 * que el texto encima no se puede elegir a mano: se deriva.
 */
export function foregroundFor(hex: string): typeof LIGHT | typeof DARK {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);

	if ([r, g, b].some(Number.isNaN)) return DARK;

	const luminance =
		0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

	return luminance > 0.45 ? DARK : LIGHT;
}

export function brandStyle(brand: TenantBrand): CSSProperties {
	const style: Record<string, string> = {};

	if (brand.primary) {
		style["--primary"] = brand.primary;
		style["--primary-foreground"] = foregroundFor(brand.primary);
	}
	if (brand.secondary) {
		style["--secondary"] = brand.secondary;
		style["--secondary-foreground"] = foregroundFor(brand.secondary);
	}

	return style as CSSProperties;
}
