// tests/focos/actions.test.ts
// Mismo patrón que tests/cola/actions.test.ts: mocks de webSession/
// webStoreDeps con vi.mock, sin tocar Supabase real. Sumado en la ronda de
// arreglo de la Task 22, que había quedado sin tests propios.
import { beforeEach, describe, expect, it, vi } from "vitest";

const webSession = vi.fn();
vi.mock("@/lib/outreach/web-session", () => ({ webSession }));

const insertFocus = vi.fn();
const loadTenantOutreach = vi.fn();
const loadExecutor = vi.fn();
const findContactById = vi.fn();
const updateContactIcp = vi.fn();

// webStoreDeps es sync en el código real (Pick<QueueDeps, "store" | "now">),
// no una promesa: el mock respeta esa forma.
const webStoreDeps = vi.fn(() => ({
	store: {
		insertFocus,
		loadTenantOutreach,
		loadExecutor,
		findContactById,
		updateContactIcp,
	},
	now: () => new Date(),
}));
vi.mock("@/lib/outreach/web-context", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/outreach/web-context")
	>("@/lib/outreach/web-context");
	return { ...actual, webStoreDeps };
});

// qualifyContact arma sus deps de work_items a mano (createAdminClient +
// createSupabaseWorkflowStore), fuera de webStoreDeps: sin estos tres mocks,
// esas llamadas se evalúan igual (los argumentos de enqueue() se calculan
// antes de invocarla) y createAdminClient() explota sin env real de Supabase.
const enqueueMock = vi.fn();
vi.mock("@/lib/workflows/enqueue", () => ({ enqueue: enqueueMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/workflows/store", () => ({
	createSupabaseWorkflowStore: () => ({}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createFocus, qualifyContact, discardContact } = await import(
	"@/app/[tenant]/focos/actions"
);

const SLUG = "innovas";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = {
	caller: {
		tenantId: "t1",
		userId: "u1",
		role: "tenant_member",
		email: "mati@innov.as",
	},
	tenant: { id: "t1", slug: SLUG },
};

const FORM = {
	name: "Envases GBA",
	criteria: { employeeRanges: ["50,200"] },
	vector: "v1",
	segment: "s1",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: "20",
	maxContacts: "60",
};

const TENANT_OUTREACH = {
	config: {},
	values: { segmento: [], vector: [], hook: [], idioma: [] },
	labels: { segmento: {}, vector: {}, hook: {}, idioma: {} },
	defaultHooks: {},
};

const EXECUTOR = {
	tenantId: "t1",
	userId: "u1",
	slug: "mati",
	crmOwnerId: "crm-1",
	dailyQuota: 30,
	gmailAuthorizedAt: null,
	gmailReadAuthorizedAt: null,
};

describe("createFocus", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		insertFocus.mockReset();
		loadTenantOutreach.mockReset().mockResolvedValue(TENANT_OUTREACH);
		loadExecutor.mockReset().mockResolvedValue(EXECUTOR);
	});

	it("rechaza un form inválido sin llegar a insertFocus", async () => {
		const result = await createFocus(SLUG, { ...FORM, name: "" });

		expect(result.ok).toBe(false);
		expect(insertFocus).not.toHaveBeenCalled();
	});

	it("rechaza sin sesión", async () => {
		webSession.mockResolvedValue(null);

		const result = await createFocus(SLUG, FORM);

		expect(result.ok).toBe(false);
		expect(insertFocus).not.toHaveBeenCalled();
	});

	it("rechaza a quien no es ejecutor de outreach en ese tenant, sin insertar (resolveExecutor)", async () => {
		loadExecutor.mockResolvedValue(null);

		const result = await createFocus(SLUG, FORM);

		expect(result.ok).toBe(false);
		expect(insertFocus).not.toHaveBeenCalled();
	});

	it("crea el foco con createdBy = el userId de la sesión", async () => {
		insertFocus.mockResolvedValue({ id: "focus-1" });

		const result = await createFocus(SLUG, FORM);

		expect(result).toEqual({ ok: true });
		expect(insertFocus).toHaveBeenCalledTimes(1);
		expect(insertFocus).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "t1",
				createdBy: "u1",
				name: "Envases GBA",
				maxAccounts: 20,
				maxContacts: 60,
			}),
		);
	});
});

