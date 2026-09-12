import { describe, expect, it } from "vitest";
import { pickModel } from "@/lib/agents/model";

const allowed = ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-4-5"];

describe("pickModel", () => {
	it("prioriza el override del agente en el tenant", () => {
		expect(
			pickModel({
				agentModel: "anthropic/claude-haiku-4-5",
				conversationModel: "anthropic/claude-sonnet-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-haiku-4-5");
	});

	it("usa el modelo que eligió el usuario en el hilo", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: "anthropic/claude-haiku-4-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-haiku-4-5");
	});

	it("cae al default del tenant si no hay elección", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: null,
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-sonnet-5");
	});

	it("ignora un modelo que el tenant no habilitó", () => {
		expect(
			pickModel({
				agentModel: null,
				conversationModel: "anthropic/claude-opus-5",
				defaultModel: "anthropic/claude-sonnet-5",
				allowedModels: allowed,
			}),
		).toBe("anthropic/claude-sonnet-5");
	});
});
