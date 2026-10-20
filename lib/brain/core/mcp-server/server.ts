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
import type { SkillDrafts } from "../skills/draft.ts";
import { rejectSkillWrite } from "../skills/view.ts";
import {
	type BrainProvider,
	type BrainWrite,
	MAX_SLUG_LENGTH,
} from "../types.ts";
import type { BrainManage } from "./manage.ts";
import { MAX_DELETE_PER_CALL, MAX_FOLDERS_PER_CALL } from "./manage.ts";
import type { RateLimiter } from "./rate-limit.ts";

export const MCP_MAX_REQUEST_BYTES = 1_048_576;
export const MCP_MAX_UPSERT_BODY_BYTES = 102_400;

export const SKILL_TOOL_NAMES = {
	list: "skill_list",
	load: "skill_load",
	file: "skill_file",
	package: "skill_package",
	draftRead: "skill_draft_read",
	draftEdit: "skill_draft_edit",
	draftWriteFile: "skill_draft_write_file",
	create: "skill_create",
} as const;

const SKILL_INSTRUCTIONS =
	"Esta empresa publica skills: procedimientos revisados para hacer una tarea a su manera. Antes de una tarea que coincida con una skill de la lista de skill_load, cargala con skill_load y seguí sus instrucciones. Los archivos de texto de una skill se leen con skill_file. Si la skill trae scripts y tu entorno puede ejecutar código y bajar archivos, pedí el paquete completo con skill_package. Si no puede, seguí las instrucciones con lo que tengas y avisale a la persona que hay un script que no pudiste correr.";

const SKILL_PACKAGE_DESCRIPTION =
	"Devuelve un link de descarga que vence en 10 minutos con el paquete completo de una skill (zip con SKILL.md, scripts y binarios), siempre en su última versión publicada. Bajalo a una carpeta temporal, descomprimilo y corré los scripts desde ahí; no lo instales en tu carpeta de skills: esa copia queda vieja cuando la empresa publica una versión nueva; pedilo de nuevo en cada sesión. Si el link venció, pedí otro. Si tu entorno no puede bajar archivos, seguí con skill_load y skill_file y avisale a la persona.";

const SKILL_LOAD_INTRO =
	"Carga una skill de la empresa: devuelve sus instrucciones y la lista de sus archivos. Usala antes de empezar una tarea que coincida con alguna de estas skills, sin esperar a que te lo pidan. Skills disponibles:";

const DRAFT_INSTRUCTIONS =
	"Podés crear y editar skills de esta empresa con skill_create, skill_draft_edit y skill_draft_write_file. Esas tools cambian el BORRADOR, no lo que usan los demás: un administrador revisa y publica desde la plataforma. Para ver tu cambio leé el borrador con skill_draft_read. Antes de editar, leé el texto con skill_draft_read y copiá el fragmento exacto. Después de cambiar algo, avisale a la persona que quedó en borrador y pasale el reviewUrl.";

// Solo si skill_load y skill_file están registradas: no se nombran tools que no existen.
const DRAFT_PUBLISHED_NOTE =
	"skill_load y skill_file siguen devolviendo lo publicado, no el borrador.";

export const MANAGE_TOOL_NAMES = {
	createFolders: "brain_folder_create",
	delete: "brain_delete",
} as const;

const MANAGE_INSTRUCTIONS =
	"Administrás carpetas de este brain: podés crear carpetas con brain_folder_create y borrar páginas con brain_delete. Hacelo solo cuando la persona te lo pide con nombres explícitos; el borrado no tiene papelera ni deshacer.";

const FOLDER_CREATE_DESCRIPTION = `Crea carpetas del brain donde administrás la carpeta de arriba. Pasá la estructura completa que la persona quiere armar, con las carpetas intermedias que falten (por ejemplo marketing/marca y marketing/marca/identidad-visual): se crean padre primero, hasta ${MAX_FOLDERS_PER_CALL} por llamada, y cada una informa su resultado. Usala cuando la persona ya sabe qué estructura quiere; después escribí las páginas con brain_upsert. Los nombres van en minúsculas, con guiones y sin espacios.`;

