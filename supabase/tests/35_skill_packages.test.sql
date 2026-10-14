-- supabase/tests/35_skill_packages.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select is(
  (select public from storage.buckets where id = 'skill-packages'),
  false, 'el bucket skill-packages es privado');
select is(
  (select file_size_limit from storage.buckets where id = 'skill-packages'),
  27262976::bigint, 'el zip de una skill puede pesar hasta 26 MB');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%skill-packages%'),
  0, 'ninguna política de storage abre el bucket skill-packages');

select * from finish();
rollback;
