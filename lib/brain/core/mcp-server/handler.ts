// Request al endpoint del brain (spec etapa 11 §5.1, §5.2). Stateless: un
// servidor y un transporte por request, con respuesta JSON.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	isAdminRole,
	type Principal,
} from "../access/types.ts";
import { withAccess } from "../access/with-access.ts";
import type { PageDeleter } from "../delete-store.ts";
import { BrainNotFound } from "../errors.ts";
import type { FolderWriter } from "../folders-store.ts";
import type { BrainBinding } from "../resolve.ts";
import {
	EMPTY_RULES,
	type RulesSource,
	seesBrain,
	withoutSkillRules,
	withRulesAccess,
} from "../rules-source.ts";
import { formatBrainSession } from "../session.ts";
import {
	loadSkillCatalog,
	type SkillCatalog,
	type SkillLoadRecord,
} from "../skills/catalog.ts";
import {
	canEditSkills,
	creatableSkillFolders,
	createSkillDrafts,
	type SkillDrafts,
} from "../skills/draft.ts";
import type { BlobStore } from "../skills/files.ts";
import { assistantCategories, SKILL_CATEGORY } from "../skills/package.ts";
import type { PackageLink, PackageRequest } from "../skills/package-link.ts";
import type { SkillOverviewRow, SkillStore } from "../skills/store.ts";
import { withoutSkills } from "../skills/view.ts";
import type { BrainProvider } from "../types.ts";
import {
	type AccessStore,
	type ClaimsVerifier,
	resolveMcpAccess,
} from "./access.ts";
import {
	administersAnything,
	type BrainManage,
	createBrainManage,
} from "./manage.ts";
import { createRateLimiter, type HitFn } from "./rate-limit.ts";
import { buildBrainMcpServer, MCP_MAX_REQUEST_BYTES } from "./server.ts";

// Forma mínima de createUnauthorizedResponse de eve. La plataforma inyecta la
// real; core solo conoce esta firma.
export interface UnauthorizedOptions {
	code: string;
	message: string;
	challenges: {
		scheme: "Bearer";
		parameters: Record<string, string>;
	}[];
}

export interface McpSkillsDeps {
	overview(tenantId: string): Promise<SkillOverviewRow[]>;
	blob(tenantId: string, sha256: string): Promise<Uint8Array | null>;
	record(
		entry: SkillLoadRecord & { tenantId: string; userId: string },
	): Promise<void>;
	issue(request: Omit<PackageRequest, "channel">): Promise<PackageLink>;
	/** Para crear y editar el borrador (spec 24.5). Sin esto no hay esas tools. */
	edit?: { store: SkillStore; blobs: BlobStore };
}

export interface McpManageDeps {
	folders: FolderWriter;
	deleter: PageDeleter;
}

export interface BrainMcpDeps {
	verify: ClaimsVerifier;
	store: AccessStore;
	rules: AccessRulesStore;
	hit: HitFn;
	provider: (binding: BrainBinding) => BrainProvider;
	/** Reglas del brain (spec etapa 26 §4.3). Sin esto, ninguna. */
	brainRules?: (binding: BrainBinding) => RulesSource;
	/** Si la empresa tiene un agente que usa el canon comercial del brain. */
	usesCanon: (tenantId: string) => Promise<boolean>;
	/** Skills publicadas de la empresa (spec 24.2a). */
	skills: McpSkillsDeps;
	/** Crear carpetas y borrar páginas (reemplaza D1 de la 18.1). Sin esto no hay esas tools. */
	manage?: McpManageDeps;
	publicUrl: string;
	/**
	 * El pedido llegó por el dominio de una empresa: el recurso es /brain/mcp,
	 * sin slug (spec 21.6 H14). Sin esto, la forma con slug de siempre.
	 */
	tenantHost?: boolean;
	/** ¿Este host puede servir a esa empresa? Sin esto no se valida (host raíz). */
	hostServes?: (slug: string) => boolean;
	issuer: string;
	unauthorized: (options: UnauthorizedOptions) => Response;
}

function resourceUrl(publicUrl: string, slug: string, tenantHost?: boolean) {
	return tenantHost
		? `${publicUrl}/brain/mcp`
		: `${publicUrl}/brain/${slug}/mcp`;
}

// A dónde mandar a la persona a revisar el borrador: la pantalla de la skill.
function skillReviewUrl(
	publicUrl: string,
	tenantSlug: string,
	skillSlug: string,
	tenantHost?: boolean,
) {
	return tenantHost
		? `${publicUrl}/brain/p/${skillSlug}`
		: `${publicUrl}/${tenantSlug}/brain/p/${skillSlug}`;
}

