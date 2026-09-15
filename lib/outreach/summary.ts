// Resumen que entra en las instrucciones al abrir la sesión (spec 03 §6.1 y
// §8.5). En esta entrega: ejecutor, cupo y cola; respuestas y oportunidades
// frenadas llegan con la escucha (Entrega 4).
import type { OutreachStore } from "./store";
import { dayStart } from "./time";

export async function sessionSummary(
	input: {
		tenantId: string;
		userId: string;
		tenantName: string;
		tenantSlug: string;
	},
	deps: { store: OutreachStore; now: () => Date },
): Promise<string> {
	const header = `Trabajás para ${input.tenantName} (tenant \`${input.tenantSlug}\`). Todo lo que hagas es en nombre de ese cliente y con sus datos.`;
	const [executor, tenant] = await Promise.all([
		deps.store.loadExecutor(input.tenantId, input.userId),
		deps.store.loadTenantOutreach(input.tenantId),
	]);
	if (!executor?.slug || !tenant) {
		return `${header}\n\nQuien habla en esta sesión no es ejecutor de outreach en este tenant: puede consultar, pero no cargar contactos, encolar ni enviar. Si lo pide, explicáselo.`;
	}
	const [sent, pending] = await Promise.all([
		deps.store.countSent(input.tenantId, {
			since: dayStart(tenant.config.timezone, deps.now()),
			executorUserId: input.userId,
		}),
		deps.store.listQueue(input.tenantId, input.userId, ["pending"]),
	]);
	const remaining = Math.max(executor.dailyQuota - sent.count, 0);
	const pieces =
		pending.length === 1
			? "1 pieza pendiente"
			: `${pending.length} piezas pendientes`;
	return [
		header,
		"",
		`Estado de hoy del ejecutor \`${executor.slug}\`: cupo de hoy: ${remaining} de ${executor.dailyQuota}; ${pieces} en la cola; ${executor.gmailAuthorizedAt ? "Gmail autorizado" : "Gmail todavía no autorizado (se pide al primer envío)"}.`,
		pending.length > 0
			? "Al arrancar, mostrá la cola por letras con list_queue."
			: "",
	]
		.filter(Boolean)
		.join("\n");
}
