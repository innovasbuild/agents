-- Perfil, métodos de ingreso y tope mensual de IA desde Configuración y el alta
-- (spec 27 §4 y §5.5/§5.6). tenants_guard_columns le cierra estas columnas al
-- administrador de la empresa: estas funciones son el único camino de escritura.
-- Los errores para la persona salen con errcode 23514 y hint 'settings'.

create or replace function public.set_tenant_profile(
  p_tenant uuid, p_display_name text, p_brand jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_name text := btrim(coalesce(p_display_name, ''));
  v_brand jsonb := coalesce(p_brand, '{}'::jsonb);
  v_key text;
  v_value jsonb;
  v_clean jsonb := '{}'::jsonb;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'el nombre va de 1 a 80 caracteres' using errcode = '23514', hint = 'settings';
  end if;
  if jsonb_typeof(v_brand) <> 'object' then
    raise exception 'la marca tiene un formato inválido' using errcode = '23514', hint = 'settings';
  end if;
  for v_key, v_value in select * from jsonb_each(v_brand) loop
    if v_key not in ('primary', 'secondary', 'logo_url') then
      raise exception 'la marca solo lleva colores y logo' using errcode = '23514', hint = 'settings';
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'la marca tiene un formato inválido' using errcode = '23514', hint = 'settings';
    end if;
    if v_value #>> '{}' = '' then
      continue;
    end if;
    if v_key in ('primary', 'secondary') and (v_value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'los colores van como #RRGGBB' using errcode = '23514', hint = 'settings';
    end if;
    if v_key = 'logo_url' and char_length(v_value #>> '{}') > 500 then
      raise exception 'la dirección del logo es demasiado larga' using errcode = '23514', hint = 'settings';
    end if;
    v_clean := v_clean || jsonb_build_object(v_key, v_value);
  end loop;

  update public.tenants set display_name = v_name, brand = v_clean where id = p_tenant;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'tenant.profile_updated', v_name,
          jsonb_build_object('display_name', v_name, 'brand_keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_clean) k)));
end;
$$;

create or replace function public.set_tenant_auth_methods(
  p_tenant uuid, p_methods text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_methods text[] := coalesce(p_methods, '{}');
begin
  if cardinality(v_methods) < 1 then
    raise exception 'dejá al menos una forma de entrar' using errcode = '23514', hint = 'settings';
  end if;
  if exists (select 1 from unnest(v_methods) m where m is null or m not in ('email', 'google', 'microsoft')) then
    raise exception 'hay una forma de entrar que no existe' using errcode = '23514', hint = 'settings';
  end if;
  if (select count(distinct m) from unnest(v_methods) m) <> cardinality(v_methods) then
    raise exception 'hay formas de entrar repetidas' using errcode = '23514', hint = 'settings';
  end if;

  update public.tenants set auth_methods = v_methods where id = p_tenant;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'tenant.auth_methods_updated', array_to_string(v_methods, ', '),
          jsonb_build_object('methods', to_jsonb(v_methods)));
end;
$$;

create or replace function public.set_ai_monthly_limit(
  p_tenant uuid, p_limit numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_before numeric;
begin
  if p_limit is not null and (p_limit < 0 or p_limit > 99999999) then
    raise exception 'el tope mensual no puede ser negativo' using errcode = '23514', hint = 'settings';
  end if;

  select t.ai_monthly_limit_usd into v_before from public.tenants t where t.id = p_tenant for update;
  update public.tenants set ai_monthly_limit_usd = p_limit where id = p_tenant;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'budget.updated',
          'model_usd_monthly: ' || coalesce(p_limit::text, 'sin tope') || ' por mes',
          jsonb_build_object('resource', 'model_usd_monthly', 'from', v_before, 'to', p_limit));
end;
$$;

revoke execute on function public.set_tenant_profile(uuid, text, jsonb) from public, anon;
revoke execute on function public.set_tenant_auth_methods(uuid, text[]) from public, anon;
revoke execute on function public.set_ai_monthly_limit(uuid, numeric) from public, anon;

grant execute on function public.set_tenant_profile(uuid, text, jsonb) to authenticated;
grant execute on function public.set_tenant_auth_methods(uuid, text[]) to authenticated;
grant execute on function public.set_ai_monthly_limit(uuid, numeric) to authenticated;
