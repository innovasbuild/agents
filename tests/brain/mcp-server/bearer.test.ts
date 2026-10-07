import { extractBearerToken } from "eve/channels/auth";
import { describe, expect, it } from "vitest";
import { extractBearer } from "@/lib/brain/core/mcp-server/bearer";

// core no puede importar de eve, así que tiene su propia copia. Este test
// compara las dos en los bordes: si eve cambia el parseo, esto avisa.
const CASES: Array<string | null> = [
	null,
	"",
	"Bearer abc",
	"bearer abc",
	"BEARER abc",
	"Bearer    abc   ",
	"Bearer ",
	"Bearer",
	"Basic abc",
	"Bearer a b",
	"abc",
];

describe("extractBearer", () => {
	it.each(CASES)("coincide con eve para %j", (header) => {
		expect(extractBearer(header)).toEqual(extractBearerToken(header));
	});
});
