-- conversations_update solo chequea user_id = auth.uid(), sin restringir qué
-- columnas puede tocar. Eso deja eve_session_id y tenant_id escribibles por
-- cualquier usuario autenticado sobre su propia fila: alguien podía reclamar
-- CUALQUIER eve_session_id no atado todavía (quedan huérfanos por el
-- "última escritura gana" de bindSessionToConversation, o al borrar una
-- conversación) y secuestrar la sesión de eve de otro usuario — el chequeo
-- de ownership de resolveChannelContext termina comparando contra un dato
-- que el propio atacante controla. tenant_id escribible permite además
-- inyectar filas cruzando tenants. Mismo patrón que ya protege
-- runs.cost_usd: revocar la tabla y re-otorgar solo las columnas seguras.
revoke update on public.conversations from authenticated, anon;
grant update (title, model, last_message_at) on public.conversations to authenticated;

-- Mismo vector que el UPDATE de arriba, pero por INSERT: authenticated podía
-- crear una fila propia con eve_session_id/tenant_id arbitrarios en el
-- mismo statement que la crea, sin pasar nunca por un UPDATE. La app solo
-- necesita setear tenant_id, user_id, agent, model y (opcionalmente) title
-- al crear una conversación — eve_session_id lo ata bindSessionToConversation
-- después, con el cliente admin.
revoke insert on public.conversations from authenticated, anon;
grant insert (tenant_id, user_id, agent, model, title) on public.conversations to authenticated;

-- Un tenant_admin puede degradar o borrar la membership de un platform_admin.
-- El with check ya impedía ASCENDER a platform_admin, pero no actuar sobre
-- una fila que YA es platform_admin: un UPDATE que la degrada pasa el check
-- (el nuevo rol no es platform_admin), y un DELETE no evalúa with check en
-- absoluto, solo using. Si esa membership es la única del usuario con rol
-- platform_admin, is_platform_admin() deja de ser cierto para él GLOBALMENTE.
drop policy memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all to authenticated
  using (
    (
      (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
      or (select public.is_platform_admin())
    )
    and (role <> 'platform_admin' or (select public.is_platform_admin()))
  )
  with check (
    (
      (select public.has_tenant_role(tenant_id, array['tenant_admin']::public.tenant_role[]))
      or (select public.is_platform_admin())
    )
    and (role <> 'platform_admin' or (select public.is_platform_admin()))
  );

-- revoke execute ... from public es inefectivo en este proyecto: las
-- políticas de ALTER DEFAULT PRIVILEGES le dan EXECUTE a anon/authenticated
-- directo sobre toda función nueva, y ese revoke solo saca el grant del
-- pseudo-rol PUBLIC. Hoy no es explotable (las cinco funciones se protegen
-- por su propio chequeo de auth.uid()/membership), pero el idiom se lee como
-- un control de seguridad que no lo es, y las etapas siguientes lo van a
-- copiar por analogía. Revoke explícito, directo sobre el rol.
revoke execute on function public.is_platform_admin() from anon;
revoke execute on function public.is_member_of(uuid) from anon;
revoke execute on function public.has_tenant_role(uuid, public.tenant_role[]) from anon;
revoke execute on function public.accept_pending_invitations() from anon;
revoke execute on function public.run_cost_usd(uuid) from anon;
