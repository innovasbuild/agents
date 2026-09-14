-- supabase/tests/07_google_tokens_dropped.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select hasnt_table(
  'public', 'google_tokens',
  'el refresh token de Google ya no vive en nuestra base: lo guarda Vercel Connect'
);

select * from finish();
rollback;
