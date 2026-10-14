import type { Metadata } from "next";

/**
 * Title y favicon de las pantallas de una empresa: "<empresa> - Central IA" y
 * su logo. Sin logo no se pisa nada: queda el ícono de INNOV.AS del root.
 */
export function tenantMetadata(tenant: {
	displayName: string;
	logoUrl: string | null;
}): Metadata {
	return {
		title: `${tenant.displayName} - Central IA`,
		...(tenant.logoUrl ? { icons: { icon: tenant.logoUrl } } : {}),
	};
}
