import { describe, expect, it } from "vitest";
import { checkRulesWrite } from "@/lib/brain/core/rules";
import {
	type ConfirmedFolder,
	type FoldersSetupDeps,
	ROOT_RULES_BODY,
	setupBrainFolders,
} from "@/lib/onboarding/folders-setup";

const folders: ConfirmedFolder[] = [
	{
		slug: "comercial",
		name: "Comercial",
		description: "Ventas.",
		restricted: false,
	},
	{
		slug: "direccion",
		name: "Dirección",
		description: "Estrategia.",
		restricted: true,
	},
	{
		slug: "finanzas",
		name: "Finanzas",
		description: "Plata.",
		restricted: true,
	},
];
const input = {
	tenantId: "t1",
	actorUserId: "u1",
	displayName: "Acme",
	folders,
	companySummary: "Hacemos harina.",
};

function fakes(failOn?: string, existing: string[] = []) {
	const rpcs: [string, Record<string, unknown>][] = [];
	const pages: {
		write: Parameters<FoldersSetupDeps["upsertPage"]>[0];
		author: Parameters<FoldersSetupDeps["upsertPage"]>[1];
	}[] = [];
	const deps: FoldersSetupDeps = {
		async listTopFolders() {
			return existing;
		},
		async rpc(fn, args) {
			rpcs.push([fn, args]);
			return { error: fn === failOn ? { message: "boom" } : null };
		},
		async upsertPage(write, author) {
			pages.push({ write, author });
		},
	};
	return { rpcs, pages, deps };
}

