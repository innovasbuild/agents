begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@firma.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('e2e2e2e2-0000-0000-0000-000000000001', 'firma', 'Firma');

insert into public.executors (tenant_id, user_id, slug, display_name, title, linkedin_url)
values
  ('e2e2e2e2-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000001', 'ana',
   'Ana López', 'Account Executive', 'https://www.linkedin.com/in/analopez/');

select is(
  (select display_name from public.executors where slug = 'ana'),
  'Ana López',
  'guarda nombre, puesto y LinkedIn'
);

select throws_ok(
  $$update public.executors set linkedin_url = 'https://twitter.com/ana' where slug = 'ana'$$,
  '23514',
  null,
  'linkedin_url tiene que ser un link a linkedin.com/in/'
);

select lives_ok(
  $$update public.executors set linkedin_url = 'https://en.linkedin.com/in/analopez/' where slug = 'ana'$$,
  'acepta subdominios de idioma (en., es., etc.)'
);

select throws_ok(
  $$update public.executors set display_name = '' where slug = 'ana'$$,
  '23514',
  null,
  'display_name vacío no pasa el check de longitud'
);

select * from finish();
rollback;
