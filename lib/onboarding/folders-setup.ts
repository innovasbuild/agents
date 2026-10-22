// Arma el brain de una empresa nueva con las carpetas que confirmó la persona
// (spec 27 §5.3): conexión wiki, carpetas con descripción, skills, carpetas
// restringidas, instrucciones de la raíz y la primera página de la empresa.
// Los efectos entran por `deps` (rpc con service role y escritura de páginas).
// Imports relativos: lo usan módulos de eve.
import { createHash } from "node:crypto";
import type { BrainAuthor } from "../brain/core/types";

export interface ConfirmedFolder {
	slug: string;
	name: string;
	description: string;
	restricted: boolean;
}

export interface FoldersSetupDeps {
	rpc(
		fn: string,
		args: Record<string, unknown>,
	): Promise<{ error: { message: string; code?: string } | null }>;
	/** Ignora BrainConflict: una página que ya existe se deja como está. */
	upsertPage(
		write: {
			slug: string;
			title: string;
			body: string;
			status: "borrador";
		},
		author: BrainAuthor,
	): Promise<void>;
}

export type FoldersSetupResult =
	| { ok: true }
	| {
			ok: false;
			step: "bind" | "folders" | "skills" | "rules" | "page";
			message: string;
	  };

export const ROOT_RULES_BODY = `Cada página empieza con un párrafo que dice para qué sirve. Si la página no lo tiene, el primer paso es escribirlo.

# Cómo se trabaja con este brain

- Antes de responder sobre la empresa, leé lo que dice el brain. Si no está escrito, decilo: no lo inventes.
- Citá siempre la página de donde sale cada dato, con su nombre, para que quien lee pueda ir a verificarlo.
- Si dos páginas se contradicen, mostrá las dos y avisá. No elijas una en silencio.
- Una página nueva va en la carpeta que corresponde al tema. Si no hay una carpeta clara, preguntá antes de crear una.
- Escribí en castellano rioplatense, con frases cortas y sin lenguaje de consultora.
- Los datos sensibles (sueldos, contratos, números de la dirección) solo se usan con quien ya los puede ver: respetá lo que dice cada carpeta.
- Las páginas nuevas quedan en borrador hasta que una persona las revisa y las activa.
`;

const COMPANY_PAGE_FOOTER =
	"_Escrita por Central IA al crear la empresa. Corregila._";

/** La primera carpeta que habla de la empresa o de la dirección; si no hay, la primera. */
export function companyFolderOf(folders: ConfirmedFolder[]): string {
	const found = folders.find(
		(f) => f.slug.includes("empresa") || f.slug.includes("direccion"),
	);
	return (found ?? folders[0]).slug;
}

const sha = (body: string) => createHash("sha256").update(body).digest("hex");

export async function setupBrainFolders(
	input: {
		tenantId: string;
		actorUserId: string;
		displayName: string;
		folders: ConfirmedFolder[];
		companySummary: string | null;
	},
	deps: FoldersSetupDeps,
): Promise<FoldersSetupResult> {
	const { tenantId, actorUserId, folders } = input;
	type Step = Extract<FoldersSetupResult, { ok: false }>["step"];

	const rpc = async (
		step: Step,
		fn: string,
		args: Record<string, unknown>,
	): Promise<FoldersSetupResult | null> => {
		try {
			const { error } = await deps.rpc(fn, args);
			if (!error) return null;
			console.error("alta:", fn, tenantId, error);
			return { ok: false, step, message: `${fn}: ${error.message}` };
		} catch (error) {
			console.error("alta:", fn, tenantId, error);
			return { ok: false, step, message: `${fn}: falló la llamada` };
		}
	};

	const steps: [Step, string, Record<string, unknown>][] = [
		[
			"bind",
			"platform_bind_connection",
			{
				p_actor: actorUserId,
				p_tenant: tenantId,
				p_capability: "brain",
				p_provider: "wiki",
				p_connector_uids: [],
				p_config: {
					categories: folders.map((f) => f.slug),
					requiredFrontmatter: ["title", "category", "status", "updated"],
					search: "fts",
				},
				p_verified_name: null,
			},
		],
		["folders", "brain_folders_from_config", { p_tenant: tenantId }],
		...folders.map((f): [Step, string, Record<string, unknown>] => [
			"folders",
			"brain_set_folder_description",
			{
				p_tenant: tenantId,
				p_actor: actorUserId,
				p_path: f.slug,
				p_description: f.description,
			},
		]),
		[
			"skills",
			"platform_enable_brain_skills",
			{ p_actor: actorUserId, p_tenant: tenantId },
		],
		...folders
			.filter((f) => f.restricted)
			.map((f): [Step, string, Record<string, unknown>] => [
				"folders",
				"brain_set_access_rule",
				{
					p_tenant_id: tenantId,
					p_path: f.slug,
					p_principal: "members",
					p_user_id: null,
					p_level: "ninguno",
					p_actor: actorUserId,
				},
			]),
	];
	for (const [step, fn, args] of steps) {
		const failed = await rpc(step, fn, args);
		if (failed) return failed;
	}

	const write = async (
		step: "rules" | "page",
		slug: string,
		title: string,
		body: string,
	): Promise<FoldersSetupResult | null> => {
		try {
			await deps.upsertPage(
				{ slug, title, body, status: "borrador" },
				{
					kind: "import",
					userId: actorUserId,
					sourcePath: `plantilla:${slug}`,
					sourceHash: sha(body),
				},
			);
			return null;
		} catch (error) {
			console.error("alta: no pude escribir", slug, tenantId, error);
			return { ok: false, step, message: `No pude escribir ${slug}` };
		}
	};

	const rules = await write(
		"rules",
		"00-reglas",
		"Instrucciones del brain",
		ROOT_RULES_BODY,
	);
	if (rules) return rules;

	const summary = input.companySummary?.trim();
	if (summary) {
		const page = await write(
			"page",
			`${companyFolderOf(folders)}/que-sabemos`,
			`Qué sabemos de ${input.displayName}`,
			`${summary}\n\n${COMPANY_PAGE_FOOTER}`,
		);
		if (page) return page;
	}
	return { ok: true };
}
