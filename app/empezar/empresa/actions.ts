"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { folderResearchDeps } from "@/lib/onboarding/research-deps";
import { runFolderResearch } from "@/lib/onboarding/research-run";
import { stepPath } from "@/lib/onboarding/steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { isPublicEmailDomain } from "@/lib/tenants/public-email-domains";

export type CreateCompanyResult =
	| { ok: true; slug: string }
	| {
			ok: false;
			code:
				| "public_domain"
				| "domain_mismatch"
				| "login_method_unknown"
				| "invalid"
				| "brain_failed"
				| "generic";
			message: string;
	  };

type Failure = Extract<CreateCompanyResult, { ok: false }>;
type FailureCode = Failure["code"];

const MESSAGES: Record<FailureCode, string> = {
	public_domain:
		"Necesitás un correo de tu empresa para crear una cuenta. Con ese dominio no podemos armar tu espacio.",
	domain_mismatch: "El dominio tiene que ser el de tu correo.",
	login_method_unknown:
		"No pudimos confirmar con qué cuenta entraste. Cerrá sesión y volvé a entrar.",
	invalid: "Revisá los datos e intentá de nuevo.",
	brain_failed: "No pudimos armar tu brain. Probá de nuevo.",
	generic: "No pudimos crear tu empresa. Probá de nuevo en un rato.",
};

const fail = (code: FailureCode, message?: string): Failure => ({
	ok: false,
	code,
	message: message ?? MESSAGES[code],
});

const HINT_CODES: Record<string, FailureCode> = {
	public_domain: "public_domain",
	domain_mismatch: "domain_mismatch",
	login_method_unknown: "login_method_unknown",
	email_not_confirmed: "login_method_unknown",
	name_required: "invalid",
};

const DOMAIN =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const schema = z.object({
	displayName: z.string().trim().min(1).max(80),
	domain: z.string().trim().toLowerCase().regex(DOMAIN),
});

/**
 * Paso 2 del alta self-serve (spec 27 §5.1): crea la empresa con la sesión de
 * quien entra (la base valida dominio y método), deja el research de carpetas
 * corriendo de fondo y sigue al paso 3.
 */
export async function createCompany(
	formData: FormData,
): Promise<CreateCompanyResult> {
	const name = formData.get("display_name");
	const rawDomain = formData.get("domain");
	const parsed = schema.safeParse({
		displayName: typeof name === "string" ? name : "",
		domain:
			typeof rawDomain === "string" ? rawDomain.trim().replace(/^@/, "") : "",
	});
	if (!parsed.success) {
		const nameBad = parsed.error.issues.some(
			(i) => i.path[0] === "displayName",
		);
		return fail(
			"invalid",
			nameBad
				? "Escribí el nombre de tu empresa."
				: "Escribí un dominio válido, por ejemplo tuempresa.com.",
		);
	}
	const { displayName, domain } = parsed.data;
	if (isPublicEmailDomain(domain)) return fail("public_domain");

	let created: { id: string; slug: string } | null = null;
	let taken = false;
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.rpc("self_serve_create_tenant", {
			p_display_name: displayName,
			p_domain: domain,
		});
		if (error?.hint === "domain_taken") {
			// Segundo envío o segunda pestaña: "/" resuelve la membresía o el
			// aviso de dominio tomado. No es un error para la persona.
			taken = true;
		} else if (error) {
			if (error.code === "42501") return fail("login_method_unknown");
			const code = HINT_CODES[error.hint ?? ""];
			if (code) return fail(code);
			console.error("self_serve_create_tenant failed", error);
			return fail("generic");
		}
		if (!taken) {
			const row = data as { id?: unknown; slug?: unknown } | null;
			if (typeof row?.id !== "string" || typeof row?.slug !== "string") {
				console.error("self_serve_create_tenant: respuesta inesperada", data);
				return fail("generic");
			}
			created = { id: row.id, slug: row.slug };
		}
	} catch (error) {
		console.error("createCompany failed", error);
		return fail("generic");
	}

	// Fuera del try: redirect() tira y un catch lo taparía.
	if (taken || !created) redirect("/");

	// Desde acá la empresa existe: siempre se avanza. Si no se puede leer el
	// modelo no se agenda el research (la pantalla de carpetas lo trata como
	// "falta investigar").
	const tenantId = created.id;
	try {
		const { data: tenant, error: modelError } = await createAdminClient()
			.from("tenants")
			.select("default_model")
			.eq("id", tenantId)
			.single();
		if (modelError || !tenant) {
			console.error("lectura de default_model falló", tenantId, modelError);
		} else {
			const input = {
				tenantId,
				domain,
				displayName,
				hint: null,
				model: tenant.default_model,
			};
			after(async () => {
				try {
					await runFolderResearch(input, folderResearchDeps(tenantId));
				} catch (error) {
					console.error("runFolderResearch falló", error);
				}
			});
		}
	} catch (error) {
		console.error("no se pudo agendar el research", tenantId, error);
	}

	redirect(stepPath(created.slug, "carpetas"));
}