describe("setupBrainFolders", () => {
	it("llama a las rpc en orden y con los args del bind", async () => {
		const { rpcs, deps } = fakes();
		expect(await setupBrainFolders(input, deps)).toEqual({ ok: true });
		expect(rpcs.map(([fn]) => fn)).toEqual([
			"platform_bind_connection",
			"brain_folders_from_config",
			"brain_set_folder_description",
			"brain_set_folder_description",
			"brain_set_folder_description",
			"platform_enable_brain_skills",
			"brain_remove_access_rule",
			"brain_set_access_rule",
			"brain_set_access_rule",
		]);
		expect(rpcs[0][1]).toEqual({
			p_actor: "u1",
			p_tenant: "t1",
			p_capability: "brain",
			p_provider: "wiki",
			p_connector_uids: [],
			p_config: {
				categories: ["comercial", "direccion", "finanzas"],
				requiredFrontmatter: ["title", "category", "status", "updated"],
				search: "fts",
			},
			p_verified_name: null,
		});
		expect(rpcs[1][1]).toEqual({ p_tenant: "t1" });
		expect(rpcs[2][1]).toEqual({
			p_tenant: "t1",
			p_actor: "u1",
			p_path: "comercial",
			p_description: "Ventas.",
		});
		expect(rpcs[5][1]).toEqual({ p_actor: "u1", p_tenant: "t1" });
	});

	it("las restringidas llevan regla members/ninguno", async () => {
		const { rpcs, deps } = fakes();
		await setupBrainFolders(input, deps);
		const rules = rpcs.filter(([fn]) => fn === "brain_set_access_rule");
		expect(rules.map(([, a]) => a)).toEqual([
			{
				p_tenant_id: "t1",
				p_path: "direccion",
				p_principal: "members",
				p_user_id: null,
				p_level: "ninguno",
				p_actor: "u1",
			},
			{
				p_tenant_id: "t1",
				p_path: "finanzas",
				p_principal: "members",
				p_user_id: null,
				p_level: "ninguno",
				p_actor: "u1",
			},
		]);
	});

	it("un reintento sin una carpeta la borra", async () => {
		const { rpcs, deps } = fakes(undefined, [
			"comercial",
			"vieja",
			"skills",
			"direccion",
			"finanzas",
		]);
		await setupBrainFolders(input, deps);
		expect(rpcs[0]).toEqual([
			"brain_delete_folder",
			{ p_tenant: "t1", p_actor: "u1", p_path: "vieja" },
		]);
		expect(rpcs.filter(([fn]) => fn === "brain_delete_folder")).toHaveLength(1);
		expect(rpcs[1][0]).toBe("platform_bind_connection");
	});

	it("con las mismas carpetas no borra nada", async () => {
		const { rpcs, deps } = fakes(undefined, [
			"comercial",
			"direccion",
			"finanzas",
		]);
		await setupBrainFolders(input, deps);
		expect(rpcs.some(([fn]) => fn === "brain_delete_folder")).toBe(false);
	});

	it("una carpeta abierta pierde su regla; las restringidas no", async () => {
		const { rpcs, deps } = fakes();
		await setupBrainFolders(input, deps);
		const removed = rpcs.filter(([fn]) => fn === "brain_remove_access_rule");
		expect(removed.map(([, a]) => a)).toEqual([
			{
				p_tenant_id: "t1",
				p_path: "comercial",
				p_principal: "members",
				p_user_id: null,
				p_actor: "u1",
			},
		]);
	});

	it("si el borrado falla devuelve step folders", async () => {
		const { deps } = fakes("brain_delete_folder", ["vieja"]);
		expect(await setupBrainFolders(input, deps)).toMatchObject({
			ok: false,
			step: "folders",
		});
	});

	it("escribe 00-reglas y la página de la empresa como import", async () => {
		const { pages, deps } = fakes();
		await setupBrainFolders(input, deps);
		expect(pages.map((p) => p.write.slug)).toEqual([
			"00-reglas",
			"direccion/que-sabemos",
		]);
		for (const p of pages) {
			expect(p.author.kind).toBe("import");
			expect(p.write.status).toBe("borrador");
		}
		expect(pages[1].write.title).toBe("Qué sabemos de Acme");
		expect(pages[1].write.body).toContain("Hacemos harina.");
		expect(
			pages[1].write.body.endsWith(
				"_Escrita por Central IA al crear la empresa. Corregila._",
			),
		).toBe(true);
	});

	it("sin carpeta de empresa usa la primera", async () => {
		const { pages, deps } = fakes();
		await setupBrainFolders(
			{ ...input, folders: [folders[0], folders[2]] },
			deps,
		);
		expect(pages[1].write.slug).toBe("comercial/que-sabemos");
	});

	it("sin resumen no escribe la segunda página", async () => {
		const { pages, deps } = fakes();
		await setupBrainFolders({ ...input, companySummary: null }, deps);
		expect(pages.map((p) => p.write.slug)).toEqual(["00-reglas"]);
		const second = fakes();
		await setupBrainFolders({ ...input, companySummary: "  " }, second.deps);
		expect(second.pages).toHaveLength(1);
	});

	it("un error de platform_enable_brain_skills corta con step skills", async () => {
		const { rpcs, pages, deps } = fakes("platform_enable_brain_skills");
		const result = await setupBrainFolders(input, deps);
		expect(result).toMatchObject({ ok: false, step: "skills" });
		expect(rpcs.some(([fn]) => fn === "brain_set_access_rule")).toBe(false);
		expect(pages).toHaveLength(0);
	});

	it("un error en el bind es step bind; un upsert que falla es step rules", async () => {
		expect(
			await setupBrainFolders(input, fakes("platform_bind_connection").deps),
		).toMatchObject({ ok: false, step: "bind" });
		const { deps } = fakes();
		deps.upsertPage = async () => {
			throw new Error("x");
		};
		expect(await setupBrainFolders(input, deps)).toMatchObject({
			ok: false,
			step: "rules",
		});
	});

	it("ROOT_RULES_BODY pasa checkRulesWrite", () => {
		expect(ROOT_RULES_BODY.length).toBeLessThanOrEqual(12_000);
		expect(() =>
			checkRulesWrite(
				{ slug: "00-reglas", status: "activo", body: ROOT_RULES_BODY },
				[],
			),
		).not.toThrow();
	});
});
