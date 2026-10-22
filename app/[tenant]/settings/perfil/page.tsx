import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { type AuthMethod, isAuthMethod } from "@/lib/tenants/auth-methods";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { sessionLoginMethod } from "@/lib/tenants/session-method";
import { PerfilForm } from "./perfil-form";

export default async function PerfilPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	// 404 y no 403, como el resto de settings.
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();
	const { data, error } = await supabase
		.from("tenants")
		.select("auth_methods")
		.eq("id", tenant.id)
		.maybeSingle();
	if (error) console.error("perfil: no pude leer auth_methods:", error);

	const methods = ((data?.auth_methods as string[] | undefined) ?? []).filter(
		isAuthMethod,
	);
	// Plataforma puede sacar cualquier método; el resto no el de su sesión.
	let currentMethod: AuthMethod | null = null;
	if (tenant.role !== "platform_admin") {
		const current = await sessionLoginMethod(supabase);
		currentMethod = current && isAuthMethod(current) ? current : null;
		if (currentMethod && !methods.includes(currentMethod))
			methods.push(currentMethod);
	}

	const logoUrl = tenant.brand.logoUrl
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${tenant.brand.logoUrl}`
		: null;

	return (
		<div className="max-w-3xl space-y-8">
			<div>
				<Link
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
					href={`/${slug}/settings`}
				>
					← Configuración
				</Link>
				<h1 className="text-3xl leading-tight">Perfil de la empresa</h1>
			</div>
			{error ? (
				<p className="text-muted-foreground text-sm" role="alert">
					No pude leer las formas de entrar. Recargá la página.
				</p>
			) : null}
			<PerfilForm
				currentMethod={currentMethod}
				displayName={tenant.displayName}
				logoUrl={logoUrl}
				methods={methods}
				primary={tenant.brand.primary ?? ""}
				secondary={tenant.brand.secondary ?? ""}
				slug={slug}
			/>
		</div>
	);
}
