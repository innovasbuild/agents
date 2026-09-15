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

async function generate(model: string) {
	const result = await generateText({
		model,
		maxOutputTokens: 200,
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
		return NextResponse.json({ error: "no encontrado" }, { status: 404 });
	}

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) {
		return NextResponse.json({ error: "no autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const slug = url.searchParams.get("tenant");
	if (!slug) {
		return NextResponse.json(
			{ error: "falta el parámetro tenant" },
			{ status: 400 },
		);
	}
	const hubspotWrite = url.searchParams.get("hubspot_write") === "1";

	const admin = createAdminClient();
	const { data: tenant } = await admin
		.from("tenants")
		.select("id, slug")
		.eq("slug", slug)
		.maybeSingle();

	if (!tenant) {
		return NextResponse.json({ error: "tenant inexistente" }, { status: 404 });
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
		return NextResponse.json({ error: "sin permiso" }, { status: 403 });
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

	return NextResponse.json(
		{ tenant: slug, user_id: auth.user.id, issuer, steps },
		{ status: 200, headers: { "Cache-Control": "no-store" } },
	);
}
