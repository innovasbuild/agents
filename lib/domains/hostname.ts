// Validación de un dominio que una empresa quiere usar (spec 21.6 §4.1). Es la
// misma forma que el check de tenant_domains_hostname_format más lo que depende
// del entorno y no se puede poner en SQL: no se puede reclamar un host de la
// plataforma, un *.vercel.app ni un subdominio del dominio de INNOV.AS.
import { isRootHost, normalizeHost, type RootHosts } from "../tenants/host";

const FORMAT =
	/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export type HostnameCheck =
	| { ok: true; hostname: string }
	| { ok: false; message: string };

const INVALIDO: HostnameCheck = {
	ok: false,
	message:
		"No parece un dominio válido. Usá un subdominio completo, por ejemplo ai.tuempresa.com.",
};

export function validateTenantHostname(
	raw: string,
	ctx: { roots: RootHosts; production: boolean },
): HostnameCheck {
	// normalizeHost descarta el puerto (lo lee de headers); acá uno escrito es un
	// error de quien carga el dominio.
	if (raw.includes(":")) return INVALIDO;
	const hostname = normalizeHost(raw);
	if (!hostname || !FORMAT.test(hostname)) return INVALIDO;

	if (isRootHost(hostname, ctx.roots)) {
		return { ok: false, message: "Ese dominio es de la plataforma." };
	}
	// Un subdominio del dominio padre del host raíz (hoy .innov.as) es de INNOV.AS.
	for (const root of ctx.roots.hosts) {
		const parent = root.split(".").slice(1).join(".");
		if (parent.includes(".") && hostname.endsWith(`.${parent}`)) {
			return {
				ok: false,
				message: `No se puede usar un subdominio de ${parent}.`,
			};
		}
	}
	if (hostname.endsWith(".localhost") && ctx.production) {
		return {
			ok: false,
			message: "Un dominio .localhost solo se usa para probar en local.",
		};
	}
	return { ok: true, hostname };
}
