import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { brandStyle } from "@/lib/brand/contrast";
import { resolveTenantAccess, type TenantRole } from "@/lib/tenants/resolve";

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
						<img
							src={logoUrl}
							alt={tenant.displayName}
							className="h-7 w-auto"
						/>
					) : (
						<span className="font-semibold tracking-display">
							{tenant.displayName}
						</span>
					)}
					<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
						{ROLE_LABELS[tenant.role]}
					</span>
				</div>
			</header>
			<main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
				{children}
			</main>
		</div>
	);
}
