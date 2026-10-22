import { beforeEach, describe, expect, it, vi } from "vitest";

const publishSkill = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/brain/adapters/skills", () => ({
	publishDeps: () => ({}),
	filesDeps: () => ({}),
}));
vi.mock("@/lib/brain/core/skills/publish", () => ({
	publishSkill: (...args: unknown[]) => publishSkill(...args),
	previewPublish: vi.fn(),
	republishSkill: vi.fn(),
	withdrawSkill: vi.fn(),
}));
vi.mock("@/lib/brain/core/skills/files", () => ({ removeSkillFile: vi.fn() }));

import { publishSkillAction } from "@/app/[tenant]/brain/skill-actions";

describe("publishSkillAction", () => {
	beforeEach(() => publishSkill.mockReset());

	it("devuelve la razón del tope para que el cliente abra el diálogo", async () => {
		publishSkill.mockResolvedValue({
			ok: false,
			code: "limite",
			reason: "limit:skills",
			message: "Llegaste a las 5 skills del plan gratis",
		});
		const result = await publishSkillAction({
			tenantSlug: "acme",
			slug: "skills/admin/x",
			expectedRevision: 1,
			expectedFilesDigest: "a".repeat(64),
			note: "n",
		});
		expect(result).toMatchObject({ code: "limite", reason: "limit:skills" });
	});
});
