import { defineEvalConfig } from "eve/evals";

// Concurrencia 1: comparten el tenant sembrado con las evals de outreach, y
// dos de ellas prenden y apagan el agente de outreach.
export default defineEvalConfig({
	maxConcurrency: 1,
	timeoutMs: 240_000,
});
