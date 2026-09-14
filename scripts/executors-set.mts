// Alta o actualización de un ejecutor de outreach (spec 03 §12.1). Uso:
//   npm run executors:set -- --tenant innovas --email ana@acme.test --slug ana [--crm-owner-id 123]
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { parseExecutorsSetArgs } from "./executors-set-args.ts";

async function main(): Promise<void> {
	const args = parseExecutorsSetArgs(process.argv.slice(2));
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error(
			"faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local",
		);
	const admin = createClient(url, key, { auth: { persistSession: false } });

	const { data: tenant, error: tenantError } = await admin
		.from("tenants")
		.select("id")
		.eq("slug", args.tenant)
		.maybeSingle();
	if (tenantError)
		throw new Error(`no pude leer el tenant: ${tenantError.message}`);
	if (!tenant) throw new Error(`no existe el tenant "${args.tenant}"`);

	let userId: string | null = null;
	for (let page = 1; !userId; page++) {
		const { data, error } = await admin.auth.admin.listUsers({
			page,
			perPage: 200,
		});
		if (error) throw new Error(`no pude listar usuarios: ${error.message}`);
		userId =
			data.users.find((user) => user.email?.toLowerCase() === args.email)?.id ??
			null;
		if (data.users.length < 200) break;
	}
	if (!userId)
		throw new Error(
			`no existe un usuario con el email ${args.email}: invitarlo primero`,
		);

	const { data: membership, error: membershipError } = await admin
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenant.id)
		.eq("user_id", userId)
		.maybeSingle();
	if (membershipError)
		throw new Error(`no pude leer la membership: ${membershipError.message}`);
	if (!membership)
		throw new Error(`${args.email} no es miembro de ${args.tenant}`);

	const { error: upsertError } = await admin.from("executors").upsert(
		{
			tenant_id: tenant.id,
			user_id: userId,
			slug: args.slug,
			...(args.crmOwnerId ? { crm_owner_id: args.crmOwnerId } : {}),
		},
		{ onConflict: "tenant_id,user_id" },
	);
	if (upsertError) {
		throw new Error(
			upsertError.code === "23505"
				? `el slug "${args.slug}" ya lo usa otro ejecutor de ${args.tenant}`
				: `no pude guardar el ejecutor: ${upsertError.message}`,
		);
	}

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "executor.updated",
		summary: `${args.slug} (${args.email})`,
		payload: {
			user_id: userId,
			slug: args.slug,
			crm_owner_id: args.crmOwnerId,
			actor: `script:${userInfo().username}`,
		},
	});
	if (eventError)
		throw new Error(
			`el ejecutor quedó guardado pero no el evento: ${eventError.message}`,
		);
	console.log(`listo: ${args.slug} es ejecutor de ${args.tenant}`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
