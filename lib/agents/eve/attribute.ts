/** Un atributo del principal de la sesión, o "" si no es un string. */
export function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}
