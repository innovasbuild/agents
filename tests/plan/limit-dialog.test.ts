import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LimitDialogBody, limitIconName } from "@/components/plan/limit-dialog";
import { Dialog } from "@/components/ui/dialog";
import { type LimitReason, limitMessage } from "@/lib/plans/limits";

const MAILTO = "mailto:hola@innov.as?subject=Plan%20de%20Central%20IA";
const html = (reason: LimitReason, contactHref?: string) =>
	// El contenido real vive en un portal que no se renderiza en el servidor;
	// Title y Description solo piden el contexto del Dialog.
	renderToStaticMarkup(
		createElement(
			Dialog,
			{ open: true },
			createElement(LimitDialogBody, {
				reason,
				contactHref,
				onClose: () => undefined,
			}),
		),
	);

describe("LimitDialogBody", () => {
	it("limit:users muestra el título, el cuerpo y el mailto", () => {
		const out = html("limit:users");
		expect(out).toContain("Tu equipo creció");
		expect(out).toContain(MAILTO);
		expect(out).toContain("Hablá con nosotros");
		expect(out).toContain("Ahora no");
	});

	it.each([
		"limit:users",
		"limit:skills",
		"limit:ai_credit",
		"suspended:trial_vencido",
		"suspended:pago_fallido",
		"suspended:cancelado",
	] as LimitReason[])("%s usa el texto de limitMessage", (reason) => {
		const { title } = limitMessage(reason);
		expect(html(reason)).toContain(title);
	});

	it("suspended:cancelado muestra el aviso de suspensión", () => {
		expect(html("suspended:cancelado")).toContain(
			"La suscripción está cancelada",
		);
	});

	it("contactHref pisa el mailto", () => {
		const out = html("limit:users", "/acme/settings/plan");
		expect(out).toContain('href="/acme/settings/plan"');
		expect(out).not.toContain("mailto:");
	});
});

describe("limitIconName", () => {
	it("mapea cada motivo a su ícono", () => {
		expect(limitIconName("limit:users")).toBe("users");
		expect(limitIconName("limit:skills")).toBe("sparkles");
		expect(limitIconName("limit:ai_credit")).toBe("zap");
		expect(limitIconName("suspended:trial_vencido")).toBe("triangle-alert");
		expect(limitIconName("suspended:cancelado")).toBe("triangle-alert");
	});
});