describe("qualifyContact", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		enqueueMock.mockReset();
	});

	it("rechaza sin sesión, sin llamar a enqueue", async () => {
		webSession.mockResolvedValue(null);

		const result = await qualifyContact(SLUG, CONTACT_ID);

		expect(result.ok).toBe(false);
		expect(enqueueMock).not.toHaveBeenCalled();
	});

	it("contesta ok cuando enqueue() encola de verdad", async () => {
		enqueueMock.mockResolvedValue({ enqueued: true });

		const result = await qualifyContact(SLUG, CONTACT_ID);

		expect(result).toEqual({ ok: true });
	});

	it("también contesta ok cuando enqueue() dice ya_visto: no es un error", async () => {
		enqueueMock.mockResolvedValue({ enqueued: false, reason: "ya_visto" });

		const result = await qualifyContact(SLUG, CONTACT_ID);

		expect(result).toEqual({ ok: true });
	});

	it("da error cuando enqueue() no reconoce el workflow", async () => {
		enqueueMock.mockResolvedValue({
			enqueued: false,
			reason: "workflow_desconocido",
		});

		const result = await qualifyContact(SLUG, CONTACT_ID);

		expect(result.ok).toBe(false);
	});
});

describe("discardContact", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		findContactById.mockReset();
		updateContactIcp.mockReset();
	});

	it("exige un motivo no vacío, sin tocar la base", async () => {
		const result = await discardContact(SLUG, CONTACT_ID, "   ");

		expect(result.ok).toBe(false);
		expect(findContactById).not.toHaveBeenCalled();
		expect(updateContactIcp).not.toHaveBeenCalled();
	});

	it("da error si el contacto no existe", async () => {
		findContactById.mockResolvedValue(null);

		const result = await discardContact(SLUG, CONTACT_ID, "no es del rubro");

		expect(result.ok).toBe(false);
		expect(updateContactIcp).not.toHaveBeenCalled();
	});

	it("con un icp previo (de icp-scoring), preserva los juicios crudos y solo cambia lane/reason/judged_at", async () => {
		findContactById.mockResolvedValue({
			id: CONTACT_ID,
			icp: {
				encaje_empresa:
					"encaja bien: es exactamente el tipo de empresa que buscamos",
				rol_decisor: "decide o compra directamente la solución",
				excluir: "no",
				lane: "para_revisar",
				reason: "scoring automático",
				model: "jev-1",
				revision: "2026-09-01",
				judged_at: "2026-09-01T00:00:00Z",
			},
		});

		const result = await discardContact(SLUG, CONTACT_ID, "no es del rubro");

		expect(result).toEqual({ ok: true });
		expect(updateContactIcp).toHaveBeenCalledTimes(1);
		const [tenantId, id, icp] = updateContactIcp.mock.calls[0];
		expect(tenantId).toBe("t1");
		expect(id).toBe(CONTACT_ID);
		expect(icp).toMatchObject({
			encaje_empresa:
				"encaja bien: es exactamente el tipo de empresa que buscamos",
			rol_decisor: "decide o compra directamente la solución",
			excluir: "no",
			model: "jev-1",
			revision: "2026-09-01",
			lane: "descartado",
			reason: "manual: no es del rubro",
		});
		expect(typeof icp.judged_at).toBe("string");
		expect(icp.judged_at).not.toBe("2026-09-01T00:00:00Z");
	});

	it("sin icp previo, arma el objeto con nulls y no explota", async () => {
		findContactById.mockResolvedValue({ id: CONTACT_ID, icp: null });

		const result = await discardContact(SLUG, CONTACT_ID, "no es del rubro");

		expect(result).toEqual({ ok: true });
		expect(updateContactIcp).toHaveBeenCalledWith(
			"t1",
			CONTACT_ID,
			expect.objectContaining({
				encaje_empresa: null,
				rol_decisor: null,
				excluir: null,
				model: "",
				revision: "",
				lane: "descartado",
				reason: "manual: no es del rubro",
			}),
		);
	});
});
