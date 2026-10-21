// Advertencias del alta: la empresa quedó creada pero algo no transaccional
// falló. Viajan en la URL hacia el detalle; ese lado solo muestra las de esta
// lista, para que un link armado a mano no pueda poner texto propio en la
// caja de avisos.
export const LOGO_WARNING =
	"No se pudo subir el logo. Subilo desde esta pantalla.";
export const INVITE_WARNING =
	"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.";
export const MODELS_WARNING =
	"No se pudieron cargar los modelos más nuevos. Revisá los modelos permitidos en esta pantalla.";

const KNOWN: readonly string[] = [LOGO_WARNING, INVITE_WARNING, MODELS_WARNING];

export function knownWarnings(values: string[]): string[] {
	return [...new Set(values.filter((value) => KNOWN.includes(value)))];
}
