import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { brandStyle } from "@/lib/brand/contrast";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

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
			<header className="flex items-center gap-3 border-b px-6 py-3">
				{logoUrl ? (
					// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
					<img src={logoUrl} alt={tenant.displayName} className="h-8 w-auto" />
				) : (
					<span className="font-semibold">{tenant.displayName}</span>
				)}
				<span className="text-muted-foreground text-sm">{tenant.role}</span>
			</header>
			<main className="p-6">{children}</main>
		</div>
	);
}
