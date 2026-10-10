-- supabase/migrations/20261018120000_outreach_settings.sql
-- Configuración de outreach desde la UI (spec 21.3 §5). El cliente escribe
-- por funciones que verifican adentro que quien llama administra la empresa
-- (settings_actor, 21.2); los presupuestos los fija plataforma.

create or replace function public.set_list_value(
  p_tenant uuid, p_kind public.config_value_kind, p_value text, p_label text, p_active boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  -- Hooks y vectores salen del brain (spec O3): acá no se tocan.
  if p_kind is null or p_kind not in ('segmento', 'idioma') then
    raise exception 'los hooks y vectores se editan en el brain' using errcode = '23514', hint = 'settings';
  end if;
  if p_value is null or p_value !~ '^[a-z0-9][a-z0-9_]{0,60}$' then
    raise exception 'el identificador va en minúsculas, dígitos y guion bajo' using errcode = '23514', hint = 'settings';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 200 then
    raise exception 'el rótulo tiene que tener entre 1 y 200 caracteres' using errcode = '23514', hint = 'settings';
  end if;
  if p_active is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;
  if not p_active and not exists (
    select 1 from public.config_values c
     where c.tenant_id = p_tenant and c.kind = p_kind and c.active and c.value <> p_value
  ) then
    raise exception 'tiene que quedar al menos uno activo' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.config_values as cv (tenant_id, kind, value, label, active, updated_at)
  values (p_tenant, p_kind, p_value, btrim(p_label), p_active, now())
  on conflict (tenant_id, kind, value) do update
    set label = excluded.label, active = excluded.active, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'outreach.list_value_updated', p_kind::text || ' ' || p_value,
          jsonb_build_object('kind', p_kind, 'value', p_value, 'label', btrim(p_label), 'active', p_active));
end;
$$;

create or replace function public.set_outreach_config(
  p_tenant uuid, p_config jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'la configuración tiene que ser un objeto' using errcode = '23514', hint = 'settings';
  end if;
  if p_config ? 'icp' then
    raise exception 'el ICP se edita en el brain' using errcode = '23514', hint = 'settings';
  end if;

  -- Solo la clave outreach: brain y approvals tienen sus propias funciones.
  update public.tenant_agents
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{outreach}', p_config)
   where tenant_id = p_tenant and agent = 'outreach';
  if not found then
    raise exception 'la empresa no tiene el agente de outreach' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'outreach.config_updated', 'datos de outreach',
          jsonb_build_object('config', p_config));
end;
$$;

create or replace function public.set_workflow(
  p_tenant uuid, p_workflow text, p_enabled boolean, p_cadence_minutes integer, p_items_per_tick integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_before public.tenant_workflows%rowtype;
  v_patch jsonb;
begin
  if p_workflow is null or p_workflow !~ '^[a-z][a-z0-9-]{0,99}$' then
    raise exception 'ese proceso no existe' using errcode = '23514', hint = 'settings';
  end if;
  if p_enabled is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;
  if p_cadence_minutes is null or p_cadence_minutes not between 5 and 10080 then
    raise exception 'la cadencia va de 5 minutos a 7 días' using errcode = '23514', hint = 'settings';
  end if;
  if p_items_per_tick is null or p_items_per_tick not between 1 and 1000 then
    raise exception 'los ítems por pasada van de 1 a 1000' using errcode = '23514', hint = 'settings';
  end if;

  select * into v_before from public.tenant_workflows w
   where w.tenant_id = p_tenant and w.workflow = p_workflow
     for update;

  v_patch := jsonb_build_object('cadence_minutes', p_cadence_minutes, 'items_per_tick', p_items_per_tick);

  insert into public.tenant_workflows as w (tenant_id, workflow, enabled, config)
  values (p_tenant, p_workflow, p_enabled, v_patch)
  on conflict (tenant_id, workflow) do update
    set enabled = excluded.enabled,
        config = coalesce(w.config, '{}'::jsonb) || excluded.config;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'workflow.updated', p_workflow,
          jsonb_build_object(
            'workflow', p_workflow,
            'enabled', jsonb_build_object('from', coalesce(v_before.enabled, false), 'to', p_enabled),
            'config', jsonb_build_object(
              'from', coalesce(v_before.config, '{}'::jsonb),
              'to', coalesce(v_before.config, '{}'::jsonb) || v_patch)));
end;
$$;

-- Límite y gasto por recurso desde una fecha (spec O12). El gasto por corrida
-- y usage_entries siguen cerrados: esto solo agrega por recurso.
create or replace function public.tenant_budget_status(
  p_tenant uuid, p_resources text[], p_since timestamptz
) returns table (resource text, daily_limit numeric, spent numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.settings_actor(p_tenant);
  if p_resources is null or p_since is null or coalesce(array_length(p_resources, 1), 0) > 20 then
    raise exception 'pedido de presupuesto inválido' using errcode = '23514', hint = 'settings';
  end if;
  return query
    select r.name,
           coalesce(b.daily_limit, 0)::numeric,
           public.usage_sum(p_tenant, r.name, p_since)
      from unnest(p_resources) as r(name)
      left join public.tenant_budgets b
        on b.tenant_id = p_tenant and b.resource = r.name;
end;
$$;

create or replace function public.platform_set_budget(
  p_actor uuid, p_tenant uuid, p_resource text, p_daily_limit numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before numeric;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_resource is null or p_resource !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'ese recurso no existe' using errcode = '23514', hint = 'consola';
  end if;
  if p_daily_limit is null or p_daily_limit < 0 or p_daily_limit > 100000 then
    raise exception 'el límite diario va de 0 a 100000' using errcode = '23514', hint = 'consola';
  end if;

  select b.daily_limit into v_before from public.tenant_budgets b
   where b.tenant_id = p_tenant and b.resource = p_resource
     for update;

  insert into public.tenant_budgets as b (tenant_id, resource, daily_limit, updated_by, updated_at)
  values (p_tenant, p_resource, p_daily_limit, p_actor, now())
  on conflict (tenant_id, resource) do update
    set daily_limit = excluded.daily_limit, updated_by = excluded.updated_by, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'budget.updated', p_resource || ': ' || p_daily_limit || ' por día',
          jsonb_build_object('resource', p_resource, 'from', v_before, 'to', p_daily_limit));
end;
$$;

revoke execute on function public.set_list_value(uuid, public.config_value_kind, text, text, boolean) from public, anon;
revoke execute on function public.set_outreach_config(uuid, jsonb) from public, anon;
revoke execute on function public.set_workflow(uuid, text, boolean, integer, integer) from public, anon;
revoke execute on function public.tenant_budget_status(uuid, text[], timestamptz) from public, anon;
revoke execute on function public.platform_set_budget(uuid, uuid, text, numeric) from public, anon, authenticated;

grant execute on function public.set_list_value(uuid, public.config_value_kind, text, text, boolean) to authenticated;
grant execute on function public.set_outreach_config(uuid, jsonb) to authenticated;
grant execute on function public.set_workflow(uuid, text, boolean, integer, integer) to authenticated;
grant execute on function public.tenant_budget_status(uuid, text[], timestamptz) to authenticated;
grant execute on function public.platform_set_budget(uuid, uuid, text, numeric) to service_role;
