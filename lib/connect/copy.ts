// Copiar al portapapeles sin tirar: el navegador puede negarlo o no tenerlo
// (página sin HTTPS, permiso denegado). Quien llama muestra el resultado.
export async function copyText(
	text: string,
	clipboard: { writeText(text: string): Promise<void> } | undefined,
): Promise<boolean> {
	if (!clipboard) return false;
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
