// TEMPORAL (spec 03 §13): se borra después de correr los spikes en producción.
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tokenForSubject } from "@/lib/connectors/auth";
import { runEtapa3Probes } from "@/lib/spikes/etapa-3";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GENERATE_TIMEOUT_MS = 15_000;

// Todas las respuestas (incluidas las de error) llevan no-store: es una ruta
// de diagnóstico con datos de sesión/tenant, no algo cacheable ni por el
// browser ni por un proxy intermedio.
function json(body: Record<string, unknown>, status: number) {
	return NextResponse.json(body, {
		status,
		headers: { "Cache-Control": "no-store" },
	});
}

async function generate(model: string) {
	const result = await generateText({
		model,
		maxOutputTokens: 200,
		maxRetries: 0,
		abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
		output: Output.object({
			schema: z.object({
				categoria: z.enum(["no_interesado", "en_conversacion"]),
				resumen: z.string(),
			}),
		}),
		prompt:
			'Clasificá esta respuesta a un mail comercial: "Gracias, por ahora no nos interesa."',
	});
	return { output: result.output, usage: result.usage };
}

export async function GET(request: Request) {
	if (process.env.SPIKE_ETAPA3 !== "1") {
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
	const hubspotWriteRequested = url.searchParams.get("hubspot_write") === "1";

	// GET con efecto (hubspot_write) desde un request cross-site es un CSRF:
	// las cookies de Supabase son sameSite=lax, así que una navegación
	// cross-site (ej. un <img>/<a> en otro sitio) igual manda la sesión.
	// Sec-Fetch-Site solo vale "none" (URL tipeada a mano / bookmark) o
	// "same-origin" (fetch/link desde esta misma app); cualquier otro valor
	// (o su ausencia, en un browser viejo) corre la ruta sin escribir.
	const secFetchSite = request.headers.get("sec-fetch-site");
	const crossSite =
		hubspotWriteRequested &&
		secFetchSite !== "none" &&
		secFetchSite !== "same-origin";
	const hubspotWrite = hubspotWriteRequested && !crossSite;

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
	// app/api/invitations/route.ts).
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

	const steps = await runEtapa3Probes(
		{
			tenantId: tenant.id,
			userId: auth.user.id,
			issuer,
			hubspotWrite,
		},
		{
			tokenForSubject,
			fetch,
			generate,
			now: () => Date.now(),
		},
	);

	if (crossSite) {
		steps.push({
			step: "s6.omitido",
			ok: false,
			detail: `hubspot_write ignorado: abrí la URL escribiéndola en la barra (Sec-Fetch-Site: ${secFetchSite ?? "ausente"})`,
		});
	}

	return json({ tenant: slug, user_id: auth.user.id, issuer, steps }, 200);
}
