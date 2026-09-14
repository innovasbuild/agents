// Contrato del brain (spec brain §3 y §4.2). Solo tipos y constantes.

export type BrainStatus = "activo" | "borrador" | "archivado";

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
	read(slug: string): Promise<BrainPage>;
	upsert(
		write: BrainWrite,
		author: BrainAuthor,
	): Promise<{ slug: string; revision: number }>;
}
