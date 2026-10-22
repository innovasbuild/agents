// Vencimiento del plan Free (spec 27.1 §3). Una vez por día, a las 06:15 UTC,
// suspende (`trial_vencido`) las empresas gratis cuyo trial_ends_at ya pasó.
// Es de plataforma y no de outreach: vive acá porque este es el único agente
// con schedules desplegados. Toda la lógica está en lib/plans/trial.ts (con
// dependencias inyectadas y testeada); acá solo se arman las reales.
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que domain-sweep.ts).
import { defineSchedule } from "eve/schedules";
import { trialDeps } from "../../../lib/plans/runtime";
import { expireTrials } from "../../../lib/plans/trial";

export default defineSchedule({
	cron: "15 6 * * *",
	async run() {
		const { checked, suspended } = await expireTrials(trialDeps());
		if (checked > 0) {
			console.log(
				`trial-expiry: ${checked} revisados, ${suspended} suspendidos`,
			);
		}
	},
});
