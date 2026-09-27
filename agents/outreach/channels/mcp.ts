// Canal MCP del agente (spec etapa 6). Reusa el emisor OAuth que la Etapa 11
// dejó construido y verificado en producción — el resource cambia, el
// emisor no.
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import { verifyMcpChannelToken } from "../../../lib/agents/mcp-channel-auth";

const issuer = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
// El agente "outreach" está nombrado en next.config.ts, así que eve lo monta
// bajo /eve/agents/outreach/eve/v1/* (no en la ruta por default /eve/v1/*).
// Confirmado en Step 6 con curl contra el dev server y contra
// node_modules/eve/dist/src/internal/vercel/eve-service-contribution.js: la
// reescritura de Vercel solo reenvía ese prefijo, nada de /.well-known/.
const resource = `${process.env.PUBLIC_APP_URL}/eve/agents/outreach/eve/v1/mcp`;

export default mcpChannel({
	auth: oauthResource(verifyMcpChannelToken, {
		issuer,
		resource,
		scopes: ["agent:invoke"],
	}),
});
