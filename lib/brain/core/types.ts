// Contrato del brain (spec brain §3 y §4.2). Solo tipos y constantes.

export type BrainStatus = "activo" | "borrador" | "archivado";

// Rol del usuario en el tenant, tal como lo estampa la plataforma. Es el mismo
// conjunto de literales que TenantRole: el módulo no importa de la plataforma.
export type BrainRole = "platform_admin" | "tenant_admin" | "tenant_member";

export const BRAIN_STATUSES: readonly BrainStatus[] = [
	"activo",
	"borrador",
	"archivado",
];

export const CANON_TAGS = [
	"canon:icp",
	"canon:mensajes",
	"canon:voz",
	"canon:hooks",
	"canon:objeciones",
] as const;

export const SLUG_PATTERN =
	/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;
export const MAX_SLUG_LENGTH = 200;
export const MAX_BODY_BYTES = 204800;

// Páginas con nombre reservado (spec etapa 26 §4.1). 00-reglas en la raíz son
// las instrucciones del brain; en una carpeta, sus reglas. 00-plantilla es la
// plantilla de una carpeta (26.3).
export const RULES_LEAF = "00-reglas";
export const TEMPLATE_LEAF = "00-plantilla";
export const RESERVED_LEAVES = [RULES_LEAF, TEMPLATE_LEAF] as const;
// Categoría de las instrucciones del brain: la carpeta brain está reservada.
export const BRAIN_CATEGORY = "brain";
// En caracteres. La de la raíz entra en cada sesión.
export const MAX_ROOT_RULES_CHARS = 12_000;
export const MAX_FOLDER_RULES_CHARS = 20_000;
export const MAX_CASCADE_CHARS = 40_000;

export interface BrainSearchInput {
	query: string;
	category?: string;
	tag?: string;
	includeArchived?: boolean;
	limit?: number;
}

export interface BrainPageSummary {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	snippet: string;
	updatedAt: string;
}

export interface BrainPage {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number;
	updatedAt: string;
}

// Lo que necesitan el árbol, el índice y el mapa: la página sin cuerpo ni
// frontmatter, que son lo que pesa.
export type BrainPageMeta = Omit<BrainPage, "body" | "frontmatter">;

// Un wikilink tal como está escrito en el cuerpo: sin resolver contra las páginas.
export interface BrainWikilink {
	target: string;
	anchor: string | null;
	alias: string | null;
}

// Los wikilinks de una página, en orden de aparición. Las páginas sin links no
// figuran.
export interface BrainPageLinks {
	slug: string;
	links: BrainWikilink[];
}

export interface BrainRevision {
	revision: number;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	authorKind: "user" | "agent" | "import";
	authorUserId: string | null;
	reason: string;
	createdAt: string;
}

export interface BrainWrite {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter?: Record<string, unknown>;
	body: string;
	reason: string;
	baseRevision?: number;
	/**
	 * Revisión de la cascada de reglas que leyó quien escribe (spec etapa 26
	 * D9). La exigen el MCP y las tools del agente con requireRules; el
	 * proveedor no la mira.
	 */
	rulesRevision?: string;
}

export type BrainAuthor =
	| { kind: "agent"; userId: string | null; sessionId: string }
	| { kind: "user"; userId: string }
	| {
			kind: "import";
			userId: string | null;
			sourcePath: string;
			sourceHash: string;
	  };

export interface BrainProvider {
	search(input: BrainSearchInput): Promise<BrainPageSummary[]>;
	// suggestions: false evita la búsqueda de páginas parecidas cuando no existe
	// (quien solo necesita saber si existe, como la ruta raw, no las usa).
	read(slug: string, options?: { suggestions?: boolean }): Promise<BrainPage>;
	list(): Promise<BrainPage[]>;
	// Lo mismo que list() sin el cuerpo: para pantallas que solo muestran títulos.
	listMeta(): Promise<BrainPageMeta[]>;
	// Los wikilinks de cada página, sacados del cuerpo sin traerlo.
	listLinks(): Promise<BrainPageLinks[]>;
	history(slug: string): Promise<BrainRevision[] | null>;
	upsert(
		write: BrainWrite,
		author: BrainAuthor,
	): Promise<{ slug: string; revision: number }>;
}
