-- Núcleo de datos del agente de outreach (spec 03 §4). Lecturas por RLS para
-- miembros del tenant; escriben solo tools y schedules con la service role.

create type public.outreach_stage as enum (
  'a_contactar', 'msg1_enviado', 'sin_respuesta', 'respuesta_neutra',
  'no_interesado', 'en_conversacion', 'reunion_agendada', 'deal_creado',
  'cliente', 'sin_atribucion'
);
create type public.queue_item_status as enum ('pending', 'approved', 'rejected', 'sent', 'failed', 'expired');
create type public.queue_item_kind as enum ('msg1', 'followup_2', 'followup_3');
create type public.config_value_kind as enum ('segmento', 'vector', 'hook', 'idioma');

-- Ejecutores: identidad en el canon (slug = outreach_owner) y en el CRM.
alter table public.executors
  add column slug text check (slug is null or slug ~ '^[a-z][a-z0-9-]{0,30}$'),
  add column crm_owner_id text check (crm_owner_id is null or length(crm_owner_id) between 1 and 64),
  add column gmail_read_authorized_at timestamptz;

create unique index executors_tenant_slug_idx on public.executors (tenant_id, slug)
  where slug is not null;

create table public.config_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.config_value_kind not null,
  value text not null check (value ~ '^[a-z0-9][a-z0-9_]{0,60}$'),
  label text not null check (length(label) between 1 and 200),
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, value)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null check (domain = lower(domain) and domain !~ '^www\.' and length(domain) between 3 and 253),
  name text not null check (length(name) between 1 and 300),
  ficha jsonb not null,
  researched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, domain),
  unique (id, tenant_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_key text not null check (contact_key ~ '^(em|li|h):.+'),
  account_id uuid,
  name text,
  company text,
  email text check (email is null or email = lower(email)),
  linkedin_slug text,
  crm_id text,
  owner_user_id uuid,
  segment text,
  vector text,
  hook text,
  idioma text,
  stage public.outreach_stage not null default 'a_contactar',
  touches smallint not null default 0 check (touches between 0 and 3),
  first_touch_at timestamptz,
  last_touch_at timestamptz,
  next_step_at timestamptz,
  replied_at timestamptz,
  gmail_thread_id text,
  source text not null check (source in ('csv', 'chat')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_key),
  unique (id, tenant_id),
  foreign key (account_id, tenant_id) references public.accounts (id, tenant_id)
    on delete set null (account_id),
  -- MATCH SIMPLE: con owner_user_id nulo (claim libre) no se chequea.
  foreign key (tenant_id, owner_user_id) references public.executors (tenant_id, user_id)
    on delete set null (owner_user_id)
);

create index contacts_owner_next_step_idx on public.contacts (tenant_id, owner_user_id, next_step_at);
create index contacts_email_idx on public.contacts (tenant_id, email);
create index contacts_account_id_idx on public.contacts (account_id);

-- La escalera solo avanza (spec 03 §4.5). Red de seguridad: la regla fina
-- dentro del rango 2 vive en lib/outreach/stage.ts.
create or replace function public.contacts_stage_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  old_rank smallint;
  new_rank smallint;
begin
  if new.stage = old.stage then
    return new;
  end if;
  if new.stage = 'sin_atribucion' then
    raise exception 'sin_atribucion solo se asigna al crear el contacto'
      using errcode = 'check_violation';
  end if;
  new_rank := case new.stage
    when 'a_contactar' then 0 when 'msg1_enviado' then 1
    when 'reunion_agendada' then 3 when 'deal_creado' then 4 when 'cliente' then 5
    else 2 end;
  if old.stage = 'sin_atribucion' then
    if new_rank < 2 then
      raise exception 'un contacto sin atribución no vuelve al primer toque'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  old_rank := case old.stage
    when 'a_contactar' then 0 when 'msg1_enviado' then 1
    when 'reunion_agendada' then 3 when 'deal_creado' then 4 when 'cliente' then 5
    else 2 end;
  if new_rank < old_rank then
    raise exception 'la escalera de outreach no retrocede: % a %', old.stage, new.stage
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger contacts_stage_guard
  before update of stage on public.contacts
  for each row execute function public.contacts_stage_guard();

