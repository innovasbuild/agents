import type { TenantRole } from "@/lib/tenants/resolve";

export const ROLE_LABELS: Record<TenantRole, string> = {
	platform_admin: "Administrador de la plataforma",
	tenant_admin: "Administrador",
	tenant_member: "Usuario",
};
