// TEMPORAL (spec 03 §13, spike S2): se borra después de correr el spike en
// producción.
import { NextResponse } from "next/server";
import {
	startAuthorizationForSubject,
	tokenForSubject,
} from "@/lib/connectors/auth";
import {
	type ProbeStep,
	type QueueItemRef,
	runS2AuthorizeStep,
	runS2Probes,
} from "@/lib/spikes/s2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Peor caso: 7 llamadas externas serializadas de 8s (lib/spikes/s2.ts) más
// las consultas a la base. Con margen generoso porque acá SÍ importa que
// lleguen todos los pasos: si Vercel corta la función a mitad de camino, no
// vuelve ningún paso (se sirven todos juntos al final).
export const maxDuration = 120;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Todas las respuestas (incluidas las de error) llevan no-store: es una ruta
// de diagnóstico con datos de sesión/tenant, no algo cacheable ni por el
// browser ni por un proxy intermedio.
function json(body: Record<string, unknown>, status: number) {
	return NextResponse.json(body, {
		status,
		headers: { "Cache-Control": "no-store" },
	});
}

async function findQueueItem(
	admin: ReturnType<typeof createAdminClient>,
	params: { tenantId: string; executorUserId: string; queueItemId?: string },
): Promise<QueueItemRef | null> {
	if (params.queueItemId) {
		const { data, error } = await admin
			.from("queue_items")
			.select("id, executor_user_id, to_email, gmail_message_id")
			.eq("tenant_id", params.tenantId)
			.eq("id", params.queueItemId)
			.maybeSingle();
		if (error) {
			throw new Error(`error consultando queue_items: ${error.message}`);
		}
		if (!data) return null;
		if (data.executor_user_id !== params.executorUserId) {
			throw new Error(
				"esa pieza la mandó otro ejecutor: corré el spike con la sesión de esa persona",
			);
		}
		return {
			id: data.id,
			toEmail: data.to_email,
			gmailMessageId: data.gmail_message_id,
		};
	}
	const { data, error } = await admin
		.from("queue_items")
		.select("id, to_email, gmail_message_id")
		.eq("tenant_id", params.tenantId)
		.eq("executor_user_id", params.executorUserId)
		.eq("status", "sent")
		.order("sent_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) {
		throw new Error(`error consultando queue_items: ${error.message}`);
	}
	return data
		? {
				id: data.id,
				toEmail: data.to_email,
				gmailMessageId: data.gmail_message_id,
			}
		: null;
}

export async function GET(request: Request) {
	if (process.env.SPIKE_S2 !== "1") {
		return json({ error: "no encontrado" }, 404);
	}

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) {
		return json({ error: "no autenticado" }, 401);
	}

	const url = new URL(request.url);
	const slug = url.searchParams.get("tenant");
	if (!slug) {
		return json({ error: "falta el parámetro tenant" }, 400);
	}
	const queueItemParam = url.searchParams.get("queue_item");
	if (queueItemParam && !UUID_RE.test(queueItemParam)) {
		return json({ error: "queue_item inválido: tiene que ser un uuid" }, 400);
	}
	const authorizeRequested = url.searchParams.get("authorize") === "1";

	// authorize=1 arranca una autorización OAuth (efecto): un GET con efecto
	// desde un request cross-site es un CSRF, porque las cookies de Supabase
	// son sameSite=lax y una navegación cross-site (ej. un <img>/<a> en otro
	// sitio) igual manda la sesión. Sec-Fetch-Site solo vale "none" (URL
	// tipeada a mano / bookmark) o "same-origin" (fetch/link desde esta misma
	// app); cualquier otro valor (o su ausencia, en un browser viejo) ignora
	// el parámetro (mismo criterio que la ruta vieja de spikes etapa 3 para
	// hubspot_write).
	const secFetchSite = request.headers.get("sec-fetch-site");
	const crossSite =
		authorizeRequested &&
		secFetchSite !== "none" &&
		secFetchSite !== "same-origin";
	const authorize = authorizeRequested && !crossSite;

	// Todo lo que sigue puede tirar (cliente admin mal configurado, una
	// consulta que falla): sin este try, ese 500 se escaparía del helper
	// json() y saldría sin Cache-Control: no-store.
	try {
		const admin = createAdminClient();
		const { data: tenant } = await admin
			.from("tenants")
			.select("id, slug")
			.eq("slug", slug)
			.maybeSingle();

		if (!tenant) {
			// 403 y no 404: el slug de un tenant no es un oráculo de existencia
			// para quien no tiene permiso ahí.
			return json({ error: "sin permiso" }, 403);
		}

		// La RLS ya limita lo que este usuario ve: si no es admin del tenant,
		// no hay fila y el pedido sigue solo si es platform_admin (igual que
		// en app/api/invitations/route.ts y en la ruta vieja de spikes
		// etapa 3).
		const { data: membership } = await supabase
			.from("memberships")
			.select("role")
			.eq("tenant_id", tenant.id)
			.eq("user_id", auth.user.id)
			.in("role", ["tenant_admin", "platform_admin"])
			.maybeSingle();

		const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

		if (!membership && !isPlatformAdmin) {
			return json({ error: "sin permiso" }, 403);
		}

		const issuer = process.env.NEXT_PUBLIC_SUPABASE_URL!;

		// s2.authorize va antes de los pasos normales: si hace falta el link
		// de consentimiento, mejor tenerlo arriba de todo en vez de después de
		// 7 llamadas externas.
		const steps: ProbeStep[] = [];
		const authorizeStep = await runS2AuthorizeStep(
			{ tenantId: tenant.id, userId: auth.user.id, issuer, authorize },
			{ startAuthorizationForSubject },
		);
		if (authorizeStep) {
			steps.push(authorizeStep);
		} else if (crossSite) {
			steps.push({
				step: "s2.authorize",
				ok: false,
				detail: `authorize ignorado: abrí la URL escribiéndola en la barra (Sec-Fetch-Site: ${secFetchSite ?? "ausente"})`,
			});
		}

		steps.push(
			...(await runS2Probes(
				{
					tenantId: tenant.id,
					userId: auth.user.id,
					issuer,
					callerEmail: auth.user.email ?? "",
					queueItemId: queueItemParam ?? undefined,
				},
				{
					tokenForSubject,
					fetch,
					findQueueItem: (params) => findQueueItem(admin, params),
				},
			)),
		);

		return json({ tenant: slug, user_id: auth.user.id, issuer, steps }, 200);
	} catch (error) {
		const detail =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);
		return json({ error: "error interno", detail: detail.slice(0, 300) }, 500);
	}
}
