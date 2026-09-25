// Verifica el emisor OAuth de Supabase (spec etapa 11 V1, V2). Uso:
//   npm run oauth:probe
import { checkAuthServerMetadata } from "./oauth-probe-check.ts";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!base) {
	console.error("falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
	process.exit(1);
}
const issuer = `${base.replace(/\/$/, "")}/auth/v1`;
const url = `${base.replace(/\/$/, "")}/.well-known/oauth-authorization-server/auth/v1`;

const response = await fetch(url);
const text = await response.text();
let metadata: unknown = text;
try {
	metadata = JSON.parse(text);
} catch {}

const result = checkAuthServerMetadata(metadata, issuer);
console.log(`${url} → HTTP ${response.status}`);
if (result.ok) {
	console.log(
		"emisor OK: metadata completa, con registration_endpoint y PKCE S256",
	);
} else {
	for (const problem of result.problems) console.log(`✗ ${problem}`);
	process.exit(1);
}
