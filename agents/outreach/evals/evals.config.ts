import { defineEvalConfig } from "eve/evals";

// Concurrencia 1: todas las evals comparten el tenant sembrado.
export default defineEvalConfig({
	judge: { model: "anthropic/claude-sonnet-5" },
	maxConcurrency: 1,
	timeoutMs: 240_000,
});