create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  contact_key text not null,
  executor_user_id uuid not null,
  kind public.queue_item_kind not null,
  channel text not null default 'email' check (channel = 'email'),
  to_email text not null check (to_email = lower(to_email)),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  hook text not null,
  vector text not null,
  idioma text not null,
  ancla jsonb,
  draft_original jsonb not null,
  gate_result jsonb not null,
  status public.queue_item_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  reply_to_message_id text,
  gmail_thread_id text,
  gmail_message_id text,
  approved_at timestamptz,
  sent_at timestamptz,
  error text,
  eve_session_id text,
  approval_call_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'msg1' or ancla is not null),
  foreign key (contact_id, tenant_id) references public.contacts (id, tenant_id) on delete cascade,
  foreign key (tenant_id, executor_user_id) references public.executors (tenant_id, user_id)
    on delete cascade
);

create unique index queue_items_live_per_contact_idx on public.queue_items (tenant_id, contact_id)
  where status in ('pending', 'approved');
create index queue_items_executor_status_idx on public.queue_items (tenant_id, executor_user_id, status);
create index queue_items_contact_id_idx on public.queue_items (contact_id);

-- events: dedup de 2 horas (kickoff §5, spec 03 §4.7) solo para los tipos
-- idempotentes (efecto de sistema repetible dentro de la ventana); el resto
-- (cambio_etapa, nota, pieza_editada, rechazado, envio_fallido, freno, etc.)
-- nunca se descarta. Respuestas únicas por mensaje además, vía índice aparte.
create index events_dedup_idx on public.events (tenant_id, contact_key, type, created_at desc)
  where contact_key is not null
    and type in (
      'contacto_importado', 'investigado', 'encolado', 'gate_fallido', 'aprobado',
      'envio', 'rebote', 'respuesta', 'claim_ajeno', 'deal_creado',
      'oportunidad_frenada', 'crm_sync_pendiente', 'crm_sync_ok'
    );
create unique index events_inbound_message_idx on public.events (tenant_id, (payload ->> 'gmail_message_id'))
  where type in ('respuesta', 'rebote');

create or replace function public.events_dedup()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_key is null or new.type not in (
    'contacto_importado', 'investigado', 'encolado', 'gate_fallido', 'aprobado',
    'envio', 'rebote', 'respuesta', 'claim_ajeno', 'deal_creado',
    'oportunidad_frenada', 'crm_sync_pendiente', 'crm_sync_ok'
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.events e
    where e.tenant_id = new.tenant_id
      and e.contact_key = new.contact_key
      and e.type = new.type
      and e.actor_user_id is not distinct from new.actor_user_id
      and coalesce(e.payload ->> 'queue_item_id', e.payload ->> 'gmail_message_id', '')
        = coalesce(new.payload ->> 'queue_item_id', new.payload ->> 'gmail_message_id', '')
      and coalesce(e.payload ->> 'deal_id', '') = coalesce(new.payload ->> 'deal_id', '')
      and e.created_at > now() - interval '2 hours'
  ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger events_dedup
  before insert on public.events
  for each row execute function public.events_dedup();

-- runs: lock de los schedules por tenant y día.
alter table public.runs
  add column schedule_key text check (schedule_key is null or length(schedule_key) between 1 and 200);
create unique index runs_schedule_key_idx on public.runs (schedule_key)
  where schedule_key is not null;

-- RLS y grants.
alter table public.config_values enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.queue_items enable row level security;

create policy config_values_select on public.config_values
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy accounts_select on public.accounts
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy contacts_select on public.contacts
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));
create policy queue_items_select on public.queue_items
  for select to authenticated
  using ((select public.is_member_of(tenant_id)) or (select public.is_platform_admin()));

revoke insert, update, delete on public.config_values, public.accounts, public.contacts, public.queue_items
  from authenticated, anon;
revoke select on public.config_values, public.accounts, public.contacts, public.queue_items from anon;

revoke execute on function public.contacts_stage_guard() from public, anon, authenticated;
revoke execute on function public.events_dedup() from public, anon, authenticated;
