import { ChevronDownIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { InviteDialog } from "@/components/plan/invite-dialog";
import { TenantBanner } from "@/components/plan/tenant-banner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brandStyle } from "@/lib/brand/contrast";
import { stepPath } from "@/lib/onboarding/steps";
import { tenantMetadata } from "@/lib/tenants/brand-metadata";
import { loadEnabledAgents } from "@/lib/tenants/enabled-agents";
import { visibleNav } from "@/lib/tenants/nav";
import {
	prefetchEnabledAgentsWithAccess,
	resolveTenantAccess,
} from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { UserMenu } from "./user-menu";

function brandLogoUrl(path: string | undefined): string | null {
	return path
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${path}`
		: null;
}

// resolveTenantAccess está en cache: el layout lo reusa sin otra consulta.
export async function generateMetadata({
	params,
}: {
	params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
	prefetchEnabledAgentsWithAccess();
	const tenant = await resolveTenantAccess((await params).tenant);
	if (!tenant) return {};
	return tenantMetadata({
		displayName: tenant.displayName,
		logoUrl: brandLogoUrl(tenant.brand.logoUrl),
	});
}

export default async function TenantLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	// Antes de resolver: así la lista de agentes arranca junto con el chequeo
	// de acceso y no detrás (ver resolve.ts).
	prefetchEnabledAgentsWithAccess();
	const tenant = await resolveTenantAccess(slug);

	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();
	// Alta a medias: quien administra vuelve al paso que le falta. La
	// plataforma y los miembros no se redirigen.
	if (tenant.role === "tenant_admin" && tenant.onboardingStep !== null) {
		redirect(stepPath(slug, tenant.onboardingStep));
	}
	const enabledAgents = await loadEnabledAgents(tenant.id);

	const logoUrl = brandLogoUrl(tenant.brand.logoUrl);

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
						// min-w-0 + truncate deja que un displayName largo se corte en vez
						// de desbordar; el tope de ancho le deja lugar a la nav, que es la
						// que se lleva el espacio sobrante (flex-1).
						<span className="min-w-0 max-w-[40%] shrink-0 truncate font-semibold tracking-display">
							{tenant.displayName}
						</span>
					)}
					{/* La nav comparte fila con el logo. Si no entra (375px), la tira
					    scrollea sola: min-w-0 + flex-1 la dejan angostarse sin empujar
					    el menú de usuario fuera del header. */}
					<nav className="min-w-0 flex-1 overflow-x-auto md:pl-4">
						<ul className="flex items-center gap-5 whitespace-nowrap text-sm">
							{visibleNav(tenant.role, enabledAgents).map((item) =>
								"items" in item ? (
									<li key={item.label}>
										<DropdownMenu>
											<DropdownMenuTrigger className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
												{item.label}
												<ChevronDownIcon aria-hidden className="size-4" />
											</DropdownMenuTrigger>
											<DropdownMenuContent className="min-w-40">
												{item.items.map((sub) => (
													<DropdownMenuItem
														asChild
														className="py-2"
														key={sub.href}
													>
														<Link href={`/${slug}${sub.href}`}>
															{sub.label}
														</Link>
													</DropdownMenuItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									</li>
								) : (
									<li key={item.href}>
										<Link
											className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
											href={`/${slug}${item.href}`}
										>
											{item.label}
										</Link>
									</li>
								),
							)}
						</ul>
					</nav>
					{tenant.role === "tenant_admin" ? (
						<div className="shrink-0">
							<InviteDialog slug={slug} tenantId={tenant.id} />
						</div>
					) : null}
					<div className="shrink-0">
						<UserMenu
							slug={slug}
							email={tenant.email}
							roleLabel={ROLE_LABELS[tenant.role]}
							isPlatformAdmin={tenant.role === "platform_admin"}
						/>
					</div>
				</div>
			</header>
			<TenantBanner
				isAdmin={tenant.role === "tenant_admin"}
				plan={tenant.plan}
				slug={slug}
				suspendedReason={tenant.suspendedReason}
				trialEndsAt={tenant.trialEndsAt}
			/>
			<main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
				{children}
			</main>
		</div>
	);
}
