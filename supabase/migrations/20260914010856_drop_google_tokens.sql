-- Gmail pasa a Vercel Connect (spec 02 §3.4 y §7). El refresh token nunca
-- más llega a nuestra base.
drop table public.google_tokens;
