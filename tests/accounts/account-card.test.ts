import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/mis-cuentas/actions", () => ({
	startAccountAuthorization: async () => ({ ok: true, url: "x" }),
}));

const { AccountCard, AccountNotice } = await import(
	"@/app/[tenant]/mis-cuentas/account-card"
);

const URL_FROM_CONNECT = "https://connect.test/autorizar?state=abc";

describe("AccountNotice", () => {
	it("con la URL devuelta muestra un link visible, seguro, y no afirma que se abrió una pestaña", () => {
		const html = renderToStaticMarkup(
			createElement(AccountNotice, {
				message: "Abrí la autorización.",
				url: URL_FROM_CONNECT,
			}),
		);
		expect(html).toContain(`href="${URL_FROM_CONNECT}"`);
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain("Abrir la autorización");
		expect(html).not.toContain("que se abrió");
	});

	it("sin URL no hay link", () => {
		const html = renderToStaticMarkup(
			createElement(AccountNotice, { message: "No pude.", url: null }),
		);
		expect(html).toContain("No pude.");
		expect(html).not.toContain("<a");
	});
});

describe("AccountCard", () => {
	it("antes del clic no hay link ni URL en el HTML", () => {
		const html = renderToStaticMarkup(
			createElement(AccountCard, {
				account: "gmail",
				slug: "acme",
				state: "sin_autorizar",
			}),
		);
		expect(html).not.toContain("<a");
		expect(html).not.toContain("http");
		expect(html).not.toContain('role="status"');
	});
});
