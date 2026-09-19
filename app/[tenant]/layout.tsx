import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { brandStyle } from "@/lib/brand/contrast";
import { resolveTenantAccess, type TenantRole } from "@/lib/tenants/resolve";

const NAV = [
	{ href: "/chat", label: "Chat" },
	{ href: "/cola", label: "Cola" },
	{ href: "/pipeline", label: "Pipeline" },
	{ href: "/contactos", label: "Contactos" },
] as const;

const ROLE_LABELS: Record<TenantRole, string> = {
	platform_admin: "Admin de plataforma",
	tenant_admin: "Admin",
	tenant_member: "Miembro",
};

export default async function TenantLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);

	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const logoUrl = tenant.brand.logoUrl
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${tenant.brand.logoUrl}`
		: null;

	return (
		<div
			style={brandStyle(tenant.brand)}
			className="min-h-screen bg-background"
		>
			<header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-6">
					{logoUrl ? (
						// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
						// h-auto + max-h-7 (no h-7 fijo) + max-w: con las dos en auto,
						// el navegador escala el logo para entrar en esa caja sin
						// deformarlo. h-7 fijo con solo un max-width lo achataba a
						// 28px sin importar cuánto se angostara. Sin esto, un logo
						// ancho desborda el header a 375px: es la única rama sin un
						// elemento flexible (el fix anterior cubrió solo la rama sin
						// logo, con min-w-0 flex-1 en el nombre).
						<img
							src={logoUrl}
							alt={tenant.displayName}
							className="h-auto max-h-7 w-auto max-w-[140px] shrink-0"
						/>
					) : (
						// min-w-0 + flex-1 es lo que deja truncar en vez de desbordar:
						// un flex item sin esto no se achica más allá de su contenido, y
						// un displayName largo empuja el badge y la nav fuera del header
						// a 375px (rompe a varias líneas). flex-1 le da el espacio
						// sobrante para que sea él, y no la nav, el que se angosta.
						<span className="min-w-0 flex-1 truncate font-semibold tracking-display">
							{tenant.displayName}
						</span>
					)}
					<span className="hidden shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-muted-foreground text-xs sm:inline-block">
						{ROLE_LABELS[tenant.role]}
					</span>
				</div>
				{/* La nav vive en su propia fila, no adentro del header: con cuatro
				    destinos ya no entraba junto al logo y el nombre a 375px, y las
				    entregas que vienen suman tres más. El scroll horizontal es de
				    esta tira, no de la página. */}
				<nav className="mx-auto max-w-[1200px] overflow-x-auto px-4 md:px-6">
					<ul className="flex items-center gap-5 whitespace-nowrap pb-2 text-sm">
						{NAV.map((item) => (
							<li key={item.href}>
								<Link
									className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
									href={`/${slug}${item.href}`}
								>
									{item.label}
								</Link>
							</li>
						))}
					</ul>
				</nav>
			</header>
			<main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
				{children}
			</main>
		</div>
	);
}
