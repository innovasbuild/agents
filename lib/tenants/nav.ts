// Entradas del menú del tenant y qué ve cada rol. Vive fuera del layout para
// poder probarlo sin renderizar la página.
import type { TenantRole } from "./resolve";

export type NavLink = { href: string; label: string; adminOnly?: boolean };
// Una entrada con `items` es un desplegable: agrupa destinos de un mismo
// dominio para que la tira no ponga todo al mismo nivel.
export type NavEntry = NavLink | { label: string; items: NavLink[] };

export const NAV: NavEntry[] = [
	{ href: "/chat", label: "Chat" },
	{
		label: "Outreach",
		items: [
			{ href: "/cola", label: "Cola" },
			{ href: "/pipeline", label: "Pipeline" },
			{ href: "/contactos", label: "Contactos" },
			{ href: "/cuentas", label: "Cuentas" },
			{ href: "/focos", label: "Focos" },
		],
	},
	{ href: "/brain", label: "Brain" },
	{ href: "/metricas", label: "Métricas" },
	{ href: "/conectar", label: "Conectar" },
	// /settings hace notFound() para tenant_member: el link no se muestra,
	// no tiene sentido ofrecer una ruta que va a 404.
	{ href: "/settings", label: "Configuración", adminOnly: true },
];

export function visibleNav(role: TenantRole): NavEntry[] {
	return NAV.filter(
		(item) => "items" in item || !item.adminOnly || role !== "tenant_member",
	);
}
