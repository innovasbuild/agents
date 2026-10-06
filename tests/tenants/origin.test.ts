import { afterEach, describe, expect, it } from "vitest";
import { originFrom } from "@/lib/tenants/origin";

const headersOf = (entries: Record<string, string>) => new Headers(entries);

describe("originFrom", () => {
	const original = process.env.PUBLIC_APP_URL;
	afterEach(() => {
		if (original === undefined) delete process.env.PUBLIC_APP_URL;
		else process.env.PUBLIC_APP_URL = original;
	});

	it("usa el header origin cuando viene", () => {
		expect(originFrom(headersOf({ origin: "https://app.test" }))).toBe(
			"https://app.test",
		);
	});

	it("sin origin arma el origen con host y protocolo reenviados", () => {
		expect(
			originFrom(
				headersOf({ host: "preview.test", "x-forwarded-proto": "https" }),
			),
		).toBe("https://preview.test");
	});

	it("sin protocolo reenviado asume https", () => {
		expect(originFrom(headersOf({ host: "preview.test" }))).toBe(
			"https://preview.test",
		);
	});

	it("usa localhost con http", () => {
		expect(originFrom(headersOf({ host: "localhost:3000" }))).toBe(
			"http://localhost:3000",
		);
	});

	it("sin headers cae a PUBLIC_APP_URL", () => {
		process.env.PUBLIC_APP_URL = "https://prod.test";

		expect(originFrom(headersOf({}))).toBe("https://prod.test");
	});

	it("sin nada devuelve vacío", () => {
		delete process.env.PUBLIC_APP_URL;

		expect(originFrom(headersOf({}))).toBe("");
	});
});
