import { describe, expect, it, vi } from "vitest";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";

const GENERICO = "No se pudo completar. Probá de nuevo.";

describe("runRowAction", () => {
	it("si la persona no confirma, no corre nada", async () => {
		const run = vi.fn(async () => ({ ok: true as const }));
		const refresh = vi.fn();
		const confirm = vi.fn(() => false);

		const out = await runRowAction({
			run,
			confirmText: "¿Seguro?",
			confirm,
			refresh,
		});

		expect(out).toEqual({ ran: false, failed: false, feedback: null });
		expect(confirm).toHaveBeenCalledWith("¿Seguro?");
		expect(run).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("si confirma, corre", async () => {
		const run = vi.fn(async () => ({ ok: true as const }));
		const out = await runRowAction({
			run,
			confirmText: "¿Seguro?",
			confirm: () => true,
			refresh: () => {},
		});

		expect(run).toHaveBeenCalledOnce();
		expect(out.ran).toBe(true);
	});

	it("sin confirmText nunca pregunta", async () => {
		const confirm = vi.fn(() => false);
		const run = vi.fn(async () => ({ ok: true as const }));
		await runRowAction({ run, confirm, refresh: () => {} });

		expect(confirm).not.toHaveBeenCalled();
		expect(run).toHaveBeenCalledOnce();
	});

	it("ok sin mensaje: sin feedback y refresca una vez", async () => {
		const refresh = vi.fn();
		const out = await runRowAction({
			run: async () => ({ ok: true as const }),
			confirm: () => true,
			refresh,
		});

		expect(out).toEqual({ ran: true, failed: false, feedback: null });
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("ok con mensaje: lo muestra como éxito y refresca", async () => {
		const refresh = vi.fn();
		const out = await runRowAction({
			run: async () => ({
				ok: true as const,
				message: "Invitación reenviada.",
			}),
			confirm: () => true,
			refresh,
		});

		expect(out.failed).toBe(false);
		expect(out.feedback).toEqual({ ok: true, text: "Invitación reenviada." });
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("error de la acción: failed, mensaje de error y sin refresh", async () => {
		const refresh = vi.fn();
		const out = await runRowAction({
			run: async () => ({ ok: false as const, message: "No tenés permiso." }),
			confirm: () => true,
			refresh,
		});

		expect(out).toEqual({
			ran: true,
			failed: true,
			feedback: { ok: false, text: "No tenés permiso." },
		});
		expect(refresh).not.toHaveBeenCalled();
	});

	it("si run lanza, devuelve el error genérico", async () => {
		const refresh = vi.fn();
		const out = await runRowAction({
			run: () => {
				throw new Error("boom");
			},
			confirm: () => true,
			refresh,
		});

		expect(out.failed).toBe(true);
		expect(out.feedback).toEqual({ ok: false, text: GENERICO });
		expect(refresh).not.toHaveBeenCalled();
	});

	it("si run rechaza, devuelve el error genérico", async () => {
		const refresh = vi.fn();
		const out = await runRowAction({
			run: async () => {
				await Promise.resolve();
				throw new Error("boom");
			},
			confirm: () => true,
			refresh,
		});

		expect(out.failed).toBe(true);
		expect(out.feedback).toEqual({ ok: false, text: GENERICO });
		expect(refresh).not.toHaveBeenCalled();
	});
});
