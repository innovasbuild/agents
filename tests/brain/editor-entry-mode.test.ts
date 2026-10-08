import { describe, expect, it } from "vitest";
import { entryMode } from "@/lib/brain/core/editor/entry-mode";

describe("entryMode", () => {
	it("lo que no se ve es hidden; lector es read; editor y administrador son edit", () => {
		expect(entryMode(null)).toBe("hidden");
		expect(entryMode("lector")).toBe("read");
		expect(entryMode("editor")).toBe("edit");
		expect(entryMode("administrador")).toBe("edit");
	});
});
