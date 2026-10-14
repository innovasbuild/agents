// Canal MCP del agente (spec etapa 6). Reusa el emisor OAuth que la Etapa 11
// dejó construido y verificado en producción — el resource cambia, el
// emisor no.
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import { verifyMcpChannelToken } from "../../../lib/agents/mcp-channel-auth";
import { publicSettings } from "../../../lib/brain/adapters/mcp-production";

// Valida y recorta la barra final de PUBLIC_APP_URL y NEXT_PUBLIC_SUPABASE_URL:
// si falta alguna, el módulo explota con un error claro en vez de publicar
// "undefined/eve/...".
const { publicUrl, issuer } = publicSettings();
// El agente "outreach" está nombrado en next.config.ts, así que eve lo monta
// bajo /eve/outreach/v1/* (desde eve 0.58; antes era /eve/agents/outreach/eve/v1/*).
// La reescritura de Vercel solo reenvía ese prefijo, nada de /.well-known/:
// la metadata OAuth la sirve Next.js a mano (app/.well-known/...).
const resource = `${publicUrl}/eve/outreach/v1/mcp`;
//
// `resource` queda fijo al origen de la plataforma (spec 21.6, spike S1). No se
// puede omitir para que eve lo derive: dentro de eve el request.url es el
// interno (127.0.0.1:<puerto>/eve/v1/mcp) y armaría una metadata inexistente.
// Lo que depende del dominio de la empresa es el desafío 401, que arma
// verifyMcpChannelToken con x-forwarded-host (mcpChallenge) y eve respeta, y la
// metadata que sirve Next (app/.well-known/.../eve/outreach/v1/mcp).

// El agente de este canal es el de esta carpeta. Función con nombre a nivel
// de módulo, igual que el `verifyToken` de la guía de eve (channels/mcp.mdx).
function verifyOutreachToken(request: Request) {
	return verifyMcpChannelToken(request, "outreach");
}

export default mcpChannel({
	auth: oauthResource(verifyOutreachToken, {
		issuer,
		resource,
		// El servidor OAuth de Supabase solo publica openid, profile, email y
		// phone: un scope propio podría hacer que rechace el /oauth/authorize.
		// "openid email" es el que la Etapa 11 probó de punta a punta (V3/V7).
		scopes: ["openid", "email"],
	}),
});
