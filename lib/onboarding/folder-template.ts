// Plantilla genérica de carpetas del brain y normalización de la propuesta del
// modelo (spec etapa 27 §5.2). Puro. Imports relativos: lo usan módulos de eve.
import { RESERVED_TOP_FOLDERS } from "../brain/core/folders";
import type { FolderProposal } from "./services/propose-folders";

type Folders = FolderProposal["folders"];

export const GENERIC_FOLDERS: Folders = [
	{
		slug: "direccion",
		name: "Dirección",
		description: "Estrategia, objetivos, decisiones y actas de la dirección.",
		restricted: true,
	},
	{
		slug: "finanzas",
		name: "Finanzas",
		description: "Presupuestos, resultados, facturación, cobranzas y costos.",
		restricted: true,
	},
	{
		slug: "comercial",
		name: "Comercial",
		description: "Clientes, propuestas, precios y seguimiento de ventas.",
		restricted: false,
	},
	{
		slug: "operacion",
		name: "Operación",
		description: "Procesos internos, proveedores y el día a día del trabajo.",
		restricted: false,
	},
	{
		slug: "marketing",
		name: "Marketing",
		description: "Posicionamiento, mensajes, canales y contenido.",
		restricted: false,
	},
	{
		slug: "talento",
		name: "Talento",
		description: "Equipo, búsquedas, onboarding y cultura.",
		restricted: false,
	},
	{
		slug: "tecnologia",
		name: "Tecnología",
		description: "Sistemas, herramientas y accesos que usa la empresa.",
		restricted: false,
	},
	{
		slug: "proyectos",
		name: "Proyectos",
		description: "Proyectos concretos, activos y cerrados.",
		restricted: false,
	},
];

const MAX_FOLDERS = 10;
// Siempre restringidas: lo que el modelo diga no las abre.
const ALWAYS_RESTRICTED = ["direccion", "finanzas"];

export function normalizeProposal(p: FolderProposal): FolderProposal {
	const reserved: readonly string[] = RESERVED_TOP_FOLDERS;
	const seen = new Set<string>();
	const folders: Folders = [];
	for (const f of p.folders) {
		if (reserved.includes(f.slug) || seen.has(f.slug)) continue;
		seen.add(f.slug);
		folders.push(
			ALWAYS_RESTRICTED.includes(f.slug) ? { ...f, restricted: true } : f,
		);
	}
	for (const slug of ALWAYS_RESTRICTED) {
		if (seen.has(slug)) continue;
		const generic = GENERIC_FOLDERS.find((g) => g.slug === slug);
		if (generic) folders.unshift({ ...generic });
	}
	// Recorta de atrás para adelante sin tocar las restringidas obligatorias.
	for (
		let i = folders.length - 1;
		i >= 0 && folders.length > MAX_FOLDERS;
		i--
	) {
		if (!ALWAYS_RESTRICTED.includes(folders[i].slug)) folders.splice(i, 1);
	}
	return { ...p, folders };
}
