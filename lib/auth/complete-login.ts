// Lo que pasa después de verificar a la persona, venga por link, por OAuth o
// por código (spec 21.4 §5.1): se convierten en membresías sus invitaciones y
// su dominio, y recién después corre la compuerta de método. Si corta, la
// sesión recién abierta se cierra.
import { closeLocalSession } from "./close-session";
import { joinOnLogin } from "./join-on-login";
import { type GateResult, gateLogin } from "./login-gate";

type Client = Parameters<typeof joinOnLogin>[0] &
	Parameters<typeof gateLogin>[0] &
	Parameters<typeof closeLocalSession>[0];

export async function completeLogin(supabase: Client): Promise<GateResult> {
	await joinOnLogin(supabase);
	const gate = await gateLogin(supabase);
	if (!gate.ok) await closeLocalSession(supabase);
	return gate;
}
