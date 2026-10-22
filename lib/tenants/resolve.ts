import { redirect } from "next/navigation";
import { cache } from "react";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import type { Plan, SuspendedReason } from "@/lib/plans/limits";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadEnabledAgents } from "@/lib/tenants/enabled-agents";
import { allowsLogin, methodLanding } from "@/lib/tenants/login-check";
import {
	platformOwnerAdminTenantId,
	platformOwnerSlug,
} from "@/lib/tenants/platform";

export type TenantRole = "platform_admin" | "tenant_admin" | "tenant_member";

export interface TenantBrand {
	primary?: string;
	secondary?: string;
	logoUrl?: string;
}

export interface TenantRow {
	id: string;
	slug: string;
	display_name: string;
	default_model: string;
	allowed_models: string[];
	brand: Record<string, unknown>;
	plan: Plan;
	suspended_reason: SuspendedReason | null;
	trial_ends_at: string | null;
	onboarding_step: OnboardingStep | null;
}

export interface TenantAccess {
	id: string;
	slug: string;
	displayName: string;
	role: TenantRole;
	userId: string;
	/** Del JWT; puede faltar (por ejemplo, un login por teléfono). */
	email?: string;
	defaultModel: string;
	allowedModels: string[];
	brand: TenantBrand;
	plan: Plan;
	suspendedReason: SuspendedReason | null;
	trialEndsAt: string | null;
	onboardingStep: OnboardingStep | null;
}

function readString(
	source: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function brandFromRow(row: Pick<TenantRow, "brand">): TenantBrand {
	const brand = row.brand ?? {};
	const primary = readString(brand, "primary");
	const secondary = readString(brand, "secondary");
	const logoUrl = readString(brand, "logo_url");

	return {
		...(primary ? { primary } : {}),
		...(secondary ? { secondary } : {}),
		...(logoUrl ? { logoUrl } : {}),
	};
}

// Pedido del layout, por request: su menú necesita los agentes habilitados, y
// la lista solo depende del id del tenant, no de que el acceso se resuelva. Con
// el pedido en pie, resolveTenantAccess dispara la lectura apenas conoce el id
// y no recién cuando termina de chequear membresía y método. Las acciones y
// los route handlers no lo piden, así que no pagan una consulta que no usan.
const layoutRequest = cache(() => ({ enabledAgents: false }));

/** Lo llama el layout antes de resolver el acceso; sin llamarla no cambia nada. */
export function prefetchEnabledAgentsWithAccess(): void {
	layoutRequest().enabledAgents = true;
}

/**
 * Traduce un slug de la URL a tenant y rol del usuario logueado. Devuelve
 * `null` si no hay sesión, si el slug no existe o si el usuario no es
 * miembro: quien llama responde 404, nunca 403, porque un 403 confirma que
 * el cliente existe. Si la persona tiene acceso pero entró por un método que
 * la empresa no permite, redirige a la landing de esa empresa. El layout y la
 * página la llaman por separado: `cache` la resuelve una vez por request.
 */
export const resolveTenantAccess = cache(
	async (slug: string): Promise<TenantAccess | null> => {
		const supabase = await createServerSupabase();

		// La identidad sale de los claims: se verifica la firma contra el JWKS
		// (ES256) sin viajar a Auth. proxy.ts ya hizo getUser en esta navegación
		// (revocación y refresco), así que acá no se repite. El tenant no
		// depende de la persona (la RLS lo filtra igual), por eso va en paralelo.
		const [{ data: claimsData }, { data: tenant }] = await Promise.all([
			supabase.auth.getClaims(),
			supabase
				.from("tenants")
				.select(
					"id, slug, display_name, default_model, allowed_models, brand, plan, suspended_reason, trial_ends_at, onboarding_step",
				)
				.eq("slug", slug)
				.eq("active", true)
				.maybeSingle(),
		]);
		const userId = claimsData?.claims?.sub;
		const email = claimsData?.claims?.email;
		if (!userId || !tenant) return null;

		// Solo calienta el cache de loadEnabledAgents, que no rechaza (devuelve
		// null si falla). El acceso se decide más abajo igual que sin esto: si
		// falla o redirige, el resultado de la lectura se descarta. La RLS la
		// filtra con la sesión de la persona, así que un no miembro no ve nada.
		if (layoutRequest().enabledAgents) void loadEnabledAgents(tenant.id);

		// Independientes entre sí: cada una es un viaje a la base.
		const [{ data: membership }, ownerTenantId] = await Promise.all([
			supabase
				.from("memberships")
				.select("role")
				.eq("tenant_id", tenant.id)
				.eq("user_id", userId)
				.maybeSingle(),
			platformOwnerAdminTenantId(supabase, userId),
		]);

		// El platform_admin del tenant dueño entra a cualquier tenant aunque no
		// tenga membership ahí, y siempre gana sobre el rol local, igual que en la
		// RLS. Si se resolviera al revés, uno que además tuviera una membership
		// local (tenant_member, por ejemplo) se vería degradado en la UI aunque la
		// base le siga dando acceso completo.
		const platformAdmin = ownerTenantId !== null;

		// Una fila platform_admin fuera del tenant dueño no es rol de plataforma
		// para la aplicación (spec consola §3): acá vale como admin de ese tenant.
		const localRole =
			membership?.role === "platform_admin" ? "tenant_admin" : membership?.role;

		const role = (platformAdmin ? "platform_admin" : localRole) as
			| TenantRole
			| undefined;
		if (!role) return null;

		// El método con el que se abrió la sesión tiene que estar permitido (spec
		// etapa 20, L10). Un administrador de plataforma se chequea contra su
		// propia empresa, el tenant dueño, no contra la que visita (L12). La
		// sesión no se cierra: puede valer para otra empresa de la misma persona.
		if (!(await allowsLogin(supabase, ownerTenantId ?? tenant.id))) {
			redirect(
				methodLanding(
					platformAdmin ? (platformOwnerSlug() ?? tenant.slug) : tenant.slug,
				),
			);
		}

		return {
			id: tenant.id,
			slug: tenant.slug,
			displayName: tenant.display_name,
			role,
			userId,
			...(typeof email === "string" && email ? { email } : {}),
			defaultModel: tenant.default_model,
			allowedModels: tenant.allowed_models,
			brand: brandFromRow(tenant as TenantRow),
			plan: tenant.plan as Plan,
			suspendedReason: tenant.suspended_reason as SuspendedReason | null,
			trialEndsAt: tenant.trial_ends_at,
			onboardingStep: tenant.onboarding_step as OnboardingStep | null,
		};
	},
);
