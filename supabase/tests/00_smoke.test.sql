begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select has_table('public', 'tenants', 'el esquema base tiene la tabla tenants');

select * from finish();
rollback;
