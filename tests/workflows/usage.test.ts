import { describe, expect, it, vi } from "vitest";
import {
	createUsageRecorder,
	metered,
	resolveRunId,
	type UsageEntry,
} from "@/lib/workflows/usage";

function fakeAdmin(result: { error: { message: string } | null }) {
	const insert = vi.fn(async () => result);
	return { admin: { from: vi.fn(() => ({ insert })) }, insert };
}

const entry: UsageEntry = {
	tenantId: "t1",
	runId: "r1",
	workflow: null,
	node: "outreach/draft",
	resource: "model_usd",
	amount: 0.03,
	unit: "usd",
	meta: { model: "anthropic/claude-opus-5" },
};

describe("createUsageRecorder", () => {
	it("inserta el asiento en usage_entries con los nombres de columna", async () => {
		const { admin, insert } = fakeAdmin({ error: null });
		await createUsageRecorder(admin as never)(entry);
		expect(admin.from).toHaveBeenCalledWith("usage_entries");
		expect(insert).toHaveBeenCalledWith({
			tenant_id: "t1",
			run_id: "r1",
			workflow: null,
			node: "outreach/draft",
			resource: "model_usd",
			amount: 0.03,
			unit: "usd",
			meta: { model: "anthropic/claude-opus-5" },
		});
	});

	it("un fallo al asentar no tira: medir no puede tumbar el trabajo real", async () => {
		const { admin } = fakeAdmin({ error: { message: "db caída" } });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			createUsageRecorder(admin as never)(entry),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("una excepción del cliente tampoco tira", async () => {
		const admin = {
			from: vi.fn(() => {
				throw new Error("red caída");
			}),
		};
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			createUsageRecorder(admin as never)(entry),
		).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

describe("resolveRunId", () => {
	function adminWithRun(data: { id: string } | null) {
		const maybeSingle = vi.fn(async () => ({ data, error: null }));
		const eq2 = vi.fn(() => ({ maybeSingle }));
		const eq1 = vi.fn(() => ({ eq: eq2 }));
		const select = vi.fn(() => ({ eq: eq1 }));
		return { from: vi.fn(() => ({ select })) };
	}

	it("busca la corrida por sesión y turno", async () => {
		const admin = adminWithRun({ id: "run-9" });
		expect(await resolveRunId(admin as never, "s1", "turn1")).toBe("run-9");
	});

	it("sin turno no hay corrida que buscar", async () => {
		const admin = adminWithRun({ id: "run-9" });
		expect(await resolveRunId(admin as never, "s1", null)).toBeNull();
		expect(admin.from).not.toHaveBeenCalled();
	});

	it("si no la encuentra devuelve null", async () => {
		expect(
			await resolveRunId(adminWithRun(null) as never, "s1", "turn1"),
		).toBeNull();
	});
});

describe("metered", () => {
	const base = {
		tenantId: "t1",
		runId: "r1",
		workflow: null,
		node: "outreach/draft",
	};

	it("devuelve el resultado intacto y asienta el costo de la llamada", async () => {
		const record = vi.fn(async () => {});
		const generate = async (_model: string, _system: string) => ({
			output: { subject: "s" },
			usage: { inputTokens: 1_000_000, outputTokens: 0 },
			providerMetadata: undefined,
		});
		const wrapped = metered(generate, {
			model: (model) => model,
			record,
			base,
		});

		const result = await wrapped("anthropic/claude-sonnet-5", "system");

		expect(result.output).toEqual({ subject: "s" });
		expect(record).toHaveBeenCalledWith({
			...base,
			resource: "model_usd",
			amount: 2,
			unit: "usd",
			meta: {
				model: "anthropic/claude-sonnet-5",
				source: "tabla",
				inputTokens: 1_000_000,
				outputTokens: 0,
			},
		});
	});

	it("si la llamada tira, no asienta y relanza", async () => {
		const record = vi.fn(async () => {});
		const generate = async (_model: string) => {
			throw new Error("gateway caído");
		};
		const wrapped = metered(generate, {
			model: (model) => model,
			record,
			base,
		});
		await expect(wrapped("m")).rejects.toThrow("gateway caído");
		expect(record).not.toHaveBeenCalled();
	});
});
