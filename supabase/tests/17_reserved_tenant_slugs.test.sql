begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select throws_ok(
  $$insert into public.tenants (id, slug, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000012', 'brain', 'Brain')$$,
  '23514',
  null,
  'brain está reservado por app/brain'
);

select throws_ok(
  $$insert into public.tenants (id, slug, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000013', 'oauth', 'Oauth')$$,
  '23514',
  null,
  'oauth está reservado por app/oauth'
);

select lives_ok(
  $$insert into public.tenants (id, slug, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000014', 'brainstorm', 'Brainstorm')$$,
  'un slug que solo empieza igual que uno reservado sigue entrando'
);

select * from finish();
rollback;
