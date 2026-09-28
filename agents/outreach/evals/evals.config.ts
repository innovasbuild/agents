import { defineEvalConfig } from "eve/evals";

// Concurrencia 1: todas las evals comparten el tenant sembrado. El juez es el
// default de eve (typesafe-ai/jev), que desde la 0.62 tiene que ser un modelo
// de evaluación y no uno de lenguaje.
export default defineEvalConfig({
	maxConcurrency: 1,
	timeoutMs: 240_000,
});
