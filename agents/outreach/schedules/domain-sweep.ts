// Barrido de dominios propios que esperan DNS (spec 21.6 §4.8). Cada 10
// minutos revisa los dominios en `verifying` y activa los que el cliente ya
// configuró, sin que nadie tenga que abrir la consola. Es de plataforma y no de
// outreach: vive acá porque este es el único agente con schedules desplegados.
// Toda la lógica está en lib/domains/service.ts (con dependencias inyectadas y
// testeada); acá solo se arman las reales.
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que crm-sync.ts).
import { defineSchedule } from "eve/schedules";
import { domainDeps } from "../../../lib/domains/runtime";
import { sweepVerifyingDomains } from "../../../lib/domains/service";

export default defineSchedule({
	cron: "*/10 * * * *",
	async run() {
		const deps = domainDeps();
		// Sin las dos APIs no hay nada que activar: no es un error, es una
		// plataforma que todavía no usa dominios propios.
		if (!deps.vercel || !deps.redirects) return;
		const { checked, activated } = await sweepVerifyingDomains(deps);
		if (checked > 0) {
			console.log(`domain-sweep: ${checked} revisados, ${activated} activados`);
		}
	},
});