const DELETE_DESCRIPTION = `BORRA páginas del brain, sin papelera ni deshacer; los links que las apuntaban quedan como texto. Llamala solo si la persona pidió el borrado nombrando la página o la carpeta ("borrá la página X", "borrá todas las páginas de la carpeta Y"); para retirar algo sin que lo pida, usá status archivado con brain_upsert. Con slug borra esa página. Con folder borra las páginas de esa carpeta, no la carpeta; las de sus subcarpetas solo con includeSubfolders: true, que solo va si la persona pidió también lo de adentro. Solo borra lo que administrás: lo demás vuelve en skipped con el motivo. Las 00-reglas y 00-plantilla se borran solo nombrándolas por slug; las skills no se borran por acá. Hasta ${MAX_DELETE_PER_CALL} páginas por llamada: si queda remaining, avisale a la persona y seguí con el mismo folder.`;

const FOLDER_MISSING_NOTE =
	"Si administrás la carpeta de arriba, creala con brain_folder_create (pasá también las carpetas intermedias que falten); si no, pedile a un administrador que la cree.";

const MAX_LISTED_FOLDERS = 20;

// Quien solo administra carpetas puntuales de skills no puede crear directo en
// skills/: se le dice dónde sí, en la descripción de la tool.
function creatableNote(folders: string[] | undefined): string {
	if (!folders || folders.includes("")) return "";
	if (folders.length === 0) {
		return " No tenés carpetas donde crear skills nuevas.";
	}
	const shown = folders.slice(0, MAX_LISTED_FOLDERS).join(", ");
	return ` Vos podés crear solo en estas carpetas, y tenés que pasar una en folder: ${shown}.`;
}

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
	/** Tools para crear y editar el borrador de skills; solo para quien edita. */
	skillDrafts?: SkillDrafts | null;
	/** Reglas que ve la persona (spec etapa 26 §4.3). Sin esto, ni brain_rules ni rules en brain_read. */
	rules?: RulesSource | null;
	/** Instrucciones del brain y carpetas, para el campo instructions. */
	brainInstructions?: string | null;
	/** Crear carpetas y borrar páginas; solo para quien administra algo. */
	manage?: BrainManage | null;
}): McpServer {
	const skills = ctx.skills ?? null;
	const drafts = ctx.skillDrafts ?? null;
	const rules = ctx.rules ?? null;
	const manage = ctx.manage ?? null;
	const instructions = [
		ctx.brainInstructions,
		skills ? SKILL_INSTRUCTIONS : null,
		drafts
			? [DRAFT_INSTRUCTIONS, skills ? DRAFT_PUBLISHED_NOTE : null]
					.filter((text): text is string => text !== null)
					.join(" ")
			: null,
		manage ? MANAGE_INSTRUCTIONS : null,
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
			description: manage
				? `${contract.upsert.description} Si la carpeta no existe, ${FOLDER_MISSING_NOTE}`
				: contract.upsert.description,
			inputSchema: contract.upsert.input,
		},
		async (input) =>
			run(null, async () => {
				let write: BrainWrite = input;
				if (rules) {
					try {
						// Antes que las reglas: una skill se rechaza como skill.
						rejectSkillWrite(input);
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
				try {
					const written = await ctx.provider.upsert(write, {
						kind: "user",
						userId: ctx.userId,
					});
					return { ok: true, ...written };
				} catch (error) {
					// Quien administra puede crear la carpeta que falta: se lo dice.
					if (
						manage &&
						error instanceof BrainValidation &&
						error.fields.includes("folder")
					) {
						throw new BrainValidation(
							error.fields,
							`${error.message.replace(" Pedile a un administrador que la cree.", "")} ${FOLDER_MISSING_NOTE}`,
						);
					}
					throw error;
				}
			}),
	);

	if (manage) {
		server.registerTool(
			MANAGE_TOOL_NAMES.createFolders,
			{
				description: FOLDER_CREATE_DESCRIPTION,
				inputSchema: {
					folders: z
						.array(
							z.object({
								path: z
									.string()
									.min(1)
									.max(MAX_SLUG_LENGTH)
									.describe("Ruta de la carpeta, por ejemplo marketing/marca."),
								description: z.string().max(300).optional(),
							}),
						)
						.min(1)
						.max(MAX_FOLDERS_PER_CALL),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
				},
			},
			async (input) =>
				run("write", async () => ({
					ok: true,
					...(await manage.createFolders(input)),
				})),
		);

		server.registerTool(
			MANAGE_TOOL_NAMES.delete,
			{
				description: DELETE_DESCRIPTION,
				inputSchema: {
					slug: z.string().min(1).max(MAX_SLUG_LENGTH).optional(),
					folder: z.string().min(1).max(MAX_SLUG_LENGTH).optional(),
					includeSubfolders: z.boolean().optional(),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
				},
			},
			async (input) =>
				run("write", async () => ({
					ok: true,
					...(await manage.delete(input)),
				})),
		);
	}

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

	if (drafts) {
		const SKILL_REF = z.string().min(1).max(200);
		const WRITES = {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
		};
		// Reemplaza el contenido de un archivo sin historial.
		const OVERWRITES = { ...WRITES, destructiveHint: true };

		server.registerTool(
			SKILL_TOOL_NAMES.draftRead,
			{
				description:
					"Lee el BORRADOR de una skill que podés editar (no la versión publicada): sin path devuelve el SKILL.md completo con su encabezado, la revisión, el estado de publicación y la lista de archivos; con path, un archivo de texto. La skill se nombra por nombre o por ruta completa (skills/…).",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200).optional(),
				},
				annotations: { readOnlyHint: true },
			},
			async (input) =>
				run("read", async () => ({ ok: true, ...(await drafts.read(input)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.draftEdit,
			{
				description:
					"Cambia el BORRADOR de una skill reemplazando un fragmento: `old` tiene que aparecer exactamente una vez y se cambia por `new`. Sin path edita el SKILL.md (encabezado o cuerpo); con path, un archivo de texto del paquete. No publica: un administrador lo hace desde la plataforma. El motivo queda en el historial cuando el cambio es en el SKILL.md.",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200).optional(),
					old: z.string().min(1).max(102_400),
					new: z.string().max(102_400),
					reason: z.string().min(1).max(200),
				},
				annotations: WRITES,
			},
			async (input) =>
				run("write", async () => ({ ok: true, ...(await drafts.edit(input)) })),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.draftWriteFile,
			{
				description:
					"Crea o reemplaza un archivo de texto (script, referencia, plantilla) en el BORRADOR de una skill, de hasta 256 KB. No sirve para el SKILL.md: ese se cambia con skill_draft_edit. No publica.",
				inputSchema: {
					skill: SKILL_REF,
					path: z.string().min(1).max(200),
					content: z.string().max(262_144),
				},
				annotations: OVERWRITES,
			},
			async (input) =>
				run("write", async () => ({
					ok: true,
					...(await drafts.writeFile(input)),
				})),
		);

		server.registerTool(
			SKILL_TOOL_NAMES.create,
			{
				description: `Crea una skill nueva como BORRADOR en skills/<folder>/<name> (\`folder\` va sin el prefijo skills/, tiene que existir y es opcional: sin folder queda directo en skills/). \`description\` dice cuándo conviene usarla; \`instructions\` es el cuerpo del SKILL.md. Nadie más la ve hasta que un administrador la publique desde la plataforma. Los archivos se agregan después con skill_draft_write_file.${creatableNote(drafts.creatableFolders)}`,
				inputSchema: {
					name: z.string().min(1).max(64),
					folder: z.string().min(1).max(150).optional(),
					title: z.string().min(1).max(300).optional(),
					description: z.string().min(1).max(1024),
					instructions: z.string().min(1).max(102_400),
					compatibility: z.string().max(500).optional(),
					reason: z.string().min(1).max(200),
				},
				annotations: WRITES,
			},
			async (input) =>
				run("write", async () => ({
					ok: true,
					...(await drafts.create(input)),
				})),
		);
	}

	return server;
}
