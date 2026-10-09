import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand/contrast";
import { domainsPhrase } from "@/lib/tenants/domains-phrase";
import { loadPublicTenant } from "@/lib/tenants/public";
import { LoginForm } from "../login-form";

export default async function TenantLoginPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await loadPublicTenant(slug);
	// Inexistente o inactiva: 404. Una activa sí se muestra (spec alta A4).
	if (!tenant) notFound();

	return (
		<main
			style={brandStyle(tenant.brand)}
			className="flex min-h-screen items-center justify-center bg-background px-4 py-16"
		>
			<div className="w-full max-w-sm space-y-8">
				<div className="space-y-3 text-center">
					{tenant.logoUrl ? (
						// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
						<img
							src={tenant.logoUrl}
							alt={tenant.displayName}
							className="mx-auto h-auto w-auto max-w-[200px]"
						/>
					) : (
						<h1 className="text-3xl leading-tight">{tenant.displayName}</h1>
					)}
					<p className="text-muted-foreground">
						{tenant.openDomains.length > 0
							? `Entrá con tu correo de ${domainsPhrase(tenant.openDomains)}. Si te invitaron con otro correo, usá ese.`
							: `Entrá con la cuenta con la que te invitaron a ${tenant.displayName}.`}
					</p>
				</div>
				<LoginForm methods={tenant.authMethods} next={`/${tenant.slug}/chat`} />
			</div>
		</main>
	);
}
