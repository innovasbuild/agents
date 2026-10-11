-- supabase/migrations/20261017120000_outreach_marco_reflect.sql
-- Reflejo de hooks y vectores del brain en config_values (spec 21.3 §3.5 y
-- §5.1). El brain manda: lo que viene se da de alta o se actualiza, lo que no
-- viene se desactiva. Nunca se borra (contactos y focos guardan el valor como
-- texto) y nunca se tocan segmentos ni idiomas.
create or replace function public.outreach_reflect_marco(
  p_tenant uuid, p_hooks jsonb, p_vectors jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_upserts integer;
  v_deactivated integer;
  v_result jsonb;
begin
  if p_hooks is null or p_vectors is null
     or jsonb_typeof(p_hooks) <> 'array' or jsonb_typeof(p_vectors) <> 'array'
     or jsonb_array_length(p_hooks) = 0 or jsonb_array_length(p_vectors) = 0 then
    raise exception 'el reflejo necesita al menos un hook y un vector' using errcode = '23514';
  end if;

  v_total := jsonb_array_length(p_hooks) + jsonb_array_length(p_vectors);

  with wanted as (
    select 'hook'::public.config_value_kind as kind,
           h->>'value' as value, h->>'label' as label, '{}'::jsonb as meta
      from jsonb_array_elements(p_hooks) as h
    union all
    select 'vector'::public.config_value_kind,
           v->>'value', v->>'label',
           jsonb_build_object('default_hook', v->'default_hook')
      from jsonb_array_elements(p_vectors) as v
  ),
  written as (
    insert into public.config_values as cv (tenant_id, kind, value, label, active, meta, updated_at)
    select p_tenant, w.kind, w.value, w.label, true, w.meta, now()
      from wanted as w
    on conflict (tenant_id, kind, value) do update
      set label = excluded.label, meta = excluded.meta, active = true, updated_at = now()
      where cv.label is distinct from excluded.label
         or cv.meta is distinct from excluded.meta
         or not cv.active
    returning 1
  )
  select count(*) into v_upserts from written;

  update public.config_values as cv
     set active = false, updated_at = now()
   where cv.tenant_id = p_tenant
     and cv.active
     and cv.kind in ('hook', 'vector')
     and not exists (
       select 1
         from jsonb_array_elements(case cv.kind when 'hook' then p_hooks else p_vectors end) as e
        where e->>'value' = cv.value
     );
  get diagnostics v_deactivated = row_count;

  v_result := jsonb_build_object(
    'upserts', v_upserts, 'deactivated', v_deactivated, 'unchanged', v_total - v_upserts);

  insert into public.events (tenant_id, type, summary, payload)
  values (p_tenant, 'outreach.marco_reflected',
          v_upserts || ' altas o cambios, ' || v_deactivated || ' bajas', v_result);

  return v_result;
end;
$$;

revoke execute on function public.outreach_reflect_marco(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.outreach_reflect_marco(uuid, jsonb, jsonb) to service_role;
