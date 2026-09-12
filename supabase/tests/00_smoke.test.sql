begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select has_table('public', 'google_tokens', 'google_tokens existe (migración de la Etapa 0)');

select * from finish();
rollback;
