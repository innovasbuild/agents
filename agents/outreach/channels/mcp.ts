// Canal MCP del agente (spec etapa 6). Reusa el emisor OAuth que la Etapa 11
// dejó construido y verificado en producción — el resource cambia, el
// emisor no.
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import { verifyMcpChannelToken } from "../../../lib/agents/mcp-channel-auth";

const issuer = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const resource = `${process.env.PUBLIC_APP_URL}/eve/v1/mcp`;

export default mcpChannel({
	auth: oauthResource(verifyMcpChannelToken, {
		issuer,
		resource,
		scopes: ["agent:invoke"],
	}),
});
