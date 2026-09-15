import { type AuthFn, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { resolveChannelContext } from "../../../lib/agents/channel-context";
import { evalAuthFromEnv } from "../../../lib/agents/eval-auth";
import { verifyCaller } from "../../../lib/auth/verify-caller";

function supabaseAuth(): AuthFn<Request> {
	return async (request) => {
		const caller = await verifyCaller(request);
		if (caller === null) return null;

		// eve no valida ownership de sesión: lo hacemos acá, que es el único
		// punto capaz de rechazar (los hooks son observe-only).
		const context = await resolveChannelContext(request, caller.userId);
		if (context === null) return null;

		return {
			authenticator: "app",
			issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
			principalId: caller.userId,
			principalType: "user",
			subject: caller.userId,
			attributes: {
				email: caller.email,
				tenantId: context.tenantId,
				tenantSlug: context.tenantSlug,
				conversationId: context.conversationId,
				role: context.role,
			},
		};
	};
}

// Evals locales (spec 03 §13.1): principal fijo del tenant sembrado. La propia
// función devuelve null en Vercel y contra cualquier base que no sea local.
function evalAuth(): AuthFn<Request> {
	return async () => evalAuthFromEnv();
}

// `localDev()` nunca puede quedar activo en un deploy: `VERCEL_ENV` existe en
// todos los entornos de Vercel y no en local.
export default eveChannel({
	auth: process.env.VERCEL_ENV
		? [supabaseAuth()]
		: [supabaseAuth(), evalAuth(), localDev()],
});
