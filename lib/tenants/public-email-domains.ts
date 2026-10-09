/**
 * Correos que cualquiera puede tener: un dominio de esta lista no puede abrir
 * el ingreso sin invitación (spec ingreso por dominio, D8). Es una red contra
 * el error humano, no una verificación de que el dominio sea de la empresa.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"yahoo.com",
	"yahoo.com.ar",
	"icloud.com",
	"me.com",
	"proton.me",
	"protonmail.com",
	"aol.com",
	"gmx.com",
	"zoho.com",
	"yandex.com",
	"fibertel.com.ar",
	"arnet.com.ar",
	"speedy.com.ar",
];

export function isPublicEmailDomain(domain: string): boolean {
	return PUBLIC_EMAIL_DOMAINS.includes(
		domain.trim().toLowerCase().replace(/^@/, ""),
	);
}
