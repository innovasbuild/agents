// Guardia estructural del "no manda" (Fix round 1, hallazgo 3). Mismo patrón
// que tests/outreach/services/sweep.test.ts: lee el fuente y asserta que no
// hay ni dep ni import del camino de envío, para que un envío colado adentro
// de draftAndQueue rompa el test en vez de quedar verde para siempre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FOLLOWUPS_SOURCE = readFileSync(
	join(
		__dirname,
		"..",
		"..",
		"..",
		"lib",
		"outreach",
		"services",
		"followups.ts",
	),
	"utf8",
);

const SCHEDULE_SOURCE = readFileSync(
	join(
		__dirname,
		"..",
		"..",
		"..",
		"agents",
		"outreach",
		"schedules",
		"followups.ts",
	),
	"utf8",
);

describe("followups nunca manda un mail", () => {
	it("FollowupsDeps no declara ninguna dep de envío", () => {
		const depsBlock =
			FOLLOWUPS_SOURCE.match(
				/export interface FollowupsDeps \{([\s\S]*?)\n\}/,
			)?.[1] ?? "";

		expect(depsBlock).not.toBe("");
		expect(depsBlock).not.toMatch(/send/i);
	});

	it("lib/outreach/services/followups.ts no importa el camino de envío", () => {
		expect(FOLLOWUPS_SOURCE).not.toMatch(/from\s+["'][^"']*gmail\/send["']/);
		expect(FOLLOWUPS_SOURCE).not.toMatch(/from\s+["'][^"']*services\/send["']/);
		expect(FOLLOWUPS_SOURCE).not.toMatch(/\bsendMail\b/);
		expect(FOLLOWUPS_SOURCE).not.toMatch(/\bsendQueuedEmail\b/);
	});

	// El cableado real SÍ importa lib/gmail/send.ts (GMAIL_SCOPES, para pedir
	// el token con el scope justo), así que acá no se puede prohibir el import
	// entero como arriba — eso rompería contra un uso legítimo. Lo que se
	// prohíbe es la función de envío en sí, con o sin ese import.
	it("el cableado del schedule (draftAndQueue) no usa la función de envío real", () => {
		expect(SCHEDULE_SOURCE).not.toMatch(/\bsendMail\b/);
		expect(SCHEDULE_SOURCE).not.toMatch(/\bsendQueuedEmail\b/);
		expect(SCHEDULE_SOURCE).not.toMatch(/from\s+["'][^"']*services\/send["']/);
	});
});
