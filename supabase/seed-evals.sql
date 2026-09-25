-- Tenant de evals del agente outreach (spec 03 §11.2 y §13.1). Solo local:
-- lo carga `npm run db:reset`; `db:test` corre con --no-seed.
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('e7a1e7a1-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'eval@outreach.test', now()),
  ('e7a1e7a1-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'otro@outreach.test', now())
on conflict (id) do nothing;

insert into public.tenants (id, slug, display_name, allowed_domains)
values ('e7a1e7a1-0000-0000-0000-0000000000aa', 'eval-outreach', 'Eval Outreach', '{outreach.test}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role)
values
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'e7a1e7a1-0000-0000-0000-000000000001', 'tenant_admin'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'e7a1e7a1-0000-0000-0000-000000000002', 'tenant_member')
on conflict (tenant_id, user_id) do nothing;

insert into public.tenant_agents (tenant_id, agent, enabled, config)
values ('e7a1e7a1-0000-0000-0000-0000000000aa', 'outreach', true,
  '{"outreach": {"timezone": "America/Argentina/Buenos_Aires", "bcc": null, "deal": null}, "brain": "read_write"}')
on conflict (tenant_id, agent) do update set enabled = true, config = excluded.config;

insert into public.executors (tenant_id, user_id, slug, daily_quota)
values
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'e7a1e7a1-0000-0000-0000-000000000001', 'eval', 30),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'e7a1e7a1-0000-0000-0000-000000000002', 'otro', 30)
on conflict (tenant_id, user_id) do update set slug = excluded.slug;

insert into public.conversations (id, tenant_id, user_id, agent)
values ('e7a1e7a1-0000-0000-0000-0000000000c1', 'e7a1e7a1-0000-0000-0000-0000000000aa',
  'e7a1e7a1-0000-0000-0000-000000000001', 'outreach')
on conflict (id) do nothing;

insert into public.tenant_connections (tenant_id, capability, provider, config)
values ('e7a1e7a1-0000-0000-0000-0000000000aa', 'brain', 'wiki',
  '{"categories": ["comercial", "marketing"], "requiredFrontmatter": [], "search": "fts"}')
on conflict (tenant_id, capability, provider) do nothing;

insert into public.brain_pages (tenant_id, slug, title, category, tags, body)
values
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'comercial/icp', 'ICP de eval', 'comercial', '{canon:icp}',
   E'# ICP\n\nEmpresas industriales medianas de Argentina, de 50 a 500 empleados, que crecieron en ventas y coordinan pedidos y compras con planillas.'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'comercial/hooks', 'Hooks de eval', 'comercial', '{canon:hooks}',
   E'# Hooks\n\n- h_eval: crecer sin sumar gente al back office. Dolor: el costo de coordinar crece más rápido que la facturación.'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'comercial/gate', 'Vetos de eval', 'comercial', '{canon:gate}',
   E'# Vetos del tenant\n\n```gate\nveto: clientes ... (banco mundial|bid|fao)\nveto_literal: sinergia total\n```'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'marketing/voz-eval', 'Voz del ejecutor eval', 'marketing', '{canon:voz,executor:eval}',
   E'# Voz\n\nTuteo rioplatense, frases cortas, sin adjetivos de venta. Firma: Eval.\n\n## Par 1\n\nBorrador: Quería contarte que ayudamos a empresas a crecer.\nEnviado: Una empresa con dos plantas sabe que coordinar entre ellas cuesta más que vender.\nPor qué: arrancar por el negocio de ellos, no por nosotros, y sin contar que lo investigamos.\n\n```gate\nmax_chars: email=900\n```')
on conflict do nothing;

insert into public.config_values (tenant_id, kind, value, label, meta)
values
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'segmento', 'mid_market_ar', 'Mid market Argentina', '{}'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'hook', 'h_eval', 'Crecer sin duplicar', '{}'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'vector', 'v1_eval', 'Industria mediana AR', '{"default_hook": "h_eval"}'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'idioma', 'es_ar', 'Español rioplatense', '{}'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'idioma', 'es_es', 'Español peninsular', '{}')
on conflict (tenant_id, kind, value) do nothing;

insert into public.accounts (id, tenant_id, domain, name, ficha, researched_at, expires_at)
values ('e7a1e7a1-0000-0000-0000-0000000000a1', 'e7a1e7a1-0000-0000-0000-0000000000aa', 'acme-eval.test', 'Acme Eval',
  '{"name": "Acme Eval", "domain": "acme-eval.test", "produce": "Envases plásticos para alimentos", "gana": "Venta a supermercados regionales", "compra": null, "rompe_si_crece": "La coordinación de pedidos entre dos plantas", "gap_declarado": "Dicen tener procesos ordenados", "gap_demostrable": "Publican búsquedas de administrativos para pedidos", "hechos": [{"hecho": "Abrió una segunda planta en Rafaela en 2026", "url": "https://acme-eval.test/noticias/rafaela", "fecha": "2026-03-01"}], "dolores": [{"dolor": "Coordinar pedidos entre las dos plantas", "por_que_a_ellos": "Con la planta de Rafaela, cada pedido de supermercado puede salir de dos lugares", "beneficio": "Menos pedidos demorados sin sumar administrativos", "evidencia": "https://acme-eval.test/noticias/rafaela"}, {"dolor": "Seguimiento de reposición con cada supermercado", "por_que_a_ellos": "Vende a varias cadenas regionales con reposiciones propias", "beneficio": "Menos quiebres de stock en góndola", "evidencia": null}, {"dolor": "Carga manual de pedidos", "por_que_a_ellos": "Buscan administrativos para pedidos", "beneficio": "El equipo actual absorbe más volumen", "evidencia": null}], "creditos_usados": 0}',
  now(), now() + interval '90 days')
on conflict (tenant_id, domain) do nothing;

insert into public.contacts (tenant_id, contact_key, account_id, name, company, email, owner_user_id, segment, vector, hook, idioma, source)
values
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'em:laura@acme-eval.test', 'e7a1e7a1-0000-0000-0000-0000000000a1',
   'Laura Gómez', 'Acme Eval', 'laura@acme-eval.test', null, 'mid_market_ar', 'v1_eval', 'h_eval', 'es_ar', 'csv'),
  ('e7a1e7a1-0000-0000-0000-0000000000aa', 'em:beto@acme-eval.test', 'e7a1e7a1-0000-0000-0000-0000000000a1',
   'Beto Ruiz', 'Acme Eval', 'beto@acme-eval.test', 'e7a1e7a1-0000-0000-0000-000000000002', 'mid_market_ar', 'v1_eval', 'h_eval', 'es_ar', 'csv')
on conflict (tenant_id, contact_key) do nothing;
