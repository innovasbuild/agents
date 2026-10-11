import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { describeScopes } from "@/lib/auth/oauth-scopes";
import { createServerSupabase } from "@/lib/supabase/server";
import { consentLoginCheck } from "@/lib/tenants/login-check-server";
import { approveConsent, denyConsent } from "./actions";

function Frame({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-screen items-center justify-center px-4 py-16">
			<div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6">
				{children}
			</div>
		</main>
	);
}

export default async function ConsentPage({
	searchParams,
}: {
	searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
	const { authorization_id: authorizationId, error: failed } =
		await searchParams;

	if (!authorizationId) {
		return (
			<Frame>
				<h1 className="text-xl">Falta el pedido de autorización</h1>
				<p className="text-muted-foreground">
					Volvé a conectar desde tu herramienta.
				</p>
			</Frame>
		);
	}

	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) {
		const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
		redirect(`/login?next=${encodeURIComponent(next)}`);
	}

	// Va antes de leer el pedido: si la app ya tenía consentimiento, esa
	// lectura lo aprueba sola y devuelve la redirección con el código.
	const check = await consentLoginCheck(supabase, user.id);
	if (check === "no-tenants") {
		return (
			<Frame>
				<h1 className="text-xl">No podés conectar con esta sesión</h1>
				<p className="text-muted-foreground">
					Todavía no estás en ninguna empresa activa, así que no hay nada que
					conectar. Cuando te sumen a una, volvé a conectar desde tu
					herramienta.
				</p>
			</Frame>
		);
	}
	if (check !== "allowed") {
		return (
			<Frame>
				<h1 className="text-xl">No podés conectar con esta sesión</h1>
				<p className="text-muted-foreground">
					Entraste con un método que alguna de tus empresas no permite. Cerrá
					sesión, entrá con un método permitido y volvé a conectar desde tu
					herramienta.
				</p>
			</Frame>
		);
	}

	const { data, error } =
		await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
	if (error || !data) {
		return (
			<Frame>
				<h1 className="text-xl">El pedido venció o no es válido</h1>
				<p className="text-muted-foreground">
					Volvé a conectar desde tu herramienta.
				</p>
			</Frame>
		);
	}
	if ("redirect_url" in data) redirect(data.redirect_url);

	return (
		<Frame>
			<div className="space-y-2">
				<h1 className="text-xl">
					{data.client.name} quiere conectarse a tu cuenta
				</h1>
				<p className="text-muted-foreground text-sm">
					Entrás como {data.user.email}. Si lo permitís, esta app va a actuar
					como vos en la plataforma, con los mismos permisos que tenés: el brain
					y los datos de todos los clientes a los que tenés acceso. Permitilo
					solo si reconocés la app.
				</p>
			</div>
			<ul className="list-disc space-y-1 pl-5 text-sm">
				{describeScopes(data.scope).map((label) => (
					<li key={label}>{label}</li>
				))}
			</ul>
			<p className="text-muted-foreground text-xs">
				Vuelve a: {data.redirect_uri}
			</p>
			{failed ? (
				<p className="text-destructive text-sm">
					No se pudo registrar tu respuesta. Probá de nuevo.
				</p>
			) : null}
			<div className="flex gap-3">
				<form action={approveConsent}>
					<input
						name="authorization_id"
						type="hidden"
						value={authorizationId}
					/>
					<Button type="submit">Permitir</Button>
				</form>
				<form action={denyConsent}>
					<input
						name="authorization_id"
						type="hidden"
						value={authorizationId}
					/>
					<Button type="submit" variant="outline">
						No permitir
					</Button>
				</form>
			</div>
		</Frame>
	);
}
