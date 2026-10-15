// Servidor MCP del brain para una persona autenticada (spec etapa 11 §5.3).
// Escribe una persona, no el agente: brain_upsert sin aprobación (D5). El permiso lo decide el proveedor que recibe (withAccess), no el rol.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BRAIN_TOOL_NAMES, brainContract } from "../contract.ts";
import {
	BrainError,
	BrainRulesRequired,
	BrainValidation,
	toToolError,
} from "../errors.ts";
import { withoutRoot } from "../rules.ts";
import { type RulesSource, requireRules } from "../rules-source.ts";
import { describeSkills, type SkillCatalog } from "../skills/catalog.ts";
import type { BrainProvider, BrainWrite } from "../types.ts";
import type { RateLimiter } from "./rate-limit.ts";

export const MCP_MAX_REQUEST_BYTES = 1_048_576;
export const MCP_MAX_UPSERT_BODY_BYTES = 102_400;

export const SKILL_TOOL_NAMES = {
	list: "skill_list",
	load: "skill_load",
	file: "skill_file",
	package: "skill_package",
} as const;

const SKILL_INSTRUCTIONS =
	"Esta empresa publica skills: procedimientos revisados para hacer una tarea a su manera. Antes de una tarea que coincida con una skill de la lista de skill_load, cargala con skill_load y seguí sus instrucciones. Los archivos de texto de una skill se leen con skill_file. Si la skill trae scripts y tu entorno puede ejecutar código y bajar archivos, pedí el paquete completo con skill_package. Si no puede, seguí las instrucciones con lo que tengas y avisale a la persona que hay un script que no pudiste correr.";

const SKILL_PACKAGE_DESCRIPTION =
	"Devuelve un link de descarga que vence en 10 minutos con el paquete completo de una skill (zip con SKILL.md, scripts y binarios), siempre en su última versión publicada. Bajalo a una carpeta temporal, descomprimilo y corré los scripts desde ahí; no lo instales en tu carpeta de skills: esa copia queda vieja cuando la empresa publica una versión nueva; pedilo de nuevo en cada sesión. Si el link venció, pedí otro. Si tu entorno no puede bajar archivos, seguí con skill_load y skill_file y avisale a la persona.";

const SKILL_LOAD_INTRO =
	"Carga una skill de la empresa: devuelve sus instrucciones y la lista de sus archivos. Usala antes de empezar una tarea que coincida con alguna de estas skills, sin esperar a que te lo pidan. Skills disponibles:";

function result(value: Record<string, unknown>, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value,
		...(isError ? { isError: true } : {}),
	};
}

