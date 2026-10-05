import { createAdminClient } from "@/lib/supabase/admin";

export interface Person {
	name: string;
	email?: string;
}

/**
 * Nombre y correo viven en auth.users, que la RLS no expone: se leen con el
 * cliente admin. Quien llama pasa solo `user_id` que una consulta con RLS ya
 * le autorizó a ver.
 */
export async function loadPeople(
	userIds: string[],
): Promise<Map<string, Person>> {
	const admin = createAdminClient();

	return new Map(
		await Promise.all(
			userIds.map(async (userId) => {
				const { data } = await admin.auth.admin.getUserById(userId);
				const meta = data.user?.user_metadata ?? {};
				const name =
					[meta.given_name, meta.family_name].filter(Boolean).join(" ") ||
					meta.full_name ||
					meta.name ||
					"";
				return [
					userId,
					{ name: name as string, email: data.user?.email },
				] as const;
			}),
		),
	);
}
