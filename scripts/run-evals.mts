// `npm run evals -- [--agent <agente>] [evalId...]`: corre las evals de un
// agente (outreach si no se dice otro) contra la Supabase local. Se niega si
// NEXT_PUBLIC_SUPABASE_URL no es local.
import { spawnSync } from "node:child_process";
import { isLocalSupabaseUrl } from "../lib/agents/eval-auth.ts";

if (!isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
	console.error(
		"npm run evals solo corre contra la Supabase local: revisá NEXT_PUBLIC_SUPABASE_URL en .env.eval",
	);
	process.exit(1);
}

const args = process.argv.slice(2);
const flag = args.indexOf("--agent");
const agent = flag === -1 ? "outreach" : args[flag + 1];
const evalIds =
	flag === -1 ? args : [...args.slice(0, flag), ...args.slice(flag + 2)];

if (!agent || !/^[a-z][a-z0-9-]*$/.test(agent)) {
	console.error("--agent necesita el nombre de una carpeta de agents/");
	process.exit(1);
}

const result = spawnSync("npx", ["eve", "eval", "--agent", agent, ...evalIds], {
	stdio: "inherit",
	env: process.env,
});
process.exit(result.status ?? 1);
