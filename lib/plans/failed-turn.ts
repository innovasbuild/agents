// Corte de crédito a mitad del hilo, visto desde el cliente del chat. El hook
// de crédito tira con el motivo `ai_allowance:` y el turn.failed lo trae en el
// mensaje; si en producción ese texto llega tapado o envuelto, el cliente le
// pregunta al servidor (checkChatBlock) una sola vez por turno fallido.
import { allowanceReasonFrom } from "../agents/allowance-check";
import type { LimitReason } from "./limits";

export type FailedTurn =
	| { kind: "none" }
	| { kind: "limit"; reason: LimitReason }
	| { kind: "unknown"; turnId: string };

/** Entre dos chequeos al servidor, aunque fallen turnos distintos. */
export const CHAT_BLOCK_CHECK_MIN_MS = 10_000;

/** Lee el último evento terminal de turno: completo, fallido con motivo o sin él. */
export function lastFailedTurn(
	events: readonly { type: string; data?: unknown }[],
): FailedTurn {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event.type === "turn.completed") return { kind: "none" };
		if (event.type === "turn.failed") {
			const data = (event.data ?? {}) as {
				message?: unknown;
				turnId?: unknown;
			};
			const message = typeof data.message === "string" ? data.message : null;
			const reason = allowanceReasonFrom(message);
			if (reason) return { kind: "limit", reason };
			return {
				kind: "unknown",
				turnId: typeof data.turnId === "string" ? data.turnId : String(i),
			};
		}
	}
	return { kind: "none" };
}

/** Un fallo sin motivo se chequea una vez, y no más seguido que el mínimo. */
export function shouldCheckChatBlock(
	failed: FailedTurn,
	last: { turnId: string | null; at: number },
	now: number,
): failed is { kind: "unknown"; turnId: string } {
	return (
		failed.kind === "unknown" &&
		failed.turnId !== last.turnId &&
		now - last.at >= CHAT_BLOCK_CHECK_MIN_MS
	);
}
