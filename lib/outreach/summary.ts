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
	deps: {
		store: OutreachStore;
		now: () => Date;
		/** ¿El tenant tiene brain? Es una consulta a las conexiones, no una
		 * lectura del canon: leer el canon entero acá costaría una decena de
		 * consultas al brain en cada apertura de sesión. Con esto el ejecutor ve
		 * al abrir el caso más común de "canon ausente"; el de brain conectado
		 * pero sin páginas `canon:*` lo sigue avisando la negativa de la tool. */
		brainConnected: () => Promise<boolean>;
	},
): Promise<string> {
	const header = `Trabajás para ${input.tenantName} (tenant \`${input.tenantSlug}\`). Todo lo que hagas es en nombre de ese cliente y con sus datos.`;
	const [executor, tenant] = await Promise.all([
		deps.store.loadExecutor(input.tenantId, input.userId),
		deps.store.loadTenantOutreach(input.tenantId),
	]);
	if (!executor?.slug || !tenant) {
		return `${header}\n\nQuien habla en esta sesión no es ejecutor de outreach en este tenant: puede consultar, pero no cargar contactos, encolar ni enviar. Si lo pide, explicáselo.`;
	}
	const [sent, items, brain] = await Promise.all([
		deps.store.countSent(input.tenantId, {
			since: dayStart(tenant.config.timezone, deps.now()),
			executorUserId: input.userId,
		}),
		// "approved" son piezas trabadas entre el claim de send_email y el envío
		// (spec: mismo criterio que listQueue en services/queue.ts): sin esto el
		// único estado que necesita revisión manual queda invisible en el resumen.
		deps.store.listQueue(input.tenantId, input.userId, ["pending", "approved"]),
		// Falla abierta: el aviso es contexto, el cupo y la cola no. Si la consulta
		// de conexiones se cae, el resumen sale igual sin el aviso.
		deps.brainConnected().catch(() => true),
	]);
	const pending = items.filter((item) => item.status === "pending");
	const trabadas = items.filter((item) => item.status === "approved");
	const remaining = Math.max(executor.dailyQuota - sent.count, 0);
	const pendingPhrase =
		pending.length === 1
			? "1 pieza pendiente"
			: `${pending.length} piezas pendientes`;
	const trabadaPhrase =
		trabadas.length === 1 ? "1 trabada" : `${trabadas.length} trabadas`;
	const queuePhrase =
		trabadas.length > 0 ? `${pendingPhrase} y ${trabadaPhrase}` : pendingPhrase;
	return [
		header,
		"",
		`Estado de hoy del ejecutor \`${executor.slug}\`: cupo de hoy: ${remaining} de ${executor.dailyQuota}; ${queuePhrase} en la cola; ${executor.gmailAuthorizedAt ? "Gmail autorizado" : "Gmail todavía no autorizado (se pide al primer envío)"}.`,
		brain
			? ""
			: "Este cliente no tiene el brain conectado: sin su canon no vas a poder redactar, encolar ni enviar. Decíselo a quien lo pida y que hable con quien administra el tenant.",
		trabadas.length > 0
			? "Hay piezas trabadas en la cola: revisá en Gmail si esos mails salieron antes de tocar nada."
			: "",
		pending.length + trabadas.length > 0
			? "Al arrancar, mostrá la cola por letras con list_queue."
			: "",
	]
		.filter(Boolean)
		.join("\n");
}
