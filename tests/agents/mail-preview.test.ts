import { describe, expect, it } from "vitest";
import { isEmailApproval, queuePreviewItems } from "@/lib/agents/mail-preview";

describe("isEmailApproval", () => {
	it("con destinatario, asunto y cuerpo es un mail", () => {
		expect(
			isEmailApproval({
				to: "diego@rivara.com.ar",
				subject: "Asunto",
				body: "Hola",
				queueItemId: "q1",
			}),
		).toBe(true);
	});

	it("una nota del CRM o una página del brain no se firman", () => {
		expect(
			isEmailApproval({ contactKey: "em:diego@rivara.com.ar", note: "Llamé" }),
		).toBe(false);
		expect(
			isEmailApproval({ slug: "comercial/icp", title: "ICP", body: "Texto" }),
		).toBe(false);
	});
});

describe("queuePreviewItems", () => {
	const item = {
		letter: "A",
		queueItemId: "q1",
		to: "diego@rivara.com.ar",
		subject: "79 silos",
		body: "Un gusto entrar en contacto, Diego.",
		trabada: false,
		gate: "ok",
	};

	it("devuelve las piezas con letra, destinatario, asunto y cuerpo", () => {
		expect(queuePreviewItems({ ok: true, items: [item] })).toEqual([item]);
	});

	it("marca la pieza trabada", () => {
		const [parsed] = queuePreviewItems({
			ok: true,
			items: [{ ...item, trabada: true }],
		});
		expect(parsed.trabada).toBe(true);
	});

	it("descarta lo que no tenga letra, asunto o cuerpo, y tolera basura", () => {
		expect(
			queuePreviewItems({
				items: [{ ...item, body: "" }, { ...item, letter: null }, 7, null],
			}),
		).toEqual([]);
		expect(queuePreviewItems(null)).toEqual([]);
		expect(queuePreviewItems({ ok: false })).toEqual([]);
	});
});
