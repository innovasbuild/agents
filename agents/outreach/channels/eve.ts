import { type AuthFn, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { verifyCaller } from "../../../lib/auth/verify-caller";

function supabaseAuth(): AuthFn<Request> {
	return async (request) => {
		const caller = await verifyCaller(request);
		if (caller === null) return null;
		return {
			authenticator: "app",
			issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
			principalId: caller.userId,
			principalType: "user",
			subject: caller.userId,
			attributes: { email: caller.email },
		};
	};
}

// `localDev()` nunca puede quedar activo en un deploy: `VERCEL_ENV` existe en
// todos los entornos de Vercel y no en local.
export default eveChannel({
	auth: process.env.VERCEL_ENV
		? [supabaseAuth()]
		: [supabaseAuth(), localDev()],
});
