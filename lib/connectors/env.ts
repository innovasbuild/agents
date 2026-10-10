// ¿Corremos en un deploy de Vercel? Ahí hay OIDC y la verificación de
// conectores es obligatoria (spec 21.1 §4). Aparte para poder doblarla en tests.
export function inVercel(): boolean {
	return Boolean(process.env.VERCEL_ENV);
}
