import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			db.from(table);
			return { insert: db.insert };
		},
	}),
}));

import {
	recordSkillImport,
	skillImportEvent,
} from "@/lib/brain/adapters/skill-uploads";

const entry = {
	tenantId: "t1",
	userId: "ana",
	channel: "web" as const,
	slug: "skills/ventas/reporte",
	mode: "crear" as const,
	files: 3,
};

beforeEach(() => vi.clearAllMocks());

describe("skillImportEvent", () => {
	it("arma el evento con canal, slug, modo y cantidad de archivos", () => {
		expect(skillImportEvent(entry)).toEqual({
			tenant_id: "t1",
			actor_user_id: "ana",
			channel: "web",
			type: "brain.skill_imported",
			summary: "skills/ventas/reporte",
			payload: { mode: "crear", files: 3 },
		});
	});
});

describe("recordSkillImport", () => {
	it("inserta en events", async () => {
		db.insert.mockResolvedValue({ error: null });
		await recordSkillImport(entry);
		expect(db.from).toHaveBeenCalledWith("events");
		expect(db.insert).toHaveBeenCalledWith(skillImportEvent(entry));
	});

	it("tira solo el mensaje de la base", async () => {
		db.insert.mockResolvedValue({ error: { message: "boom" } });
		await expect(recordSkillImport(entry)).rejects.toThrow("boom");
	});
});
