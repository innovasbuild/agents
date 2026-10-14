import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";

const resolveBrainBinding = vi.fn();
const loadRules = vi.fn();
const overview = vi.fn();

vi.mock("@/lib/brain/core/resolve", () => ({
	resolveBrainBinding: (...args: unknown[]) => resolveBrainBinding(...args),
}));
vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({ load: loadRules }),
}));
vi.mock("@/lib/brain/core/skills/store", () => ({
	createSupabaseSkillStore: () => ({ overview }),
}));
vi.mock("@/lib/connectors/bindings", () => ({ loadTenantBindings: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tenants/resolve", () => ({ resolveTenantAccess: vi.fn() }));
vi.mock("@/lib/brain/adapters/acting-provider", () => ({
	resolveActingProvider: vi.fn(),
}));
vi.mock("@/lib/brain/adapters/provider", () => ({ getBrainProvider: vi.fn() }));

import { memberSkills } from "@/lib/brain/adapters/skills";

function row(
	slug: string,
	action: "publicar" | "retirar" | null,
): SkillOverviewRow {
	return {
		pageId: `p-${slug}`,
		slug,
		revision: 1,
		draftFilesDigest: "d",
		current: action
			? {
					action,
					version: 2,
					pageRevision: 1,
					filesDigest: "d",
					title: "T",
					description: "hace algo",
					body: "cuerpo",
					frontmatter: {},
					manifest: [],
					digest: "dg",
					publishedAt: "2026-10-11T00:00:00Z",
				}
			: null,
	};
}

const member = (role: "tenant_admin" | "tenant_member") =>
	({ tenantId: "t1", userId: "u1", role }) as Parameters<
		typeof memberSkills
	>[0];

const restricting: AccessRule[] = [
	{ path: "", principal: "members", userId: null, level: "lector" },
	{ path: "skills", principal: "members", userId: null, level: "ninguno" },
];
const granting: AccessRule[] = [
	...restricting,
	{ path: "skills/ventas", principal: "user", userId: "u1", level: "lector" },
];

beforeEach(() => {
	vi.clearAllMocks();
	resolveBrainBinding.mockResolvedValue({ provider: "wiki" });
	loadRules.mockResolvedValue([]);
	overview.mockResolvedValue([row("skills/ventas", "publicar")]);
});

describe("memberSkills", () => {
	it("un administrador ve la skill publicada, sin cargar reglas", async () => {
		expect(await memberSkills(member("tenant_admin"))).toEqual([
			{
				slug: "skills/ventas",
				name: "ventas",
				description: "hace algo",
				version: 2,
			},
		]);
		expect(loadRules).not.toHaveBeenCalled();
	});

	it("un miembro con una regla que restringe no la ve", async () => {
		loadRules.mockResolvedValue(restricting);
		expect(await memberSkills(member("tenant_member"))).toEqual([]);
	});

	it("un miembro con una regla que le da acceso la ve", async () => {
		loadRules.mockResolvedValue(granting);
		expect(await memberSkills(member("tenant_member"))).toHaveLength(1);
	});

	it("un miembro con acceso abierto la ve", async () => {
		loadRules.mockResolvedValue([]);
		expect(await memberSkills(member("tenant_member"))).toHaveLength(1);
	});

	it("con un brain que no es wiki devuelve []", async () => {
		resolveBrainBinding.mockResolvedValue({ provider: "mcp" });
		expect(await memberSkills(member("tenant_admin"))).toEqual([]);
		expect(overview).not.toHaveBeenCalled();
	});

	it("sin brain devuelve []", async () => {
		resolveBrainBinding.mockResolvedValue(null);
		expect(await memberSkills(member("tenant_admin"))).toEqual([]);
	});

	it("una skill sin publicación vigente (sin publicar o retirada) no se lista", async () => {
		overview.mockResolvedValue([
			row("skills/a", null),
			row("skills/b", "retirar"),
		]);
		expect(await memberSkills(member("tenant_admin"))).toEqual([]);
	});
});
