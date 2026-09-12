create table public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  scope text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on table public.google_tokens from anon, authenticated;
