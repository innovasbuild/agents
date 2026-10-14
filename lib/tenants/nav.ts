// Entradas del menú del tenant y qué ve cada rol. Vive fuera del layout para
// poder probarlo sin renderizar la página.
import type { CatalogAgent } from "../agents/catalog";
import { hasChatAgent } from "./home";
import type { TenantRole } from "./resolve";

export type NavLink = {
	href: string;
	label: string;
	adminOnly?: boolean;
	/** Agente que tiene que estar habilitado para que la entrada exista. */
	agent?: CatalogAgent;
	/** La entrada existe si hay algún agente de chat habilitado. */
	chat?: true;
};
// Una entrada con `items` es un desplegable: agrupa destinos de un mismo
// dominio para que la tira no ponga todo al mismo nivel.
export type NavEntry = NavLink | { label: string; items: NavLink[] };

export const NAV: NavEntry[] = [
	{ href: "/chat", label: "Chat", chat: true },
	{
		label: "Outreach",
		items: [
			{ href: "/cola", label: "Cola", agent: "outreach" },
			{ href: "/pipeline", label: "Pipeline", agent: "outreach" },
			{ href: "/contactos", label: "Contactos", agent: "outreach" },
			{ href: "/cuentas", label: "Cuentas", agent: "outreach" },
			{ href: "/focos", label: "Focos", agent: "outreach" },
		],
	},
	{ href: "/brain", label: "Brain" },
	{ href: "/metricas", label: "Métricas", agent: "outreach" },
	{ href: "/conectar", label: "Conectar" },
	{ href: "/mis-cuentas", label: "Mis cuentas", agent: "outreach" },
	// /settings hace notFound() para tenant_member: el link no se muestra,
	// no tiene sentido ofrecer una ruta que va a 404.
	{ href: "/settings", label: "Configuración", adminOnly: true },
];

/** `enabledAgents` en null (no se pudo leer) no oculta nada. */
export function visibleNav(
	role: TenantRole,
	enabledAgents: readonly string[] | null,
): NavEntry[] {
	const show = (link: NavLink) =>
		(!link.adminOnly || role !== "tenant_member") &&
		(!link.agent ||
			enabledAgents === null ||
			enabledAgents.includes(link.agent)) &&
		(!link.chat || enabledAgents === null || hasChatAgent(enabledAgents));

	return NAV.flatMap((entry): NavEntry[] => {
		if (!("items" in entry)) return show(entry) ? [entry] : [];
		const items = entry.items.filter(show);
		return items.length > 0 ? [{ ...entry, items }] : [];
	});
}
