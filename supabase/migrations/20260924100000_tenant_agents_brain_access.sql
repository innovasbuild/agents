-- Spec etapa 11 §8.3 (D11): sin declaración, un agente no ve el brain. outreach
-- ya lo usaba, así que se declara acá como dato, no como default en el código.
update public.tenant_agents
set config = config || '{"brain": "read_write"}'::jsonb
where agent = 'outreach'
  and not (config ? 'brain');
