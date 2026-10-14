"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { domainDeps } from "@/lib/domains/runtime";
import {
	addDomain,
	type DomainDeps,
	type DomainResult,
	removeDomain,
	setPrimaryDomain,
	verifyDomain,
} from "@/lib/domains/service";
import { requirePlatformAdmin } from "@/lib/tenants/platform";

// guid y no uuid: el seed local usa ids que no son v4.
const idSchema = z.guid();

const SIN_PERMISO: DomainResult = { ok: false, message: "No tenés permiso." };
const INVALIDO: DomainResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};

function done(slug: string, result: DomainResult): DomainResult {
	revalidatePath("/plataforma");
	revalidatePath(`/plataforma/${slug}`);
	return result;
}

/**
 * El dominio tiene que ser de la empresa de la página: el id viaja desde el
 * cliente y sin esto una acción de una empresa podría tocar el de otra.
 */
async function ownedBy(
	deps: DomainDeps,
	tenantId: string,
	domainId: string,
): Promise<boolean> {
	const row = await deps.store.get(domainId);
	return row !== null && row.tenantId === tenantId;
}

// Solo plataforma: cargar un dominio consume cuota del proyecto de Vercel y
// toca la configuración de Auth (spec 21.6 H10). El gate se repite en cada
// acción: ocultar el botón no alcanza, una server action se puede llamar sola.
async function run(
	slug: string,
	tenantId: string,
	domainId: string | null,
	fn: (deps: DomainDeps, userId: string) => Promise<DomainResult>,
): Promise<DomainResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (domainId !== null && !idSchema.safeParse(domainId).success) {
		return INVALIDO;
	}
	try {
		const deps = domainDeps();
		if (domainId !== null && !(await ownedBy(deps, tenantId, domainId))) {
			return done(slug, { ok: false, message: "No existe ese dominio." });
		}
		return done(slug, await fn(deps, admin.userId));
	} catch (error) {
		console.error("consola dominios:", error);
		return { ok: false, message: "No se pudo completar. Probá de nuevo." };
	}
}

export async function addTenantDomain(
	slug: string,
	tenantId: string,
	hostname: string,
): Promise<DomainResult> {
	return run(slug, tenantId, null, (deps, userId) =>
		addDomain(deps, {
			tenantId,
			rawHostname: hostname,
			actorUserId: userId,
		}),
	);
}

export async function verifyTenantDomain(
	slug: string,
	tenantId: string,
	domainId: string,
): Promise<DomainResult> {
	return run(slug, tenantId, domainId, (deps) => verifyDomain(deps, domainId));
}

export async function makeTenantDomainPrimary(
	slug: string,
	tenantId: string,
	domainId: string,
): Promise<DomainResult> {
	return run(slug, tenantId, domainId, (deps) =>
		setPrimaryDomain(deps, domainId),
	);
}

export async function removeTenantDomain(
	slug: string,
	tenantId: string,
	domainId: string,
): Promise<DomainResult> {
	return run(slug, tenantId, domainId, (deps) => removeDomain(deps, domainId));
}
