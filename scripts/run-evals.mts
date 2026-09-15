// `npm run evals -- [evalId...]`: corre las evals del agente outreach contra la
// Supabase local. Se niega si NEXT_PUBLIC_SUPABASE_URL no es local.
import { spawnSync } from "node:child_process";
import { isLocalSupabaseUrl } from "../lib/agents/eval-auth.ts";

if (!isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
	console.error(
		"npm run evals solo corre contra la Supabase local: revisá NEXT_PUBLIC_SUPABASE_URL en .env.eval",
	);
	process.exit(1);
}

const result = spawnSync(
	"npx",
	["eve", "eval", "--agent", "outreach", ...process.argv.slice(2)],
	{ stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
