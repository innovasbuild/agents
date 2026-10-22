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
				| "domain_taken"
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
	domain_taken: "Tu empresa ya está en Central IA.",
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
	domain_taken: "domain_taken",
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

	let created: { id: string; slug: string };
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.rpc("self_serve_create_tenant", {
			p_display_name: displayName,
			p_domain: domain,
		});
		if (error) {
			const code = HINT_CODES[error.hint ?? ""];
			if (code) return fail(code);
			console.error("self_serve_create_tenant failed", error);
			return fail("generic");
		}
		const row = data as { id?: unknown; slug?: unknown } | null;
		if (typeof row?.id !== "string" || typeof row?.slug !== "string") {
			console.error("self_serve_create_tenant: respuesta inesperada", data);
			return fail("generic");
		}
		created = { id: row.id, slug: row.slug };

		const { data: tenant, error: modelError } = await createAdminClient()
			.from("tenants")
			.select("default_model")
			.eq("id", created.id)
			.single();
		if (modelError || !tenant) {
			console.error("lectura de default_model falló", modelError);
			return fail("generic");
		}

		const input = {
			tenantId: created.id,
			domain,
			displayName,
			hint: null,
			model: tenant.default_model,
		};
		after(async () => {
			try {
				await runFolderResearch(input, folderResearchDeps(created.id));
			} catch (error) {
				console.error("runFolderResearch falló", error);
			}
		});
	} catch (error) {
		console.error("createCompany failed", error);
		return fail("generic");
	}

	// Fuera del try: redirect() tira y un catch lo taparía.
	redirect(stepPath(created.slug, "carpetas"));
}
