// Respaldo del corte de crédito a mitad del hilo (R13 F4): si el turn.failed no
// trae el motivo ai_allowance:, el cliente le pregunta al servidor una sola vez.
import { describe, expect, it } from "vitest";
import {
	CHAT_BLOCK_CHECK_MIN_MS,
	lastFailedTurn,
	shouldCheckChatBlock,
} from "@/lib/plans/failed-turn";

const failed = (turnId: string, message: string) => ({
	type: "turn.failed",
	data: { code: "x", message, sequence: 1, turnId },
});
const completed = (turnId: string) => ({
	type: "turn.completed",
	data: { sequence: 1, turnId },
});

describe("lastFailedTurn", () => {
	it("sin eventos o con el último turno completo no hay nada", () => {
		expect(lastFailedTurn([])).toEqual({ kind: "none" });
		expect(lastFailedTurn([failed("t1", "boom"), completed("t2")])).toEqual({
			kind: "none",
		});
	});

	it("reconoce el motivo ai_allowance: del mensaje", () => {
		expect(
			lastFailedTurn([failed("t1", "Error: ai_allowance:limit:ai_credit")]),
		).toEqual({ kind: "limit", reason: "limit:ai_credit" });
	});

	it("un turn.failed sin motivo reconocible pide chequeo con su turnId", () => {
		expect(lastFailedTurn([failed("t1", "Internal error")])).toEqual({
			kind: "unknown",
			turnId: "t1",
		});
	});

	it("mira el último evento terminal", () => {
		expect(
			lastFailedTurn([
				failed("t1", "ai_allowance:limit:ai_credit"),
				{ type: "message.delta", data: {} },
				failed("t2", "redactado"),
			]),
		).toEqual({ kind: "unknown", turnId: "t2" });
	});
});

describe("shouldCheckChatBlock", () => {
	const unknown = { kind: "unknown" as const, turnId: "t2" };

	it("chequea un fallo nuevo", () => {
		expect(
			shouldCheckChatBlock(unknown, { turnId: null, at: 0 }, 1_000_000),
		).toBe(true);
	});

	it("no repite el chequeo para el mismo turno", () => {
		expect(
			shouldCheckChatBlock(unknown, { turnId: "t2", at: 0 }, 1_000_000),
		).toBe(false);
	});

	it("espera entre chequeos aunque cambie el turno", () => {
		const now = 1_000_000;
		expect(
			shouldCheckChatBlock(unknown, { turnId: "t1", at: now - 1_000 }, now),
		).toBe(false);
		expect(
			shouldCheckChatBlock(
				unknown,
				{ turnId: "t1", at: now - CHAT_BLOCK_CHECK_MIN_MS },
				now,
			),
		).toBe(true);
	});

	it("no chequea si no hay fallo o el motivo ya se conoce", () => {
		const last = { turnId: null, at: 0 };
		expect(shouldCheckChatBlock({ kind: "none" }, last, 1)).toBe(false);
		expect(
			shouldCheckChatBlock(
				{ kind: "limit", reason: "limit:ai_credit" },
				last,
				1,
			),
		).toBe(false);
	});
});
