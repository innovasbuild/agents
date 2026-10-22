-- supabase/tests/37_self_serve_onboarding.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('a7a7a7a7-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'Mati@Lagomarsino.com.ar', now()),
  ('a7a7a7a7-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'uru@lagomarsino.uy', now()),
  ('a7a7a7a7-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'caro@lagomarsino.com.ar', now()),
  ('a7a7a7a7-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pepe@gmail.com', now()),
  ('a7a7a7a7-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'nuevo@nuevo.com', now()),
  ('a7a7a7a7-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'miembro@lagomarsino.com.ar', now()),
  ('a7a7a7a7-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'x@algo.com', now());

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
values ('a-7', 'a7a7a7a7-0000-0000-0000-000000000007', '{"custom_claims":{"xms_edov":false}}', 'azure', now());

create function pg_temp.login_as(p_user int, p_amr text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"a7a7a7a7-0000-0000-0000-00000000000%s","role":"authenticated","amr":%s}',
    p_user, p_amr), true);
end $$;

-- Corre la sentencia y devuelve SQLSTATE y hint del error.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ':' || coalesce(v_hint, '');
end $$;

-- 1-3: columnas, slug reservado, slug_from_domain.
select col_default_is('public', 'tenants', 'plan', 'enterprise', 'plan arranca en enterprise');
select throws_ok($$ insert into public.tenants (slug, display_name) values ('empezar', 'x') $$, '23514', null, 'empezar es slug reservado');
select is(public.slug_from_domain('lagomarsino.com.ar'), 'lagomarsino', 'primera etiqueta del dominio');
select is(public.slug_from_domain('123molinos.com'), 'e-123molinos', 'prefijo e- si no empieza por letra');

-- 5-12: alta de Mati (correo con mayúsculas).
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is((public.self_serve_create_tenant('Molinos Lagomarsino', 'Lagomarsino.com.ar'))->>'slug', 'lagomarsino', 'slug desde el dominio');
reset role;
select is((select plan from public.tenants where slug = 'lagomarsino'), 'free', 'plan free');
select ok((select trial_ends_at from public.tenants where slug = 'lagomarsino') between now() + interval '89 days' and now() + interval '93 days', 'trial de 3 meses');
select is((select onboarding_step from public.tenants where slug = 'lagomarsino'), 'carpetas', 'arranca en carpetas');
select is(
  (select m.role::text from public.memberships m join public.tenants t on t.id = m.tenant_id
    where t.slug = 'lagomarsino' and m.user_id = 'a7a7a7a7-0000-0000-0000-000000000001'),
  'tenant_admin', 'quien crea es admin');
select is((select count(*) from public.tenant_agents ta join public.tenants t on t.id = ta.tenant_id
  where t.slug = 'lagomarsino' and ta.agent = 'asistente'), 1::bigint, 'tiene el Asistente');
select is((select count(*) from public.events where type = 'tenant.created' and payload->>'origin' = 'self_serve'), 1::bigint, 'evento tenant.created');
select is((select count(*) from public.events e join public.tenants t on t.id = e.tenant_id
  where t.slug = 'lagomarsino' and e.type = 'membership.created'), 1::bigint, 'evento membership.created');

-- 13-17: errores.
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is(pg_temp.err($$ select public.self_serve_create_tenant('Otra', 'lagomarsino.com.ar') $$), '23514:domain_taken', 'dominio ya tomado');
select is(pg_temp.err($$ select public.self_serve_create_tenant('X', 'gmail.com') $$), '23514:public_domain', 'dominio público');
select is(pg_temp.err($$ select public.self_serve_create_tenant('X', 'otro.com') $$), '23514:domain_mismatch', 'dominio distinto al del correo');
select pg_temp.login_as(7, '[{"method":"oauth","timestamp":10}]');
select is(pg_temp.err($$ select public.self_serve_create_tenant('X', 'algo.com') $$), '23514:login_method_unknown', 'método desconocido');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.self_serve_create_tenant('X', 'algo.com') $$, '42501', null, 'sin sesión');


-- Nombre en blanco y correo sin confirmar.
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is(pg_temp.err($$ select public.self_serve_create_tenant('  ', 'nuevo2.com') $$), '23514:domain_mismatch', 'el dominio se valida antes que el nombre');
reset role;
insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a7a7a7a7-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'sin@confirmar.com', null),
       ('a7a7a7a7-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'ana@blanco.com', now());
select pg_temp.login_as(8, '[{"method":"otp","timestamp":10}]');
select is(pg_temp.err($$ select public.self_serve_create_tenant('X', 'confirmar.com') $$), '23514:email_not_confirmed', 'correo sin confirmar');
select pg_temp.login_as(9, '[{"method":"otp","timestamp":10}]');
select is(pg_temp.err($$ select public.self_serve_create_tenant('   ', 'blanco.com') $$), '23514:name_required', 'nombre en blanco');
reset role;

-- Una empresa dada de baja no bloquea el dominio.
insert into public.tenants (slug, display_name, allowed_domains, active)
values ('blanco-viejo', 'Blanco viejo', '{blanco.com}', false);
select pg_temp.login_as(9, '[{"method":"otp","timestamp":10}]');
select is((public.self_serve_create_tenant('Blanco', 'blanco.com'))->>'slug', 'blanco', 'dominio de una empresa inactiva queda libre');
reset role;

-- accept_pending_invitations: la de la empresa suspendida se saltea sin tirar.
insert into public.tenants (id, slug, display_name, auth_methods, active, suspended_reason)
values ('a7a7a7a7-0000-0000-0000-0000000000a1', 'susp-t', 'Suspendida', '{email}', true, 'trial_vencido');
insert into public.tenants (id, slug, display_name, auth_methods, active)
values ('a7a7a7a7-0000-0000-0000-0000000000a2', 'sana-t', 'Sana', '{email}', true);
update public.tenants set suspended_reason = null where slug = 'susp-t';
insert into public.invitations (tenant_id, email, role, invited_by)
values ('a7a7a7a7-0000-0000-0000-0000000000a1', 'ana@blanco.com', 'tenant_member', 'a7a7a7a7-0000-0000-0000-000000000009'),
       ('a7a7a7a7-0000-0000-0000-0000000000a2', 'ana@blanco.com', 'tenant_member', 'a7a7a7a7-0000-0000-0000-000000000009');
update public.tenants set suspended_reason = 'trial_vencido' where slug = 'susp-t';
select pg_temp.login_as(9, '[{"method":"invite","timestamp":10}]');
select is((select public.accept_pending_invitations()), 1, 'acepta solo la de la empresa sana');
reset role;
select is((select status::text from public.invitations where tenant_id = 'a7a7a7a7-0000-0000-0000-0000000000a1'), 'pending', 'la de la suspendida sigue pendiente');

-- 18-19: sufijo -2.
select pg_temp.login_as(2, '[{"method":"otp","timestamp":10}]');
select is((public.self_serve_create_tenant('L Uruguay', 'lagomarsino.uy'))->>'slug', 'lagomarsino-2', 'slug tomado suma -2');
reset role;

-- 20-22: tenant_counts.
select set_config('request.jwt.claims', '', true);
select is(public.tenant_counts((select id from public.tenants where slug = 'lagomarsino')),
  '{"users":1,"pending_invitations":0,"published_skills":0}'::jsonb, 'conteo (postgres)');
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is(public.tenant_counts((select id from public.tenants where slug = 'lagomarsino')),
  '{"users":1,"pending_invitations":0,"published_skills":0}'::jsonb, 'conteo (miembro)');
select throws_ok($$ select public.tenant_counts((select id from public.tenants where slug = 'lagomarsino-2')) $$, '42501', null, 'otro tenant no');
reset role;
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.tenant_counts((select id from public.tenants where slug = 'lagomarsino')),
  '{"users":1,"pending_invitations":0,"published_skills":0}'::jsonb, 'conteo (service_role)');
reset role;

-- 23-26: signup_route.
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is(public.signup_route(), 'chat', 'con membresía');
select pg_temp.login_as(3, '[{"method":"otp","timestamp":10}]');
select is(public.signup_route(), 'dominio_tomado', 'dominio de una empresa cerrada');
select pg_temp.login_as(4, '[{"method":"otp","timestamp":10}]');
select is(public.signup_route(), 'sin_acceso', 'dominio público');
select pg_temp.login_as(5, '[{"method":"otp","timestamp":10}]');
select is(public.signup_route(), 'empezar', 'dominio nuevo');
reset role;

-- 27-31: set_onboarding_step.
insert into public.memberships (tenant_id, user_id, role)
values ((select id from public.tenants where slug = 'lagomarsino'), 'a7a7a7a7-0000-0000-0000-000000000006', 'tenant_member');
select pg_temp.login_as(6, '[{"method":"otp","timestamp":10}]');
select throws_ok($$ select public.set_onboarding_step((select id from public.tenants where slug = 'lagomarsino'), 'logo') $$, '42501', null, 'un miembro no');
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select lives_ok($$ select public.set_onboarding_step((select id from public.tenants where slug = 'lagomarsino'), 'logo') $$, 'admin avanza');
select throws_ok($$ select public.set_onboarding_step((select id from public.tenants where slug = 'lagomarsino'), 'otro') $$, '23514', null, 'paso inválido');
select lives_ok($$ select public.set_onboarding_step((select id from public.tenants where slug = 'lagomarsino'), null) $$, 'null completa');
reset role;
select is((select onboarding_completed_at is not null from public.tenants where slug = 'lagomarsino'), true, 'quedó completado');

-- 32-33: suspensión.
update public.tenants set suspended_reason = 'trial_vencido' where slug = 'lagomarsino';
select is(public.tenant_is_writable((select id from public.tenants where slug = 'lagomarsino')), false, 'suspendida no es escribible');
select throws_ok($$ insert into public.brain_folders (tenant_id, path, description)
  values ((select id from public.tenants where slug = 'lagomarsino'), 'x', '') $$, '42501', null, 'el trigger frena la escritura');

-- 34-36: onboarding_research.
insert into public.onboarding_research (tenant_id, status)
select id, 'done' from public.tenants where slug in ('lagomarsino', 'lagomarsino-2');
select pg_temp.login_as(1, '[{"method":"otp","timestamp":10}]');
select is((select count(*) from public.onboarding_research), 1::bigint, 'el admin ve solo la de su empresa');
select throws_ok($$ update public.onboarding_research set status = 'error' $$, '42501', null, 'authenticated no escribe');
select pg_temp.login_as(6, '[{"method":"otp","timestamp":10}]');
select is((select count(*) from public.onboarding_research), 0::bigint, 'un miembro no la ve');
reset role;

select * from finish();
rollback;
