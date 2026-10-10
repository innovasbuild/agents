import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/usuarios/actions", () => ({
	changeMemberRole: async () => ({ ok: true }),
}));

const { ActionButton, RoleSelect } = await import(
	"@/app/[tenant]/settings/usuarios/row-actions"
);

describe("ActionButton", () => {
	it("dibuja un botón con su rótulo y sin mensaje al arrancar", () => {
		const html = renderToStaticMarkup(
			createElement(ActionButton, {
				run: async () => ({ ok: true as const }),
				label: "Bloquear",
			}),
		);

		expect(html).toContain("Bloquear");
		expect(html).toContain('type="button"');
		expect(html).not.toContain('role="status"');
		expect(html).not.toContain('role="alert"');
	});
});

describe("RoleSelect", () => {
	const render = (role: "tenant_admin" | "tenant_member") =>
		renderToStaticMarkup(
			createElement(RoleSelect, { membershipId: "m1", slug: "acme", role }),
		);

	it("ofrece Usuario y Administrador, nunca administrador de la plataforma", () => {
		const html = render("tenant_member");

		expect(html).toContain(">Usuario<");
		expect(html).toContain(">Administrador<");
		expect(html).not.toContain("Administrador de la plataforma");
	});

	it("marca el rol actual", () => {
		expect(render("tenant_admin")).toMatch(
			/<option[^>]*value="tenant_admin"[^>]*selected/,
		);
	});

	it("tiene nombre accesible", () => {
		expect(render("tenant_member")).toContain('aria-label="Rol"');
	});
});
