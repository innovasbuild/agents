// Origen con el que sale un link que la plataforma manda EN NOMBRE de una
// empresa (spec 21.6 H9): el dominio principal activo de esa empresa y, si no
// tiene, el origen de siempre. Una persona de plataforma que invita desde el
// host raíz genera un link al dominio de la empresa, que es el que la persona
// invitada tiene que ver.
//
// No sirve para el link mágico del login: ese lo pide la persona desde el host
// donde está, y tiene que volver a ese mismo host (el verificador PKCE vive en
// sus cookies), así que ahí el origen es el del request.
import { createAdminClient } from "../supabase/admin";
import type { DomainStore } from "./service";
import { supabaseDomainStore } from "./store";

export async function invitationOriginFrom(
	store: Pick<DomainStore, "list">,
	tenantId: string,
	fallback: string,
): Promise<string> {
	try {
		const active = (await store.list(tenantId)).filter(
			(domain) =>
				domain.status === "active" && !domain.hostname.endsWith(".localhost"),
		);
		const chosen = active.find((domain) => domain.isPrimary) ?? active[0];
		return chosen ? `https://${chosen.hostname}` : fallback;
	} catch (error) {
		// Una invitación no se frena por esto: sale con el origen de siempre.
		console.error("dominios: no pude leer el dominio para el link:", error);
		return fallback;
	}
}

export function invitationOrigin(
	tenantId: string,
	fallback: string,
): Promise<string> {
	return invitationOriginFrom(
		supabaseDomainStore(createAdminClient()),
		tenantId,
		fallback,
	);
}
