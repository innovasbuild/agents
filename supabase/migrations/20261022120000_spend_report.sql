-- supabase/migrations/20261022120000_spend_report.sql
-- Etapa 21.5: lectura del gasto en modelos por período (spec §6). No hay
-- tablas nuevas: usage_entries sigue cerrada y esto solo agrega.
--
-- En las dos funciones el rango es [p_from, p_to) y el día se corta en UTC
-- (spec G7): es como reporta el AI Gateway, y con otro corte la conciliación
-- no cierra.

-- El gasto de una empresa por día y por origen. La llama su administrador
-- (o un platform_admin): settings_actor lo verifica adentro. El costo por
-- corrida sigue sin exponerse (spec G9).
--
-- Origen: el workflow si el asiento lo trae; si no, 'chat' cuando tiene
-- corrida o es un paso del agente (agent/step: un turno sin corrida sigue
-- siendo chat) y 'sin_corrida' cuando no (el schedule de follow-ups asienta
-- sin workflow y sin corrida, y no es chat).
create or replace function public.tenant_spend_report(
  p_tenant uuid, p_from timestamptz, p_to timestamptz
) returns table (day date, origin text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.settings_actor(p_tenant);
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '92 days' then
    raise exception 'período inválido' using errcode = '23514', hint = 'settings';
  end if;
  return query
    select (u.created_at at time zone 'UTC')::date,
           coalesce(u.workflow, case when u.run_id is not null or u.node = 'agent/step' then 'chat' else 'sin_corrida' end),
           sum(u.amount)
      from public.usage_entries u
     where u.tenant_id = p_tenant
       and u.resource = 'model_usd'
       and u.created_at >= p_from
       and u.created_at < p_to
     group by 1, 2;
end;
$$;

revoke execute on function public.tenant_spend_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.tenant_spend_report(uuid, timestamptz, timestamptz) to authenticated;

-- El gasto de todas las empresas en el rango, una fila por empresa. Solo
-- service_role: la pantalla de plataforma la llama después de comprobar que
-- quien entra es platform_admin. Devuelve un agregado y no empresa x día
-- porque PostgREST corta las respuestas en max_rows (1000) sin avisar: con
-- una fila por empresa el tope no se alcanza, y el order by deja la salida
-- determinista.
create or replace function public.platform_spend_report(
  p_from timestamptz, p_to timestamptz
) returns table (tenant_id uuid, amount numeric)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'período inválido' using errcode = '23514';
  end if;
  return query
    select u.tenant_id, sum(u.amount)
      from public.usage_entries u
     where u.resource = 'model_usd'
       and u.created_at >= p_from
       and u.created_at < p_to
     group by u.tenant_id
     order by u.tenant_id;
end;
$$;

revoke execute on function public.platform_spend_report(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_spend_report(timestamptz, timestamptz) to service_role;
