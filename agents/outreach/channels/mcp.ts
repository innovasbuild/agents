// Canal MCP del agente (spec etapa 6). Reusa el emisor OAuth que la Etapa 11
// dejó construido y verificado en producción — el resource cambia, el
// emisor no.
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import { verifyMcpChannelToken } from "../../../lib/agents/mcp-channel-auth";
import { publicSettings } from "../../../lib/brain/mcp-server/production";

// Valida y recorta la barra final de PUBLIC_APP_URL y NEXT_PUBLIC_SUPABASE_URL:
// si falta alguna, el módulo explota con un error claro en vez de publicar
// "undefined/eve/...".
const { publicUrl, issuer } = publicSettings();
// El agente "outreach" está nombrado en next.config.ts, así que eve lo monta
// bajo /eve/agents/outreach/eve/v1/* (no en la ruta por default /eve/v1/*).
// Confirmado en Step 6 con curl contra el dev server y contra
// node_modules/eve/dist/src/internal/vercel/eve-service-contribution.js: la
// reescritura de Vercel solo reenvía ese prefijo, nada de /.well-known/.
const resource = `${publicUrl}/eve/agents/outreach/eve/v1/mcp`;

export default mcpChannel({
	auth: oauthResource(verifyMcpChannelToken, {
		issuer,
		resource,
		// El servidor OAuth de Supabase solo publica openid, profile, email y
		// phone: un scope propio podría hacer que rechace el /oauth/authorize.
		// "openid email" es el que la Etapa 11 probó de punta a punta (V3/V7).
		scopes: ["openid", "email"],
	}),
});
