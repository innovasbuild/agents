-- Hueco de permisos en memberships: la política memberships_write dejaba a un
-- tenant_admin insertar una fila con CUALQUIER user_id (meter a un usuario de
-- otro tenant en el suyo, sin su consentimiento y sin invitación) o cambiar
-- user_id/tenant_id de una fila existente con un UPDATE.
--
-- Las altas legítimas pasan todas por funciones security definer
-- (accept_pending_invitations, y las que vengan, como el ingreso por dominio),
-- que corren como owner y no dependen del grant de authenticated. La app solo
-- borra miembros con la sesión (revokeMembership) y no hay pantalla de rol.
--
-- Queda: SELECT, DELETE, y UPDATE solo de role. El with check de
-- memberships_write sigue impidiendo crear o dejar a alguien como
-- platform_admin.
revoke insert, update on public.memberships from authenticated, anon;
grant update (role) on public.memberships to authenticated;
