// El corte al entrar (spec etapa 20, L6 a L8). La decisión es de la base
// (public.login_gate); acá solo se traduce a "seguí" o "andá a esta landing".
// Ante cualquier duda se corta: es un control de acceso.

interface GateClient {
	rpc(
		fn: string,
	): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type GateResult = { ok: true } | { ok: false; landing: string };

const FAILED: GateResult = { ok: false, landing: "/login?error=auth_failed" };
const SLUG = /^[a-z][a-z0-9-]{1,38}$/;

export async function gateLogin(supabase: GateClient): Promise<GateResult> {
	try {
		const { data, error } = await supabase.rpc("login_gate");
		if (error) {
			console.error("login_gate falló:", error.message);
			return FAILED;
		}
		if (typeof data !== "object" || data === null) return FAILED;

		const { allowed, landing } = data as Record<string, unknown>;
		if (allowed === true) return { ok: true };
		if (
			allowed === false &&
			typeof landing === "string" &&
			SLUG.test(landing)
		) {
			return { ok: false, landing: `/login/${landing}?error=metodo` };
		}
		return FAILED;
	} catch (error) {
		console.error("login_gate falló:", error);
		return FAILED;
	}
}
