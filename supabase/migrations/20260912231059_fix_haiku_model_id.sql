-- El catalogo real del AI Gateway usa punto como separador de version para
-- Haiku (anthropic/claude-haiku-4.5), no guion. El guion (anthropic/claude-haiku-4-5)
-- quedo mal escrito en el default de tenants.allowed_models y se propago a
-- cualquier tenant creado sin allowed_models explicito. Ver hotfix report en
-- .superpowers/sdd/01-multi-tenant/hotfix-haiku-model-id-report.md
alter table public.tenants
  alter column allowed_models set default '{anthropic/claude-sonnet-5,anthropic/claude-haiku-4.5}';

update public.tenants
set allowed_models = array_replace(allowed_models, 'anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-4.5')
where 'anthropic/claude-haiku-4-5' = any (allowed_models);
