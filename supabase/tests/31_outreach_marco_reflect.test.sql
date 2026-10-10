-- supabase/tests/31_outreach_marco_reflect.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into public.tenants (id, slug, display_name)
values
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'mr-a', 'MR A'),
  ('d1d1d1d1-0000-0000-0000-00000000000b', 'mr-b', 'MR B');

insert into public.config_values (tenant_id, kind, value, label, active, meta)
values
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_viejo', 'Viejo', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_queda', 'Queda', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'hook', 'h_vuelve', 'Vuelve', false, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'vector', 'v_uno', 'Uno', true, '{"default_hook": null}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'segmento', 'seg', 'Segmento', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense', true, '{}'),
  ('d1d1d1d1-0000-0000-0000-00000000000b', 'hook', 'h_viejo', 'De otra empresa', true, '{}');

select is(
  public.outreach_reflect_marco(
    'd1d1d1d1-0000-0000-0000-00000000000a',
    '[{"value":"h_queda","label":"Queda"},{"value":"h_vuelve","label":"Vuelve"},{"value":"h_nuevo","label":"Nuevo"}]',
    '[{"value":"v_uno","label":"Uno cambiado","default_hook":"h_nuevo"}]'
  ),
  '{"upserts": 3, "deactivated": 1, "unchanged": 1}'::jsonb,
  'devuelve altas o cambios, bajas y sin cambios'
);

select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind = 'hook' and value = 'h_viejo'),
  false, 'el hook que no vino queda desactivado');
select is(
  (select count(*)::int from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_viejo'),
  1, 'y no se borra');
select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_vuelve'),
  true, 'un hook desactivado que vuelve se reactiva');
select is(
  (select label from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and value = 'h_nuevo'),
  'Nuevo', 'el hook nuevo se da de alta');
select is(
  (select label || '|' || (meta->>'default_hook') from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind = 'vector' and value = 'v_uno'),
  'Uno cambiado|h_nuevo', 'el vector cambia rótulo y hook por defecto');
select is(
  (select count(*)::int from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and kind in ('segmento', 'idioma') and active),
  2, 'segmentos e idiomas no se tocan');
select is(
  (select active from public.config_values
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000b' and value = 'h_viejo'),
  true, 'la otra empresa no se toca');
select is(
  (select payload from public.events
    where tenant_id = 'd1d1d1d1-0000-0000-0000-00000000000a' and type = 'outreach.marco_reflected'),
  '{"upserts": 3, "deactivated": 1, "unchanged": 1}'::jsonb,
  'deja el evento con los contadores');

select is(
  public.outreach_reflect_marco(
    'd1d1d1d1-0000-0000-0000-00000000000a',
    '[{"value":"h_queda","label":"Queda"},{"value":"h_vuelve","label":"Vuelve"},{"value":"h_nuevo","label":"Nuevo"}]',
    '[{"value":"v_uno","label":"Uno cambiado","default_hook":"h_nuevo"}]'
  ),
  '{"upserts": 0, "deactivated": 0, "unchanged": 4}'::jsonb,
  'repetir el mismo reflejo no cambia nada');

select throws_ok(
  $$select public.outreach_reflect_marco('d1d1d1d1-0000-0000-0000-00000000000a', '[]', '[{"value":"v_uno","label":"Uno","default_hook":null}]')$$,
  '23514', null, 'rechaza hooks vacío');
select throws_ok(
  $$select public.outreach_reflect_marco('d1d1d1d1-0000-0000-0000-00000000000a', '[{"value":"h_queda","label":"Queda"}]', '{}')$$,
  '23514', null, 'rechaza vectores que no es una lista');

select ok(
  not has_function_privilege('authenticated', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.outreach_reflect_marco(uuid, jsonb, jsonb)', 'execute'),
  'solo service_role la ejecuta');

select * from finish();
rollback;
