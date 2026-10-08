/**
 * Slug del tenant dueño de la plataforma. Sale solo de la variable de
 * entorno: nada específico de un tenant vive en código. Sin la variable no
 * hay dueño y la consola queda cerrada para todos. Módulo sin dependencias:
 * también lo lee el adaptador del brain, que no debe arrastrar Next.
 */
export function platformOwnerSlug(): string | null {
	const slug = process.env.PLATFORM_OWNER_TENANT_SLUG?.trim();
	return slug ? slug : null;
}
