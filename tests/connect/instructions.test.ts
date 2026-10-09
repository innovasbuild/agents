import { describe, expect, it } from "vitest";
import {
	CLIENT_LABELS,
	CLIENTS,
	instructionsFor,
} from "@/lib/connect/instructions";

const target = {
	id: "outreach-acme",
	url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
};

describe("instructionsFor", () => {
	it("hay cinco clientes, cada uno con su rótulo", () => {
		expect(CLIENTS).toEqual([
			"claude-code",
			"claude-ai",
			"chatgpt",
			"codex",
			"cursor",
		]);
		for (const client of CLIENTS) expect(CLIENT_LABELS[client]).toBeTruthy();
	});

	it("solo Claude Code está probado", () => {
		expect(
			CLIENTS.filter((client) => instructionsFor(client, target).tested),
		).toEqual(["claude-code"]);
	});

	it("todos tienen al menos dos pasos", () => {
		for (const client of CLIENTS) {
			expect(instructionsFor(client, target).steps.length).toBeGreaterThan(1);
		}
	});

	it("Claude Code: comando con el id y la URL entre comillas", () => {
		expect(instructionsFor("claude-code", target).snippet).toEqual({
			language: "bash",
			code: 'claude mcp add --transport http outreach-acme "https://app.test/eve/outreach/v1/mcp?tenant=acme"',
		});
	});

	it("Codex: alta y login, con la URL entre comillas", () => {
		expect(instructionsFor("codex", target).snippet).toEqual({
			language: "bash",
			code: 'codex mcp add outreach-acme --url "https://app.test/eve/outreach/v1/mcp?tenant=acme"\ncodex mcp login outreach-acme',
		});
	});

	it("Cursor: JSON válido con el id como clave y la URL", () => {
		const snippet = instructionsFor("cursor", target).snippet;
		expect(snippet?.language).toBe("json");
		expect(JSON.parse(snippet?.code ?? "")).toEqual({
			mcpServers: { "outreach-acme": { url: target.url } },
		});
	});

	it("claude.ai y ChatGPT no llevan comando: la URL se pega a mano", () => {
		expect(instructionsFor("claude-ai", target).snippet).toBeUndefined();
		expect(instructionsFor("chatgpt", target).snippet).toBeUndefined();
	});

	it("una URL con comillas no rompe el JSON de Cursor", () => {
		const raro = {
			id: "x",
			url: 'https://app.test/eve/a%22b/v1/mcp?tenant="z"',
		};
		const snippet = instructionsFor("cursor", raro).snippet;
		expect(JSON.parse(snippet?.code ?? "").mcpServers.x.url).toBe(raro.url);
	});

	it("una URL con comillas o $ no se escapa del entrecomillado del comando", () => {
		const raro = { id: "x", url: 'https://app.test/mcp?tenant="$HOME`id`' };
		const code = instructionsFor("claude-code", raro).snippet?.code ?? "";
		expect(code).toContain('\\"');
		expect(code).toContain("\\$HOME");
		expect(code).toContain("\\`id\\`");
	});
});
