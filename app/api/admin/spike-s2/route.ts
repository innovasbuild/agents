// TEMPORAL (spec 03 §13, spike S2): se borra después de correr el spike en
// producción.
import { NextResponse } from "next/server";
import { tokenForSubject } from "@/lib/connectors/auth";
import {
	type ProbeStep,
	type QueueItemRef,
	runS2Probes,
} from "@/lib/spikes/s2";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Hasta 6 llamadas externas (2 tokens + tokeninfo + 2 listados gmail + 1
// metadata) de 10s cada una.
export const maxDuration = 60;

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
		const { data } = await admin
			.from("queue_items")
			.select("id, contact_id")
			.eq("tenant_id", params.tenantId)
			.eq("id", params.queueItemId)
			.maybeSingle();
		return data ? { id: data.id, contactId: data.contact_id } : null;
	}
	const { data } = await admin
		.from("queue_items")
		.select("id, contact_id")
		.eq("tenant_id", params.tenantId)
		.eq("executor_user_id", params.executorUserId)
		.eq("status", "sent")
		.order("sent_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	return data ? { id: data.id, contactId: data.contact_id } : null;
}

async function getContactEmail(
	admin: ReturnType<typeof createAdminClient>,
	tenantId: string,
	contactId: string,
): Promise<string | null> {
	const { data } = await admin
		.from("contacts")
		.select("email")
		.eq("tenant_id", tenantId)
		.eq("id", contactId)
		.maybeSingle();
	return data?.email ?? null;
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

	// La RLS ya limita lo que este usuario ve: si no es admin del tenant, no
	// hay fila y el pedido sigue solo si es platform_admin (igual que en
	// app/api/invitations/route.ts y en la ruta vieja de spikes etapa 3).
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

	const steps: ProbeStep[] = await runS2Probes(
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
			getContactEmail: (tenantId, contactId) =>
				getContactEmail(admin, tenantId, contactId),
		},
	);

	return json({ tenant: slug, user_id: auth.user.id, issuer, steps }, 200);
}
