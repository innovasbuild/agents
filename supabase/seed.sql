-- Usuarios de prueba locales. En la nube estos usuarios no existen: la
-- membership real de Innovas se crea con un SQL puntual (Step 5).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('99999999-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin-seed@innov.as', now()),
  ('99999999-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ana@demo.test', now())
on conflict (id) do nothing;

insert into public.tenants (id, slug, display_name, allowed_domains, brand)
values
  ('99999999-0000-0000-0000-000000000001', 'innovas-seed', 'INNOV.AS', '{innov.as}',
   '{"primary": "#1D4ED8", "secondary": "#0F172A"}'::jsonb),
  ('99999999-0000-0000-0000-000000000002', 'demo', 'Demo', '{demo.test}',
   '{"primary": "#059669", "secondary": "#064E3B"}'::jsonb)
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role)
values
  ('99999999-0000-0000-0000-000000000001', '99999999-1111-1111-1111-111111111111', 'platform_admin'),
  ('99999999-0000-0000-0000-000000000002', '99999999-2222-2222-2222-222222222222', 'tenant_admin')
on conflict (tenant_id, user_id) do nothing;

-- Sin esta fila el canal rechaza todo, que es el comportamiento correcto.
insert into public.tenant_agents (tenant_id, agent)
values
  ('99999999-0000-0000-0000-000000000001', 'outreach'),
  ('99999999-0000-0000-0000-000000000002', 'outreach')
on conflict (tenant_id, agent) do nothing;
