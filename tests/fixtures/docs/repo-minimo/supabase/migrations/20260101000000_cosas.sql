create table public.cosas (id bigint primary key);
create table if not exists public.otras (id bigint primary key);
alter table public.cosas enable row level security;
