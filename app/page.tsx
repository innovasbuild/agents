import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

// El cliente Supabase no está tipado contra database.types.ts (Task 7 no lo
// generó todavía), así que el query builder no puede ver que memberships →
// tenants es many-to-one y modela el embed como array. En runtime PostgREST
// siempre devuelve un objeto acá (memberships.tenant_id es FK simple), por
// eso pisamos el tipo con `.returns()` en vez de tratar `tenants` como lista.
interface MembershipWithTenant {
	role: string;
	tenants: { slug: string; display_name: string } | null;
}

export default async function HomePage() {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();

	if (!auth.user) redirect("/login");

	// user_id explícito, no solo lo que la RLS deja pasar: memberships_select
	// también expone TODAS las filas del tenant a un tenant_admin, y TODAS las
	// filas de la base a un platform_admin (para que puedan administrar
	// usuarios en /settings/usuarios). Sin este filtro, esta pantalla — "a qué
	// tenant quiero entrar yo" — le mostraría a un admin una fila por cada
	// miembro de sus tenants, con tenants repetidos.
	const { data: memberships } = await supabase
		.from("memberships")
		.select("role, tenants (slug, display_name)")
		.eq("user_id", auth.user.id)
		.order("created_at")
		.returns<MembershipWithTenant[]>();

	const tenants = (memberships ?? []).flatMap((m) =>
		m.tenants ? [m.tenants] : [],
	);

	if (tenants.length === 0) redirect("/sin-acceso");
	if (tenants.length === 1) redirect(`/${tenants[0].slug}/chat`);

	return (
		<main className="p-6">
			<h1 className="mb-4 font-semibold text-xl">Elegí un cliente</h1>
			<ul className="space-y-2">
				{tenants.map((tenant) => (
					<li key={tenant.slug}>
						<Link className="underline" href={`/${tenant.slug}/chat`}>
							{tenant.display_name}
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
