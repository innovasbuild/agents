import { describe, expect, it } from "vitest";
import { chooseBodyToSave } from "@/lib/brain/core/editor/body-to-save";

const original = "* uno\n* dos\n";
const originalRoundtrip = "- uno\n- dos";

describe("chooseBodyToSave", () => {
	it("si el editor serializa lo mismo que serializaba el original, se guarda el original tal cual", () => {
		expect(
			chooseBodyToSave({
				original,
				originalRoundtrip,
				serialized: "- uno\n- dos",
			}),
		).toBe(original);
	});

	it("si la persona cambió el contenido, se guarda lo serializado", () => {
		expect(
			chooseBodyToSave({
				original,
				originalRoundtrip,
				serialized: "- uno\n- dos\n- tres",
			}),
		).toBe("- uno\n- dos\n- tres");
	});

	it("escribir y deshacer hasta el mismo texto no reescribe el cuerpo", () => {
		const edited = chooseBodyToSave({
			original,
			originalRoundtrip,
			serialized: "- uno\n- dos\n- x",
		});
		expect(edited).not.toBe(original);
		expect(
			chooseBodyToSave({
				original,
				originalRoundtrip,
				serialized: originalRoundtrip,
			}),
		).toBe(original);
	});

	it("un original que ya está en el estilo del editor se devuelve igual", () => {
		expect(
			chooseBodyToSave({
				original: "texto",
				originalRoundtrip: "texto",
				serialized: "texto",
			}),
		).toBe("texto");
	});
});
