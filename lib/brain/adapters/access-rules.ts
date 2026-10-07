// Cablea el lector de reglas con el cliente admin de la plataforma. Las reglas
// solo las lee el servidor (la tabla no es legible con la sesión).
import { createAdminClient } from "../../supabase/admin";
import {
	createSupabaseAccessRulesStore,
	createSupabaseAccessRulesWriter,
} from "../core/access/rules-store.ts";
import type {
	AccessRule,
	AccessRulesStore,
	AccessRulesWriter,
} from "../core/access/types.ts";

export function accessRulesStore(): AccessRulesStore {
	return createSupabaseAccessRulesStore(createAdminClient());
}

export function loadAccessRules(tenantId: string): Promise<AccessRule[]> {
	return accessRulesStore().load(tenantId);
}

export function accessRulesWriter(): AccessRulesWriter {
	return createSupabaseAccessRulesWriter(createAdminClient());
}
