import type { ActionResult } from "./actions";

export type Feedback = { ok: boolean; text: string } | null;

/**
 * Corre una acción de una fila y dice qué mostrar. Sin React: se prueba en node.
 * - Si pide confirmación y la persona no confirma, no corre nada (ran: false).
 * - Una excepción se convierte en un error mostrable; nunca se propaga.
 * - `refresh` se pide solo cuando salió bien.
 * - `failed` es verdadero si no salió bien (error de la acción o excepción).
 */
export async function runRowAction(params: {
	run: () => Promise<ActionResult>;
	confirmText?: string;
	confirm: (text: string) => boolean;
	refresh: () => void;
}): Promise<{ ran: boolean; failed: boolean; feedback: Feedback }> {
	const { run, confirmText, confirm, refresh } = params;
	if (confirmText && !confirm(confirmText)) {
		return { ran: false, failed: false, feedback: null };
	}
	try {
		const result = await run();
		if (!result.ok) {
			return {
				ran: true,
				failed: true,
				feedback: { ok: false, text: result.message },
			};
		}
		refresh();
		return {
			ran: true,
			failed: false,
			feedback: result.message ? { ok: true, text: result.message } : null,
		};
	} catch {
		return {
			ran: true,
			failed: true,
			feedback: { ok: false, text: "No se pudo completar. Probá de nuevo." },
		};
	}
}
