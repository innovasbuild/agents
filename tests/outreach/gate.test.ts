import { describe, expect, it } from "vitest";
import { type GateInput, runGate } from "@/lib/outreach/gate";
import { emptyGateRules, parseGateBlocks } from "@/lib/outreach/gate-blocks";

const SUBJECT = "Crecer sin sumar gente al back office";
const BODY = [
	"Hola Laura,",
	"",
	"Vi que Metalúrgica Sur sumó una segunda planta en Rafaela este año. Cuando la operación crece así, el costo de coordinar crece más rápido que la facturación.",
	"",
	"Armamos con equipos como el tuyo un tablero que ordena pedidos y compras sin sumar gente al back office.",
	"",
	"Si te sirve, te cuento en 30 minutos cómo lo aplicamos en una empresa del rubro. Tenés un rato el jueves?",
].join("\n");

function gate(overrides: Partial<GateInput> = {}) {
	return runGate({
		subject: SUBJECT,
		body: BODY,
		channel: "email",
		idioma: "es_ar",
		rules: emptyGateRules(),
		...overrides,
	});
}

const kinds = (overrides: Partial<GateInput>) =>
	gate(overrides).violations.map((v) => v.kind);

describe("runGate", () => {
	it("una pieza limpia en es_ar pasa", () => {
		expect(gate()).toEqual({
			status: "ok",
			violations: [],
			warnings: [],
			notes: [],
		});
	});

	it("veta símbolos en cuerpo y asunto", () => {
		expect(kinds({ body: `${BODY}\nUn dato — otro.` })).toEqual(["simbolo"]);
		expect(kinds({ subject: "Crecer 🙂" })).toEqual(["simbolo"]);
		expect(
			kinds({
				body: BODY.replace(
					"Tenés un rato el jueves?",
					"¿Tenés un rato el jueves?",
				),
			}),
		).toEqual(["simbolo"]);
	});

	it("formal habilita los signos de apertura", () => {
		const rules = parseGateBlocks("```gate\nformal: true\n```", "canon-gate");
		expect(
			gate({ rules, body: BODY.replace("Tenés un rato", "¿Tenés un rato") })
				.status,
		).toBe("ok");
	});

	it("veta fórmulas sobre el texto sin acentos, incluidas las muletillas de validación", () => {
		const fail = gate({ body: `Espero que estés bien.\n${BODY}` });
		expect(fail.status).toBe("fail");
		expect(fail.violations[0]).toMatchObject({
			kind: "formula",
			piece: "cuerpo",
			what: 'fórmula vetada: "espero que estes bien"',
		});
		expect(
			kinds({ body: `${BODY}\nNo es casualidad que te escriba.` }),
		).toEqual(["formula"]);
	});

	it("las construcciones por negación avisan pero no bloquean", () => {
		const result = gate({ body: `${BODY}\nNo se trata de sumar gente.` });
		expect(result.status).toBe("ok");
		expect(result.warnings).toHaveLength(1);
	});

	it("idioma: inglés para un destinatario es_ar falla", () => {
		const body =
			"Hi Laura, I saw that your company is growing and we would like to help with the operations of your team.";
		expect(kinds({ body })).toEqual(["idioma"]);
	});

	it("idioma: formas peninsulares en es_ar y voseo en es_es fallan", () => {
		expect(kinds({ body: BODY.replace("Tenés", "Tienes") })).toEqual([
			"idioma",
		]);
		expect(kinds({ idioma: "es_es" })).toEqual(["idioma"]);
	});

	it("idioma: vale como verbo no es peninsular; vale como interjección sí", () => {
		expect(
			gate({ body: `${BODY}\nLo que más vale es el tiempo del equipo.` })
				.status,
		).toBe("ok");
		// La interjección se reconoce después de puntuación (igual que gate.py).
		expect(
			kinds({ body: `${BODY}\nListo. Vale, entonces arrancamos.` }),
		).toEqual(["idioma"]);
	});

	it("señal de idioma débil o idioma no soportado da indeterminado", () => {
		expect(gate({ body: "Hola Laura." }).status).toBe("indeterminate");
		const en = gate({ idioma: "en" });
		expect(en.status).toBe("indeterminate");
		expect(en.notes[0]).toContain('idioma "en" no soportado');
	});

	it("una violación con idioma indeterminado es falla, con la nota", () => {
		const result = gate({ body: "Hola — Laura." });
		expect(result.status).toBe("fail");
		expect(result.notes).toHaveLength(1);
	});

	it("largo: asunto de más de 50 y max_chars de las reglas", () => {
		expect(kinds({ subject: "x".repeat(51) })).toEqual(["largo"]);
		const rules = parseGateBlocks(
			"```gate\nmax_chars: email=100\n```",
			"voz/ana",
		);
		expect(kinds({ rules })).toEqual(["largo"]);
	});

	it("formato: HTML, links con tracking y asunto vacío", () => {
		expect(kinds({ body: `${BODY}\n<b>hola</b>` })).toEqual(["formato"]);
		expect(
			kinds({ body: `${BODY}\nhttps://acme.test/?utm_source=mail` }),
		).toEqual(["formato"]);
		expect(kinds({ subject: "  " })).toEqual(["formato"]);
	});

	it("vetos del tenant y del ejecutor", () => {
		const rules = parseGateBlocks(
			"```gate\nveto: clientes ... (banco mundial|bid|fao)\n```",
			"canon-gate",
		);
		const result = gate({
			rules,
			body: `${BODY}\nTrabajamos con clientes como el BID.`,
		});
		expect(result.violations).toEqual([
			{
				kind: "veto",
				piece: "cuerpo",
				what: 'veto de canon-gate: "clientes como el bid"',
				fix: "ver la regla en canon-gate",
			},
		]);
	});

	it("una regla mal formada bloquea en vez de ignorarse", () => {
		const malformed = parseGateBlocks("```gate\nveto: (bid\n```", "voz/ana");
		expect(kinds({ rules: malformed })).toEqual(["veto"]);
		const unknown = parseGateBlocks("```gate\nprohibir: x\n```", "voz/ana");
		expect(kinds({ rules: unknown })).toEqual(["veto"]);
	});
});
