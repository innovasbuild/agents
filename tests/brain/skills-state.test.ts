import { describe, expect, it } from "vitest";
import {
	publishedSnapshot,
	skillState,
	skillStateLabel,
} from "@/lib/brain/core/skills/state";
import type {
	SkillOverviewRow,
	SkillSnapshot,
} from "@/lib/brain/core/skills/store";

const snapshot = (over: Partial<SkillSnapshot> = {}): SkillSnapshot => ({
	action: "publicar",
	version: 3,
	pageRevision: 5,
	filesDigest: "fd",
	title: "T",
	description: "d",
	body: "publicado",
	frontmatter: { description: "d" },
	manifest: [],
	digest: "dg",
	publishedAt: "2026-10-11T00:00:00Z",
	...over,
});
const row = (over: Partial<SkillOverviewRow> = {}): SkillOverviewRow => ({
	pageId: "p1",
	slug: "skills/a",
	revision: 5,
	draftFilesDigest: "fd",
	current: snapshot(),
	...over,
});

describe("skillState", () => {
	it("sin actos: sin publicar", () => {
		expect(skillState(row({ current: null }))).toEqual({
			kind: "sin_publicar",
		});
	});
	it("borrador igual a lo publicado", () => {
		expect(skillState(row())).toEqual({
			kind: "publicada",
			version: 3,
			dirty: false,
		});
	});
	it("cambió el texto o cambiaron los archivos", () => {
		expect(skillState(row({ revision: 6 }))).toMatchObject({ dirty: true });
		expect(skillState(row({ draftFilesDigest: "otro" }))).toMatchObject({
			dirty: true,
		});
	});
	it("rótulos", () => {
		expect(skillStateLabel({ kind: "sin_publicar" })).toBe("Sin publicar");
		expect(
			skillStateLabel({ kind: "publicada", version: 2, dirty: true }),
		).toBe("Publicada v2, con cambios sin publicar");
	});
	it("último acto retirar", () => {
		expect(
			skillState(row({ current: snapshot({ action: "retirar" }) })),
		).toEqual({ kind: "retirada", version: 3 });
	});
});

describe("publishedSnapshot", () => {
	it("solo devuelve un acto vigente", () => {
		expect(publishedSnapshot(row())?.body).toBe("publicado");
		expect(
			publishedSnapshot(row({ current: snapshot({ action: "retirar" }) })),
		).toBeNull();
		expect(publishedSnapshot(row({ current: null }))).toBeNull();
		expect(publishedSnapshot(undefined)).toBeNull();
	});
});
