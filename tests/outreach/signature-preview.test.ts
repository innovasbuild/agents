import { describe, expect, it } from "vitest";
import { composeMail } from "@/lib/gmail/signature";
import { executorSignature } from "@/lib/outreach/signature-preview";

const ROW = {
	display_name: "Matías O'Keefe",
	title: "CTO y Producto",
	linkedin_url: "https://www.linkedin.com/in/matiasokeefe/",
};
const CONFIG = { company: { name: "INNOV.AS", url: "https://innov.as" } };

describe("executorSignature", () => {
	it("la firma de la previsualización es la misma que la del envío", () => {
		const body = "Hola Diego,\n\nTe escribo por...";
		const signature = executorSignature(ROW, CONFIG);
		expect(`${body}\n\n${signature}`).toBe(
			composeMail(
				body,
				{
					displayName: ROW.display_name,
					title: ROW.title,
					linkedinUrl: ROW.linkedin_url,
				},
				CONFIG.company,
			).text,
		);
	});

	it("sin ejecutor o sin nombre cargado no hay firma, igual que el envío", () => {
		expect(executorSignature(null, CONFIG)).toBeNull();
		expect(
			executorSignature(
				{ display_name: null, title: null, linkedin_url: null },
				CONFIG,
			),
		).toBeNull();
	});

	it("sin empresa en la config firma igual, con nombre y puesto", () => {
		const signature = executorSignature(ROW, {});
		expect(signature).toContain("Matías O'Keefe");
		expect(signature).toContain("CTO y Producto");
		expect(signature).not.toContain("INNOV.AS");
	});

	it("una config rota no rompe la pantalla: firma sin empresa", () => {
		expect(executorSignature(ROW, { company: "innovas" })).toContain(
			"Matías O'Keefe",
		);
	});
});
