// Reglas del paquete de una skill (spec etapa 24.1 §5). Puro, sin dependencias.

export const SKILL_CATEGORY = "skill";
export const SKILLS_PREFIX = "skills/";
export const MAX_SKILL_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_COMPATIBILITY = 500;
export const MAX_FILE_BYTES = 4_194_304;
export const MAX_ZIP_BYTES = MAX_FILE_BYTES;
export const MAX_PACKAGE_BYTES = 20_971_520;
export const MAX_PACKAGE_FILES = 50;
export const MAX_FILE_PATH = 200;
export const LONG_BODY_LINES = 500;

// Tramos sin espacios que no empiezan con punto: deja afuera ".", ".." y los
// ocultos. Hasta seis niveles.
const FILE_PATH_PATTERN =
	/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,5}$/;

export interface SkillFile {
	path: string;
	sha256: string;
	size: number;
}

export function isSkillSlug(slug: string): boolean {
	return slug.startsWith(SKILLS_PREFIX);
}

export function skillName(slug: string): string {
	return slug.slice(slug.lastIndexOf("/") + 1);
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): boolean {
	return name.length <= MAX_SKILL_NAME && SKILL_NAME_PATTERN.test(name);
}

// La carpeta es relativa a skills/: se recortan espacios y barras de los
// extremos y un "skills/" al principio se descarta. "" es directo bajo skills/.
export function normalizeSkillFolder(raw: string | undefined): string {
	return (raw ?? "")
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.replace(/^skills(\/|$)/, "")
		.replace(/^\/+|\/+$/g, "");
}

export function isValidSkillFolder(folder: string): boolean {
	return folder === "" || folder.split("/").every(isValidSkillName);
}

export function isValidFilePath(path: string): boolean {
	return (
		path.length <= MAX_FILE_PATH &&
		FILE_PATH_PATTERN.test(path) &&
		// SKILL.md es la página, no un archivo del paquete.
		path.toLowerCase() !== "skill.md"
	);
}

// Una página es skill si y solo si tiene la categoría y está bajo skills/
// (spec S3). Como el slug no cambia, tampoco puede salir de la categoría.
export function skillPlacementOk(slug: string, category: string): boolean {
	return (category === SKILL_CATEGORY) === isSkillSlug(slug);
}

// Las tools del brain no anuncian la categoría skill a un asistente. Si es la
// única, se deja: el contrato exige al menos una, y el envoltorio igual
// rechaza todo lo que esté bajo skills/.
export function assistantCategories(categories: string[]): string[] {
	const rest = categories.filter((category) => category !== SKILL_CATEGORY);
	return rest.length > 0 ? rest : categories;
}

export type PublishProblem =
	| "description_missing"
	| "description_too_long"
	| "compatibility_too_long"
	| "name_too_long"
	| "too_many_files"
	| "package_too_big";
export type PublishWarning = "long_body";

export const PUBLISH_MESSAGES: Record<PublishProblem | PublishWarning, string> =
	{
		description_missing:
			"Falta la descripción: es lo que le dice al asistente cuándo usar la skill.",
		description_too_long: "La descripción supera los 1024 caracteres.",
		compatibility_too_long: "El campo compatibility supera los 500 caracteres.",
		name_too_long:
			"El nombre (último tramo de la ruta) supera los 64 caracteres.",
		too_many_files: "El paquete tiene más de 50 archivos.",
		package_too_big: "El paquete pesa más de 20 MB.",
		long_body:
			"El texto tiene más de 500 líneas. Conviene pasar el detalle a archivos de referencia.",
	};

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function checkPublishable(input: {
	slug: string;
	frontmatter: Record<string, unknown>;
	body: string;
	files: SkillFile[];
}): { problems: PublishProblem[]; warnings: PublishWarning[] } {
	const problems: PublishProblem[] = [];
	const warnings: PublishWarning[] = [];

	const description = text(input.frontmatter.description);
	if (description.length === 0) problems.push("description_missing");
	else if (description.length > MAX_DESCRIPTION)
		problems.push("description_too_long");
	if (text(input.frontmatter.compatibility).length > MAX_COMPATIBILITY)
		problems.push("compatibility_too_long");
	if (skillName(input.slug).length > MAX_SKILL_NAME)
		problems.push("name_too_long");
	if (input.files.length > MAX_PACKAGE_FILES) problems.push("too_many_files");
	if (
		input.files.reduce((total, file) => total + file.size, 0) >
		MAX_PACKAGE_BYTES
	)
		problems.push("package_too_big");

	if (input.body.split("\n").length > LONG_BODY_LINES)
		warnings.push("long_body");

	return { problems, warnings };
}
