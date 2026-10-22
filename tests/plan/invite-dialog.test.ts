import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { InviteDialog } from "@/components/plan/invite-dialog";

describe("InviteDialog", () => {
	it("muestra el botón de invitar", () => {
		const out = renderToStaticMarkup(
			createElement(InviteDialog, { tenantId: "t1", slug: "acme" }),
		);
		expect(out).toContain("Invitá a un colaborador");
	});
});
