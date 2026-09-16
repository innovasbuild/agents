// Principal fijo para `eve eval` contra la Supabase local (spec 03 §13.1, plan
// B de S7). Nunca autentica en un deploy de Vercel ni contra una base que no
// sea local. Sin imports: lo usa scripts/run-evals.mts con type stripping.
export interface EvalAuthContext {
	authenticator: string;
	issuer: string;
	principalId: string;
	principalType: string;
	subject: string;
	attributes: Record<string, string>;
}

const LOCAL_SUPABASE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

export function isLocalSupabaseUrl(url: string | undefined): boolean {
	return typeof url === "string" && LOCAL_SUPABASE.test(url);
}

const REQUIRED = [
	"EVE_EVAL_USER_ID",
	"EVE_EVAL_USER_EMAIL",
	"EVE_EVAL_TENANT_ID",
	"EVE_EVAL_TENANT_SLUG",
	"EVE_EVAL_CONVERSATION_ID",
	"EVE_EVAL_ROLE",
] as const;

export function evalAuthFromEnv(
	env: Record<string, string | undefined> = process.env,
): EvalAuthContext | null {
	if (env.VERCEL_ENV) return null;
	const url = env.NEXT_PUBLIC_SUPABASE_URL;
	if (!isLocalSupabaseUrl(url)) return null;
	if (REQUIRED.some((key) => !env[key])) return null;
	const userId = env.EVE_EVAL_USER_ID as string;
	return {
		authenticator: "app",
		issuer: url as string,
		principalId: userId,
		principalType: "user",
		subject: userId,
		attributes: {
			email: env.EVE_EVAL_USER_EMAIL as string,
			tenantId: env.EVE_EVAL_TENANT_ID as string,
			tenantSlug: env.EVE_EVAL_TENANT_SLUG as string,
			conversationId: env.EVE_EVAL_CONVERSATION_ID as string,
			role: env.EVE_EVAL_ROLE as string,
		},
	};
}