export function buildBrainMcpServer(ctx: {
	userId: string;
	categories: string[];
	/** Si las descripciones nombran el canon comercial (spec 21.4 §4.3). */
	canon: boolean;
	provider: BrainProvider;
	limiter: RateLimiter;
	/** Skills publicadas que ve la persona; sin ninguna, no hay tools de skills. */
	skills?: SkillCatalog | null;
	/** Reglas que ve la persona (spec etapa 26 §4.3). Sin esto, ni brain_rules ni rules en brain_read. */
	rules?: RulesSource | null;
	/** Instrucciones del brain y carpetas, para el campo instructions. */
	brainInstructions?: string | null;
}): McpServer {
	const skills = ctx.skills ?? null;
	const rules = ctx.rules ?? null;
	const instructions = [
		ctx.brainInstructions,
		skills ? SKILL_INSTRUCTIONS : null,
	]
		.filter((text): text is string => Boolean(text))
		.join("\n\n");
	const server = new McpServer(
		{ name: "innovas-brain", version: "1.0.0" },
		instructions ? { instructions } : undefined,
	);
	const contract = brainContract(ctx.categories, { canon: ctx.canon });

	// kind null: la tool cuenta su uso adentro (brain_upsert).
	async function run(
		kind: "read" | "write" | null,
		work: () => Promise<Record<string, unknown>>,
	) {
		try {
			if (kind) await ctx.limiter.check(kind);
			return result(await work());
		} catch (error) {
			if (error instanceof BrainError)
				return result({ ...toToolError(error) }, true);
			const errorId = crypto.randomUUID();
			console.error(`brain mcp: error interno ${errorId}`, error);
			return result(
				{
					ok: false,
					error: "internal",
					message: `Error interno (${errorId}).`,
					errorId,
				},
				true,
			);
		}
	}

	server.registerTool(
		BRAIN_TOOL_NAMES.search,
		{
			description: contract.search.description,
			inputSchema: contract.search.input,
		},
		async (input) =>
			run("read", async () => ({
				ok: true,
				results: await ctx.provider.search(input),
			})),
	);

	server.registerTool(
		BRAIN_TOOL_NAMES.read,
		{
			description: contract.read.description,
			inputSchema: contract.read.input,
		},
		async ({ slug }) =>
			run("read", async () => {
				const page = await ctx.provider.read(slug);
				if (!rules) return { ok: true, page };
				return {
					ok: true,
					page,
					rules: withoutRoot(await rules.cascade(slug)),
				};
			}),
	);

	if (rules) {
		server.registerTool(
			BRAIN_TOOL_NAMES.rules,
			{
				description: contract.rules.description,
				inputSchema: contract.rules.input,
			},
			async ({ path }) =>
				run("read", async () => ({
					ok: true,
					rules: await rules.cascade(path),
				})),
		);
	}

	server.registerTool(
		BRAIN_TOOL_NAMES.upsert,
		{
			description: contract.upsert.description,
			inputSchema: contract.upsert.input,
		},
		async (input) =>
			run(null, async () => {
				let write: BrainWrite = input;
				if (rules) {
					try {
						write = await requireRules(rules, input);
					} catch (error) {
						// Un rechazo por reglas es parte del flujo: entrega las reglas y
						// cuenta como lectura, no como escritura (spec etapa 26 §4.3).
						await ctx.limiter.check(
							error instanceof BrainRulesRequired ? "read" : "write",
						);
						throw error;
					}
				}
				await ctx.limiter.check("write");
				if (
					new TextEncoder().encode(write.body).length >
					MCP_MAX_UPSERT_BODY_BYTES
				) {
					throw new BrainValidation(["body"]);
				}
				const written = await ctx.provider.upsert(write, {
					kind: "user",
					userId: ctx.userId,
				});
				return { ok: true, ...written };
			}),
	);

	if (skills) {
		server.registerTool(
			SKILL_TOOL_NAMES.list,
			{
				description:
					"Lista las skills de la empresa que podés usar, con su descripción y versión publicada.",
			},
			async () =>
				run("read", async () => ({ ok: true, skills: skills.list() })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.load,
			{
				description: `${SKILL_LOAD_INTRO}\n${describeSkills(skills.list())}`,
				inputSchema: { name: z.string().min(1).max(64) },
			},
			async ({ name }) =>
				run("read", async () => ({ ok: true, ...(await skills.load(name)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.file,
			{
				description:
					"Lee un archivo de texto de una skill ya cargada, por la ruta que figura en la lista de archivos de skill_load. Los binarios y los archivos de más de 256 KB no se leen desde acá: vienen en el paquete de skill_package.",
				inputSchema: {
					name: z.string().min(1).max(64),
					path: z.string().min(1).max(200),
				},
			},
			async ({ name, path }) =>
				run("read", async () => ({
					ok: true,
					...(await skills.file(name, path)),
				})),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.package,
			{
				description: SKILL_PACKAGE_DESCRIPTION,
				inputSchema: { name: z.string().min(1).max(64) },
			},
			async ({ name }) =>
				run("read", async () => ({
					ok: true,
					...(await skills.package(name)),
				})),
		);
	}

	return server;
}