function metadataUrl(publicUrl: string, slug: string, tenantHost?: boolean) {
	return tenantHost
		? `${publicUrl}/.well-known/oauth-protected-resource/brain/mcp`
		: `${publicUrl}/.well-known/oauth-protected-resource/brain/${slug}/mcp`;
}

export function protectedResourceMetadata(
	slug: string,
	deps: Pick<BrainMcpDeps, "publicUrl" | "issuer" | "tenantHost">,
) {
	return {
		resource: resourceUrl(deps.publicUrl, slug, deps.tenantHost),
		authorization_servers: [deps.issuer],
		bearer_methods_supported: ["header"],
	};
}

function tooLarge(): Response {
	return Response.json(
		{ ok: false, code: "payload_too_large", error: "El pedido supera 1 MiB." },
		{ status: 413 },
	);
}

async function readLimited(request: Request): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MCP_MAX_REQUEST_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function handleBrainMcpInner(
	request: Request,
	slug: string,
	deps: BrainMcpDeps,
): Promise<Response> {
	// Antes que nada: el dominio de una empresa solo sirve a esa empresa. El
	// cuerpo es el mismo que "no existe ese cliente", para que no se distinga.
	if (deps.hostServes && !deps.hostServes(slug)) {
		return Response.json(
			{ ok: false, code: "tenant_not_found", error: "No existe ese cliente." },
			{ status: 404 },
		);
	}

	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MCP_MAX_REQUEST_BYTES) return tooLarge();

	const access = await resolveMcpAccess(
		{ authorization: request.headers.get("authorization"), slug },
		{ verify: deps.verify, store: deps.store },
	);
	if (!access.ok) {
		if (access.status === 401) {
			return deps.unauthorized({
				code: access.code,
				message: access.message,
				challenges: [
					{
						scheme: "Bearer",
						parameters: {
							resource_metadata: metadataUrl(
								deps.publicUrl,
								slug,
								deps.tenantHost,
							),
							...(access.code === "invalid_token"
								? { error: "invalid_token" }
								: {}),
						},
					},
				],
			});
		}
		return Response.json(
			{ ok: false, code: access.code, error: access.message },
			{ status: access.status },
		);
	}

	const text = await readLimited(request);
	if (text === null) return tooLarge();
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(text);
	} catch {
		return Response.json(
			{ ok: false, code: "invalid_json", error: "El cuerpo no es JSON." },
			{ status: 400 },
		);
	}

	// Solo un miembro común depende de las reglas: para un administrador no se
	// consultan. Si no se pueden cargar, la excepción llega al 500 de abajo: se
	// falla cerrado en vez de tratarlo como "sin reglas".
	const rules = isAdminRole(access.role)
		? []
		: await deps.rules.load(access.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: access.userId,
		role: access.role,
	};
	// withoutSkills por fuera de withAccess: ni un administrador ve skills por
	// las tools del brain (spec 24.1 S6). Las skills salen por su catálogo y, para
	// quien las edita, por skill_draft_* (spec 24.5), que usa el proveedor sin
	// esa guardia y solo adentro de draft.ts.
	const accessProvider = withAccess(
		deps.provider(access.binding),
		principal,
		rules,
	);
	const provider = withoutSkills(accessProvider);

	// El overview se pide una sola vez por request.
	let overviewRows: Promise<SkillOverviewRow[]> | null = null;
	const overview = () => {
		overviewRows ??= deps.skills.overview(access.tenantId);
		return overviewRows;
	};

	// Las reglas se filtran por lo que la persona ve (spec etapa 26 §4.2). Un
	// brain mcp tiene la fuente vacía (D15).
	const levelOf = (path: string) => resolveAccess(rules, principal, path);
	// withoutSkillRules por fuera, como withoutSkills: ni un administrador ve
	// las reglas de skills/ por las tools del brain.
	const visibleRules = withoutSkillRules(
		withRulesAccess(deps.brainRules?.(access.binding) ?? EMPTY_RULES, levelOf),
	);
	// Las instrucciones de la raíz le llegan a quien ve alguna parte del brain.
	const seesSomeBrain = seesBrain(rules, levelOf);
	// Si no se pueden leer, el servidor arranca sin el bloque: las reglas igual
	// llegan en brain_read, brain_rules y el rechazo de brain_upsert.
	// Stateless: instructions solo viaja en la respuesta a initialize, así que
	// el bloque se arma solo en ese request y no en cada tools/call.
	let brainInstructions: string | null = null;
	if (access.binding.provider === "wiki" && isInitialize(parsedBody)) {
		try {
			const context = await visibleRules.session();
			brainInstructions = formatBrainSession(
				seesSomeBrain ? context : { ...context, root: null },
			);
		} catch (error) {
			console.error(
				"brain mcp: no pude leer las instrucciones del brain",
				error,
			);
		}
	}

	// Solo el brain propio tiene skills (S13). Si no se pueden leer, el
	// servidor se arma sin ellas: las tools del brain no dependen de las skills.
	let skills: SkillCatalog | null = null;
	if (access.binding.provider === "wiki") {
		try {
			skills = await loadSkillCatalog({
				overview,
				levelOf: (slug) => resolveAccess(rules, principal, slug),
				blob: (sha256) => deps.skills.blob(access.tenantId, sha256),
				record: (entry) =>
					deps.skills.record({
						...entry,
						tenantId: access.tenantId,
						userId: access.userId,
					}),
				issue: (entry) =>
					deps.skills.issue({
						tenantId: access.tenantId,
						userId: access.userId,
						slug: entry.slug,
						snapshot: entry.snapshot,
					}),
			});
		} catch (error) {
			console.error("brain mcp: no pude leer las skills", error);
		}
	}

	// Solo quien puede editar algo bajo skills/, con la categoría habilitada.
	let skillDrafts: SkillDrafts | null = null;
	const editDeps = deps.skills.edit;
	if (
		editDeps &&
		access.binding.provider === "wiki" &&
		access.binding.config.categories.includes(SKILL_CATEGORY)
	) {
		try {
			if (canEditSkills(rules, principal, await overview())) {
				skillDrafts = createSkillDrafts({
					tenantSlug: slug,
					creatableFolders: creatableSkillFolders(rules, principal),
					levelOf: (path) => resolveAccess(rules, principal, path),
					reviewUrl: (skillSlug) =>
						skillReviewUrl(deps.publicUrl, slug, skillSlug, deps.tenantHost),
					files: {
						actor: async () => ({
							tenantId: access.tenantId,
							userId: access.userId,
							role: access.role,
						}),
						binding: async () => ({ provider: "wiki" }),
						rules: { load: async () => rules },
						page: async (_tenantId, skillSlug) => {
							try {
								return await accessProvider.read(skillSlug, {
									suggestions: false,
								});
							} catch (error) {
								if (error instanceof BrainNotFound) return null;
								throw error;
							}
						},
						save: (_actor, write) =>
							accessProvider.upsert(write, {
								kind: "user",
								userId: access.userId,
							}),
						store: editDeps.store,
						blobs: editDeps.blobs,
					},
				});
			}
		} catch (error) {
			console.error("brain mcp: no pude armar la edición de skills", error);
		}
	}

	// Solo quien administra algo, en un brain propio. El permiso fino lo decide
	// cada operación, con las mismas reglas que la web.
	let manage: BrainManage | null = null;
	if (
		deps.manage &&
		access.binding.provider === "wiki" &&
		administersAnything(rules, principal)
	) {
		const raw = deps.provider(access.binding);
		manage = createBrainManage({
			tenantSlug: slug,
			actor: {
				tenantId: access.tenantId,
				userId: access.userId,
				role: access.role,
			},
			rules,
			bindingId: access.binding.id,
			pages: () => raw.list(),
			folders: deps.manage.folders,
			deleter: deps.manage.deleter,
		});
	}

	const server = buildBrainMcpServer({
		userId: access.userId,
		categories: assistantCategories(access.binding.config.categories),
		canon: await deps.usesCanon(access.tenantId),
		provider,
		skills,
		skillDrafts,
		manage,
		rules: visibleRules,
		brainInstructions,
		limiter: createRateLimiter({
			tenantId: access.tenantId,
			userId: access.userId,
			limits: access.binding.config.mcpLimits,
			hit: deps.hit,
		}),
	});
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, { parsedBody });
	} finally {
		await server.close();
	}
}

// El cuerpo puede ser un mensaje JSON-RPC o un lote.
function isInitialize(body: unknown): boolean {
	return (Array.isArray(body) ? body : [body]).some(
		(message) =>
			typeof message === "object" &&
			message !== null &&
			(message as { method?: unknown }).method === "initialize",
	);
}

export async function handleBrainMcp(
	request: Request,
	slug: string,
	deps: BrainMcpDeps,
): Promise<Response> {
	try {
		return await handleBrainMcpInner(request, slug, deps);
	} catch (error) {
		const errorId = crypto.randomUUID();
		console.error(`brain mcp: error interno ${errorId}`, error);
		return Response.json(
			{ ok: false, code: "internal", error: `Error interno (${errorId}).` },
			{ status: 500 },
		);
	}
}
