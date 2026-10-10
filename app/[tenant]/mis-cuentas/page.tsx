import { notFound } from "next/navigation";
import {
	type AccountKey,
	type AccountState,
	accountsFor,
	probeAccount,
} from "@/lib/accounts/status";
import {
	isConnectAuthError,
	isConnectorNotInstalledError,
	tokenForSubject,
} from "@/lib/connectors/auth";
import { resolveCrmOwnerId } from "@/lib/connectors/crm/owner";
import { markCrmOwner, markGmailAuthorized } from "@/lib/connectors/executors";
import {
	GOOGLE_CONNECTOR_UID,
	HUBSPOT_CONNECTOR_UID,
} from "@/lib/connectors/platform";
import { GMAIL_SCOPES } from "@/lib/gmail/send";
import { connectSubjectIssuer } from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";
import { createServerSupabase } from "@/lib/supabase/server";
import { AccountCard } from "./account-card";

const OWNER_NOTE =
	"No pude leer tu usuario de HubSpot. Avisale a un administrador.";

export default async function MisCuentasPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const session = await webSession(slug);
	if (!session) notFound();
	const { caller } = session;

	const supabase = await createServerSupabase();
	const [connectionsResult, executorResult] = await Promise.all([
		supabase
			.from("tenant_connections")
			.select("capability, provider, enabled")
			.eq("tenant_id", caller.tenantId),
		supabase
			.from("executors")
			.select("user_id, gmail_authorized_at, crm_owner_id")
			.eq("tenant_id", caller.tenantId)
			.eq("user_id", caller.userId)
			.maybeSingle(),
	]);
	if (connectionsResult.error || executorResult.error) {
		console.error(
			"mis-cuentas: no pude leer la configuración:",
			connectionsResult.error ?? executorResult.error,
		);
		return (
			<div className="max-w-3xl space-y-4">
				<h1 className="text-3xl leading-tight">Mis cuentas</h1>
				<p className="text-muted-foreground text-sm">
					No pude leer tus cuentas. Recargá la página.
				</p>
			</div>
		);
	}

	const executor = executorResult.data as {
		gmail_authorized_at: string | null;
		crm_owner_id: string | null;
	} | null;
	const accounts = accountsFor({
		connections: (connectionsResult.data ?? []) as {
			capability: string;
			provider: string;
			enabled: boolean;
		}[],
		isExecutor: Boolean(executor),
	});

	const subject = {
		tenantId: caller.tenantId,
		userId: caller.userId,
		issuer: connectSubjectIssuer(),
	};
	// Pedir un token no modifica nada. Acá NUNCA se llama a
	// startAuthorizationForSubject: eso es solo por el clic (actions.ts).
	// Solo se conserva el token de HubSpot (para buscar al dueño); el de Gmail
	// se descarta apenas termina el sondeo.
	let hubspotToken: string | undefined;
	const states = new Map<AccountKey, AccountState>();
	await Promise.all(
		accounts.map(async (key) => {
			const state = await probeAccount(key, {
				token: async (account) => {
					const { token } = await tokenForSubject(
						account === "gmail" ? GOOGLE_CONNECTOR_UID : HUBSPOT_CONNECTOR_UID,
						subject,
						account === "gmail" ? [...GMAIL_SCOPES] : undefined,
					);
					if (account === "hubspot") hubspotToken = token;
				},
				isAuthError: isConnectAuthError,
				isNotInstalled: isConnectorNotInstalledError,
			});
			states.set(key, state);
		}),
	);

	// Reconciliación: solo ejecutores, solo con la cuenta autorizada. Nada de
	// esto puede romper la página.
	let hubspotNote: string | undefined;
	if (executor) {
		if (states.get("gmail") === "autorizada" && !executor.gmail_authorized_at) {
			try {
				await markGmailAuthorized(caller.tenantId, caller.userId);
			} catch (error) {
				console.error("mis-cuentas: no pude sellar Gmail:", error);
			}
		}
		if (
			states.get("hubspot") === "autorizada" &&
			!executor.crm_owner_id &&
			hubspotToken
		) {
			try {
				const ownerId = await resolveCrmOwnerId(hubspotToken, caller.email);
				if (ownerId)
					await markCrmOwner(caller.tenantId, caller.userId, ownerId);
				else hubspotNote = OWNER_NOTE;
			} catch (error) {
				console.error(
					"mis-cuentas: no pude guardar el dueño de HubSpot:",
					error instanceof Error ? error.message : "error",
				);
				hubspotNote = OWNER_NOTE;
			}
		}
	}

	return (
		<div className="max-w-3xl space-y-6">
			<div>
				<h1 className="mb-2 text-3xl leading-tight">Mis cuentas</h1>
				<p className="text-muted-foreground text-sm">
					Autorizá tus cuentas para que el agente pueda trabajar a tu nombre.
					Solo vos podés autorizar las tuyas.
				</p>
			</div>
			{accounts.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay cuentas para autorizar en esta empresa.
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{accounts.map((key) => (
						<AccountCard
							account={key}
							key={key}
							note={key === "hubspot" ? hubspotNote : undefined}
							slug={slug}
							state={states.get(key) ?? "desconocido"}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
