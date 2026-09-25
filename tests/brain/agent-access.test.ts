import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBrainAccess } from "@/lib/brain/agent-access";

describe("parseBrainAccess", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());

	it("lee la declaración del agente", () => {
		expect(parseBrainAccess({ brain: "read" })).toBe("read");
		expect(parseBrainAccess({ brain: "read_write" })).toBe("read_write");
		expect(parseBrainAccess({ brain: "none" })).toBe("none");
	});

	it("sin declaración no hay brain, y no avisa", () => {
		expect(parseBrainAccess({})).toBe("none");
		expect(parseBrainAccess(null)).toBe("none");
		expect(warn).not.toHaveBeenCalled();
	});

	it("una declaración inválida vale none y avisa", () => {
		expect(parseBrainAccess({ brain: "todo" })).toBe("none");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("todo"));
	});
});
