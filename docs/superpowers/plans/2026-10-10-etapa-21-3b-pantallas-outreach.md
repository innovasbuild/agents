# Etapa 21.3b: pantallas de outreach, presupuestos y retiro de scripts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el administrador del cliente configure segmentos, idiomas, datos de outreach y workflows desde `/<slug>/settings/outreach` y vea su presupuesto y su gasto; que INNOV.AS fije los presupuestos desde la consola; y que `outreach:config`, `workflows:set` y `tenants/innovas/outreach.json` se retiren.

**Architecture:** Mismo patrón que la 21.2: funciones `security definer` que verifican el rol con `settings_actor`, server actions que resuelven la empresa por slug con la sesión, y componentes cliente por sección. Los presupuestos los escribe una función de `service_role` desde la consola de plataforma. El registry de workflows vive en código, así que lo que SQL no puede verificar (que el workflow exista, su tope de ítems) lo verifica la acción.

**Tech Stack:** Next.js (App Router, server actions), TypeScript, zod, vitest con `renderToStaticMarkup`, Supabase Postgres con pgTAP, biome.

**Spec:** `docs/superpowers/specs/2026-10-10-etapa-21-3-config-outreach-design.md` (§4, §5 salvo `outreach_reflect_marco`, §6, §9 y §10). Requiere el plan 21.3a terminado: usa `loadIcpLevels`, `brainForTenant`, `reflectMarcoForTenant` y los tipos de `lib/outreach/canon-blocks.ts`.

## Global Constraints

- Rama `feat/etapa-21-3-config-outreach`. Identidad de git local `innovasbuild` / `matias@innov.as`. Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:`.
- Antes de tocar SQL, cargar la skill `supabase-postgres-best-practices`. Toda tabla lleva `tenant_id` y RLS; este plan no crea tablas. `events` es append-only.
- El cliente no escribe `tenant_budgets` por ningún camino (spec O11). No existe función de `authenticated` que lo haga.
- Hooks y vectores no se editan en settings: `set_list_value` rechaza esas clases (spec O3).
- Un valor de lista nunca se borra, se desactiva (spec O7).
- Ninguna acción toma el `tenant_id` del formulario: resuelve por `slug` con la sesión.
- Cotas: cadencia entre 5 y 10080 minutos; ítems por pasada entre 1 y 1000 y nunca más que `caps.itemsPerTick` del workflow; presupuesto diario entre 0 y 100000.
- Español rioplatense en la UI; código e identificadores en inglés. Nada específico de un tenant en código.
- Un archivo `"use server"` solo exporta funciones `async`: `tests/server-actions-exports.test.ts` lo comprueba.
- Después de cada tarea: `npm run typecheck` y `npm test -- <archivo>`. `npm run lint:fix` reformatea siempre los mismos cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- `npm run db:test` y `npm run db:types` necesitan Docker abierto.

## Review Focus

1. Un administrador apaga el único idioma activo: la base lo rechaza y el interruptor vuelve a su estado (Task 1 y Task 4).
2. Guardar los datos de outreach con el BCC o el deal vacíos: se guardan como `null`, no como cadena vacía que después rompe `parseOutreachConfig` (Task 3).
3. Un workflow encendido con presupuesto 0 en alguno de sus recursos: la pantalla lo dice, porque si no el administrador ve "encendido" y nunca corre (Task 2 y Task 4).
4. Guardar datos de outreach no pisa `brain` ni `approvals` del config del agente (Task 1).
5. Un presupuesto escrito con coma decimal ("2,5") o vacío en la consola: se rechaza con un mensaje, no se guarda 0 ni `NaN` (Task 5).

---

### Task 1: Funciones de la base

**Files:**
- Create: `supabase/migrations/20261018120000_outreach_settings.sql`
- Test: `supabase/tests/32_outreach_settings.test.sql`
- Modify: `lib/supabase/database.types.ts` (generado)

**Interfaces:**
- Consumes: `public.settings_actor(uuid)` (21.2), `public.usage_sum(uuid, text, timestamptz, uuid)`.
- Produces:
  - `set_list_value(p_tenant uuid, p_kind public.config_value_kind, p_value text, p_label text, p_active boolean) returns void` — `authenticated`.
  - `set_outreach_config(p_tenant uuid, p_config jsonb) returns void` — `authenticated`.
  - `set_workflow(p_tenant uuid, p_workflow text, p_enabled boolean, p_cadence_minutes integer, p_items_per_tick integer) returns void` — `authenticated`.
  - `tenant_budget_status(p_tenant uuid, p_resources text[], p_since timestamptz) returns table (resource text, daily_limit numeric, spent numeric)` — `authenticated`. Una fila por recurso pedido; sin fila en `tenant_budgets`, límite 0.
  - `platform_set_budget(p_actor uuid, p_tenant uuid, p_resource text, p_daily_limit numeric) returns void` — `service_role`.

- [ ] **Step 1: Cargar la skill de Postgres**

Invocar `supabase-postgres-best-practices`.

- [ ] **Step 2: Write the failing test**

```sql
-- supabase/tests/32_outreach_settings.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- Personas: 1 admin de os-a, 2 miembro de os-a, 3 admin de os-b, 4 platform_admin (en os-p).
insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('c3c3c3c3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'adm@os-a.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ana@os-a.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'adm@os-b.test', now()),
  ('c3c3c3c3-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'plat@os-p.test', now());

insert into public.tenants (id, slug, display_name)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'os-a', 'OS A'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'os-b', 'OS B'),
  ('d3d3d3d3-0000-0000-0000-00000000000c', 'os-p', 'OS P');

insert into public.memberships (tenant_id, user_id, role)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'c3c3c3c3-0000-0000-0000-000000000001', 'tenant_admin'),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'c3c3c3c3-0000-0000-0000-000000000002', 'tenant_member'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'c3c3c3c3-0000-0000-0000-000000000003', 'tenant_admin'),
  ('d3d3d3d3-0000-0000-0000-00000000000c', 'c3c3c3c3-0000-0000-0000-000000000004', 'platform_admin');

-- Solo os-a tiene el agente de outreach.
insert into public.tenant_agents (tenant_id, agent, config)
values ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach',
        '{"brain": "read", "approvals": {"outreach/otro": "once"}, "outreach": {"timezone": "America/Argentina/Buenos_Aires"}}');

insert into public.config_values (tenant_id, kind, value, label)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg', 'Segmento'),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense');

create function pg_temp.login_as(p_user int) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format(
    '{"sub":"c3c3c3c3-0000-0000-0000-00000000000%s","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}',
    p_user), true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1-4: privilegios.
select ok(has_function_privilege('authenticated', 'public.set_list_value(uuid, public.config_value_kind, text, text, boolean)', 'execute'), 'authenticated ejecuta set_list_value');
select ok(not has_function_privilege('anon', 'public.set_outreach_config(uuid, jsonb)', 'execute'), 'anon no cambia la configuración');
select ok(
  not has_function_privilege('authenticated', 'public.platform_set_budget(uuid, uuid, text, numeric)', 'execute')
  and has_function_privilege('service_role', 'public.platform_set_budget(uuid, uuid, text, numeric)', 'execute'),
  'el presupuesto lo escribe solo service_role');
select ok(not has_function_privilege('anon', 'public.tenant_budget_status(uuid, text[], timestamptz)', 'execute'), 'anon no ve presupuestos');

-- 5-10: quién puede.
select pg_temp.login_as(2);
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_x', 'X', true)$$,
  '42501', null, 'un miembro no edita listas');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 5)$$,
  '42501', null, 'un miembro no enciende workflows');
select throws_ok(
  $$select * from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd'], now() - interval '1 day')$$,
  '42501', null, 'un miembro no ve el gasto');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC"}')$$,
  '42501', null, 'el admin de otra empresa no cambia la configuración');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_x', 'X', true)$$,
  '42501', null, 'ni sus listas');
select pg_temp.login_as(4);
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_plat', 'De plataforma', true)$$,
  'un platform_admin puede');

-- 11-16: set_list_value.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_dos', 'Segundo', true)$$,
  'el admin da de alta un segmento');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'hook', 'h_uno', 'Uno', true)$$,
  '23514', 'los hooks y vectores se editan en el brain', 'no edita hooks');
select throws_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'idioma', 'es_ar', 'Rioplatense', false)$$,
  '23514', null, 'no desactiva el último idioma activo');
select lives_ok(
  $$select public.set_list_value('d3d3d3d3-0000-0000-0000-00000000000a', 'segmento', 'seg_dos', 'Segundo', false)$$,
  'desactiva un segmento habiendo otros');
select pg_temp.logout();
select is(
  (select active::text || '|' || label from public.config_values
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and kind = 'segmento' and value = 'seg_dos'),
  'false|Segundo', 'queda desactivado, no borrado');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'outreach.list_value_updated'
      and actor_user_id = 'c3c3c3c3-0000-0000-0000-000000000001'),
  2, 'cada escritura deja su evento con el actor');

-- 17-22: set_outreach_config.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"America/Montevideo","bcc":null}')$$,
  'el admin guarda la configuración');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '{"timezone":"UTC","icp":{"revision":"x"}}')$$,
  '23514', 'el ICP se edita en el brain', 'rechaza la clave icp');
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000a', '[]')$$,
  '23514', null, 'rechaza lo que no es un objeto');
select pg_temp.logout();
select is(
  (select config #>> '{outreach,timezone}' from public.tenant_agents
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and agent = 'outreach'),
  'America/Montevideo', 'reemplaza la clave outreach');
select is(
  (select (config ->> 'brain') || '|' || (config #>> '{approvals,outreach/otro}') from public.tenant_agents
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and agent = 'outreach'),
  'read|once', 'preserva brain y approvals');
select pg_temp.login_as(3);
select throws_ok(
  $$select public.set_outreach_config('d3d3d3d3-0000-0000-0000-00000000000b', '{"timezone":"UTC"}')$$,
  '23514', 'la empresa no tiene el agente de outreach', 'sin agente no hay configuración que guardar');

-- 23-28: set_workflow.
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 5)$$,
  'crea la fila del workflow');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 4, 5)$$,
  '23514', null, 'cadencia por debajo de 5 minutos');
select throws_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', true, 60, 1001)$$,
  '23514', null, 'ítems por encima de 1000');
select pg_temp.logout();
update public.tenant_workflows set config = config || '{"otra": 1}'
 where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and workflow = 'refresh-fichas';
select pg_temp.login_as(1);
select lives_ok(
  $$select public.set_workflow('d3d3d3d3-0000-0000-0000-00000000000a', 'refresh-fichas', false, 120, 3)$$,
  'edita la fila existente');
select pg_temp.logout();
select is(
  (select enabled::text || '|' || config::text from public.tenant_workflows
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and workflow = 'refresh-fichas'),
  'false|' || '{"otra": 1, "cadence_minutes": 120, "items_per_tick": 3}'::jsonb::text,
  'apaga, cambia cadencia e ítems y preserva las claves ajenas');
select is(
  (select count(*)::int from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'workflow.updated'),
  2, 'cada cambio de workflow deja su evento');

-- 29-34: presupuestos.
select lives_ok(
  $$select public.platform_set_budget('c3c3c3c3-0000-0000-0000-000000000004', 'd3d3d3d3-0000-0000-0000-00000000000a', 'model_usd', 2.5)$$,
  'plataforma fija un presupuesto');
select throws_ok(
  $$select public.platform_set_budget('c3c3c3c3-0000-0000-0000-000000000004', 'd3d3d3d3-0000-0000-0000-00000000000a', 'model_usd', -1)$$,
  '23514', null, 'rechaza un límite negativo');
select is(
  (select daily_limit::text || '|' || updated_by::text from public.tenant_budgets
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and resource = 'model_usd'),
  '2.500000|c3c3c3c3-0000-0000-0000-000000000004', 'guarda el límite y quién lo puso');
select is(
  (select payload ->> 'to' from public.events
    where tenant_id = 'd3d3d3d3-0000-0000-0000-00000000000a' and type = 'budget.updated'),
  '2.5', 'deja el evento con el límite nuevo');

insert into public.usage_entries (tenant_id, node, resource, amount, unit, created_at)
values
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach/research', 'model_usd', 0.4, 'usd', now()),
  ('d3d3d3d3-0000-0000-0000-00000000000a', 'outreach/research', 'model_usd', 9, 'usd', now() - interval '2 days'),
  ('d3d3d3d3-0000-0000-0000-00000000000b', 'outreach/research', 'model_usd', 7, 'usd', now());

select pg_temp.login_as(1);
select results_eq(
  $$select resource, daily_limit::numeric, spent::numeric
      from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd', 'apollo_credits'], now() - interval '1 day')
     order by resource$$,
  $$values ('apollo_credits'::text, 0::numeric, 0::numeric), ('model_usd'::text, 2.5::numeric, 0.4::numeric)$$,
  'una fila por recurso pedido: límite (0 sin fila) y gasto desde la fecha, solo de esta empresa');
select pg_temp.login_as(3);
select throws_ok(
  $$select * from public.tenant_budget_status('d3d3d3d3-0000-0000-0000-00000000000a', array['model_usd'], now() - interval '1 day')$$,
  '42501', null, 'otra empresa no ve este gasto');

-- 35: las tablas siguen cerradas a escritura directa.
select pg_temp.login_as(1);
select throws_ok(
  $$insert into public.tenant_budgets (tenant_id, resource, daily_limit) values ('d3d3d3d3-0000-0000-0000-00000000000a', 'apollo_credits', 100)$$,
  '42501', null, 'el admin no escribe presupuestos directo');

select pg_temp.logout();
select * from finish();
rollback;
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run db:test`
Expected: el archivo 32 falla con `function public.set_list_value(...) does not exist`.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20261018120000_outreach_settings.sql
-- Configuración de outreach desde la UI (spec 21.3 §5). El cliente escribe
-- por funciones que verifican adentro que quien llama administra la empresa
-- (settings_actor, 21.2); los presupuestos los fija plataforma.

create or replace function public.set_list_value(
  p_tenant uuid, p_kind public.config_value_kind, p_value text, p_label text, p_active boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  -- Hooks y vectores salen del brain (spec O3): acá no se tocan.
  if p_kind is null or p_kind not in ('segmento', 'idioma') then
    raise exception 'los hooks y vectores se editan en el brain' using errcode = '23514', hint = 'settings';
  end if;
  if p_value is null or p_value !~ '^[a-z0-9][a-z0-9_]{0,60}$' then
    raise exception 'el identificador va en minúsculas, dígitos y guion bajo' using errcode = '23514', hint = 'settings';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 200 then
    raise exception 'el rótulo tiene que tener entre 1 y 200 caracteres' using errcode = '23514', hint = 'settings';
  end if;
  if p_active is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;
  if not p_active and not exists (
    select 1 from public.config_values c
     where c.tenant_id = p_tenant and c.kind = p_kind and c.active and c.value <> p_value
  ) then
    raise exception 'tiene que quedar al menos uno activo' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.config_values as cv (tenant_id, kind, value, label, active, updated_at)
  values (p_tenant, p_kind, p_value, btrim(p_label), p_active, now())
  on conflict (tenant_id, kind, value) do update
    set label = excluded.label, active = excluded.active, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'outreach.list_value_updated', p_kind::text || ' ' || p_value,
          jsonb_build_object('kind', p_kind, 'value', p_value, 'label', btrim(p_label), 'active', p_active));
end;
$$;

create or replace function public.set_outreach_config(
  p_tenant uuid, p_config jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'la configuración tiene que ser un objeto' using errcode = '23514', hint = 'settings';
  end if;
  if p_config ? 'icp' then
    raise exception 'el ICP se edita en el brain' using errcode = '23514', hint = 'settings';
  end if;

  -- Solo la clave outreach: brain y approvals tienen sus propias funciones.
  update public.tenant_agents
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{outreach}', p_config)
   where tenant_id = p_tenant and agent = 'outreach';
  if not found then
    raise exception 'la empresa no tiene el agente de outreach' using errcode = '23514', hint = 'settings';
  end if;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'outreach.config_updated', 'datos de outreach',
          jsonb_build_object('config', p_config));
end;
$$;

create or replace function public.set_workflow(
  p_tenant uuid, p_workflow text, p_enabled boolean, p_cadence_minutes integer, p_items_per_tick integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settings_actor(p_tenant);
  v_before public.tenant_workflows%rowtype;
  v_patch jsonb;
begin
  if p_workflow is null or p_workflow !~ '^[a-z][a-z0-9-]{0,99}$' then
    raise exception 'ese proceso no existe' using errcode = '23514', hint = 'settings';
  end if;
  if p_enabled is null then
    raise exception 'falta el estado' using errcode = '23514', hint = 'settings';
  end if;
  if p_cadence_minutes is null or p_cadence_minutes not between 5 and 10080 then
    raise exception 'la cadencia va de 5 minutos a 7 días' using errcode = '23514', hint = 'settings';
  end if;
  if p_items_per_tick is null or p_items_per_tick not between 1 and 1000 then
    raise exception 'los ítems por pasada van de 1 a 1000' using errcode = '23514', hint = 'settings';
  end if;

  select * into v_before from public.tenant_workflows w
   where w.tenant_id = p_tenant and w.workflow = p_workflow
     for update;

  v_patch := jsonb_build_object('cadence_minutes', p_cadence_minutes, 'items_per_tick', p_items_per_tick);

  insert into public.tenant_workflows as w (tenant_id, workflow, enabled, config)
  values (p_tenant, p_workflow, p_enabled, v_patch)
  on conflict (tenant_id, workflow) do update
    set enabled = excluded.enabled,
        config = coalesce(w.config, '{}'::jsonb) || excluded.config;

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, v_actor, 'workflow.updated', p_workflow,
          jsonb_build_object(
            'workflow', p_workflow,
            'enabled', jsonb_build_object('from', coalesce(v_before.enabled, false), 'to', p_enabled),
            'config', jsonb_build_object(
              'from', coalesce(v_before.config, '{}'::jsonb),
              'to', coalesce(v_before.config, '{}'::jsonb) || v_patch)));
end;
$$;

-- Límite y gasto por recurso desde una fecha (spec O12). El gasto por corrida
-- y usage_entries siguen cerrados: esto solo agrega por recurso.
create or replace function public.tenant_budget_status(
  p_tenant uuid, p_resources text[], p_since timestamptz
) returns table (resource text, daily_limit numeric, spent numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.settings_actor(p_tenant);
  if p_resources is null or p_since is null or coalesce(array_length(p_resources, 1), 0) > 20 then
    raise exception 'pedido de presupuesto inválido' using errcode = '23514', hint = 'settings';
  end if;
  return query
    select r.name,
           coalesce(b.daily_limit, 0)::numeric,
           public.usage_sum(p_tenant, r.name, p_since)
      from unnest(p_resources) as r(name)
      left join public.tenant_budgets b
        on b.tenant_id = p_tenant and b.resource = r.name;
end;
$$;

create or replace function public.platform_set_budget(
  p_actor uuid, p_tenant uuid, p_resource text, p_daily_limit numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before numeric;
begin
  if p_actor is null then
    raise exception 'falta el actor';
  end if;
  if p_resource is null or p_resource !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'ese recurso no existe' using errcode = '23514', hint = 'consola';
  end if;
  if p_daily_limit is null or p_daily_limit < 0 or p_daily_limit > 100000 then
    raise exception 'el límite diario va de 0 a 100000' using errcode = '23514', hint = 'consola';
  end if;

  select b.daily_limit into v_before from public.tenant_budgets b
   where b.tenant_id = p_tenant and b.resource = p_resource
     for update;

  insert into public.tenant_budgets as b (tenant_id, resource, daily_limit, updated_by, updated_at)
  values (p_tenant, p_resource, p_daily_limit, p_actor, now())
  on conflict (tenant_id, resource) do update
    set daily_limit = excluded.daily_limit, updated_by = excluded.updated_by, updated_at = now();

  insert into public.events (tenant_id, actor_user_id, type, summary, payload)
  values (p_tenant, p_actor, 'budget.updated', p_resource || ': ' || p_daily_limit || ' por día',
          jsonb_build_object('resource', p_resource, 'from', v_before, 'to', p_daily_limit));
end;
$$;

revoke execute on function public.set_list_value(uuid, public.config_value_kind, text, text, boolean) from public, anon;
revoke execute on function public.set_outreach_config(uuid, jsonb) from public, anon;
revoke execute on function public.set_workflow(uuid, text, boolean, integer, integer) from public, anon;
revoke execute on function public.tenant_budget_status(uuid, text[], timestamptz) from public, anon;
revoke execute on function public.platform_set_budget(uuid, uuid, text, numeric) from public, anon, authenticated;

grant execute on function public.set_list_value(uuid, public.config_value_kind, text, text, boolean) to authenticated;
grant execute on function public.set_outreach_config(uuid, jsonb) to authenticated;
grant execute on function public.set_workflow(uuid, text, boolean, integer, integer) to authenticated;
grant execute on function public.tenant_budget_status(uuid, text[], timestamptz) to authenticated;
grant execute on function public.platform_set_budget(uuid, uuid, text, numeric) to service_role;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run db:test`
Expected: PASS, el 32 con 35 pruebas. Dos cosas a mirar si falla:
- La prueba 27 compara el `config` como texto de `jsonb`. Postgres reordena las claves al guardar, pero el lado esperado pasa por el mismo `::jsonb::text`, así que el orden coincide solo.
- La prueba 32 espera `'2.5'`: `jsonb_build_object` con un `numeric` conserva los decimales que se le pasaron (2.5), no los de la columna.

- [ ] **Step 6: Regenerar tipos y commit**

```bash
npm run db:types
git add supabase/migrations/20261018120000_outreach_settings.sql supabase/tests/32_outreach_settings.test.sql lib/supabase/database.types.ts
git commit -m "feat: funciones de listas, datos de outreach, workflows y presupuestos"
```

---

### Task 2: Lectura pura de listas, workflows y presupuestos

**Files:**
- Create: `lib/workflows/settings.ts`
- Create: `lib/outreach/outreach-settings-query.ts`
- Test: `tests/workflows/settings.test.ts`, `tests/outreach/outreach-settings-query.test.ts`

**Interfaces:**
- Consumes: `WORKFLOWS` (`lib/workflows/registry.ts`), `DEFAULT_CADENCE_MINUTES` (`lib/workflows/config.ts`).
- Produces:
  ```ts
  // lib/workflows/settings.ts
  interface BudgetRow { resource: string; dailyLimit: number; spent: number }
  interface WorkflowRow {
    workflow: string; enabled: boolean; cadenceMinutes: number; itemsPerTick: number;
    maxItemsPerTick: number; lastRunAt: string | null; resources: string[]; unfunded: string[];
  }
  budgetResources(agent?: string): string[]
  toBudgetRows(raw: readonly unknown[]): BudgetRow[]
  workflowRows(tenantWorkflows: readonly unknown[], budgets: readonly BudgetRow[], agent?: string): WorkflowRow[]
  resourceLabel(resource: string): string
  // lib/outreach/outreach-settings-query.ts
  type ListKind = "segmento" | "idioma" | "hook" | "vector"
  interface ListValueRow { kind: ListKind; value: string; label: string; active: boolean; defaultHook: string | null }
  toListValues(raw: readonly unknown[]): ListValueRow[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/workflows/settings.test.ts
import { describe, expect, it } from "vitest";
import { WORKFLOWS } from "@/lib/workflows/registry";
import {
	budgetResources,
	resourceLabel,
	toBudgetRows,
	workflowRows,
} from "@/lib/workflows/settings";

describe("budgetResources", () => {
	it("los recursos que usan los workflows del agente, sin repetir y ordenados", () => {
		const expected = [
			...new Set(
				Object.values(WORKFLOWS)
					.filter((wf) => wf.agent === "outreach")
					.flatMap((wf) => wf.resources),
			),
		].sort();
		expect(budgetResources()).toEqual(expected);
		expect(budgetResources("no-existe")).toEqual([]);
	});
});

describe("toBudgetRows", () => {
	it("normaliza números que llegan como texto y descarta filas sin recurso", () => {
		expect(
			toBudgetRows([
				{ resource: "model_usd", daily_limit: "2.500000", spent: "0.4" },
				{ resource: "apollo_credits", daily_limit: 0, spent: null },
				{ daily_limit: 1 },
			]),
		).toEqual([
			{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 },
			{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
		]);
	});
});

describe("workflowRows", () => {
	const budgets = [
		{ resource: "model_usd", dailyLimit: 2, spent: 0 },
		{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
	];

	it("una fila por workflow del registry, con defaults si la empresa no tiene fila", () => {
		const rows = workflowRows([], budgets);
		expect(rows.map((row) => row.workflow)).toEqual(
			Object.keys(WORKFLOWS).filter((name) => WORKFLOWS[name].agent === "outreach"),
		);
		const refresh = rows.find((row) => row.workflow === "refresh-fichas");
		expect(refresh).toEqual({
			workflow: "refresh-fichas",
			enabled: false,
			cadenceMinutes: 60,
			itemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			maxItemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			lastRunAt: null,
			resources: ["model_usd"],
			unfunded: [],
		});
	});

	it("lee la fila de la empresa y recorta los ítems al tope del registry", () => {
		const [row] = workflowRows(
			[
				{
					workflow: "refresh-fichas",
					enabled: true,
					config: { cadence_minutes: 120, items_per_tick: 999 },
					last_run_at: "2026-10-10T12:00:00Z",
				},
			],
			budgets,
		).filter((r) => r.workflow === "refresh-fichas");
		expect(row).toMatchObject({
			enabled: true,
			cadenceMinutes: 120,
			itemsPerTick: WORKFLOWS["refresh-fichas"].caps.itemsPerTick,
			lastRunAt: "2026-10-10T12:00:00Z",
		});
	});

	it("marca los recursos sin presupuesto: con límite 0 o sin fila", () => {
		const rows = workflowRows([], [{ resource: "model_usd", dailyLimit: 2, spent: 0 }]);
		const search = rows.find((row) => row.workflow === "target-search");
		expect(search?.unfunded).toEqual(["apollo_credits"]);
	});

	it("ignora filas de workflows que ya no están en el registry", () => {
		expect(
			workflowRows([{ workflow: "viejo", enabled: true, config: {} }], budgets).some(
				(row) => row.workflow === "viejo",
			),
		).toBe(false);
	});
});

describe("resourceLabel", () => {
	it("rotula los conocidos y deja el identificador de los demás", () => {
		expect(resourceLabel("model_usd")).toBe("Modelos de IA (USD)");
		expect(resourceLabel("apollo_credits")).toBe("Créditos de búsqueda");
		expect(resourceLabel("otro")).toBe("otro");
	});
});
```

```ts
// tests/outreach/outreach-settings-query.test.ts
import { describe, expect, it } from "vitest";
import { toListValues } from "@/lib/outreach/outreach-settings-query";

describe("toListValues", () => {
	it("normaliza, ordena por clase y rótulo, y lee el hook por defecto del vector", () => {
		expect(
			toListValues([
				{ kind: "vector", value: "v_uno", label: "Vector", active: true, meta: { default_hook: "h_uno" } },
				{ kind: "segmento", value: "b", label: "Zeta", active: false, meta: {} },
				{ kind: "segmento", value: "a", label: "Alfa", active: true, meta: null },
				{ kind: "otra", value: "x", label: "X", active: true },
				{ kind: "hook", value: "h_uno", label: "Hook" },
			]),
		).toEqual([
			{ kind: "segmento", value: "a", label: "Alfa", active: true, defaultHook: null },
			{ kind: "segmento", value: "b", label: "Zeta", active: false, defaultHook: null },
			{ kind: "hook", value: "h_uno", label: "Hook", active: false, defaultHook: null },
			{ kind: "vector", value: "v_uno", label: "Vector", active: true, defaultHook: "h_uno" },
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/workflows/settings.test.ts tests/outreach/outreach-settings-query.test.ts`
Expected: FAIL, los módulos no existen.

- [ ] **Step 3: Implementar**

```ts
// lib/workflows/settings.ts
// Lo que muestran las pantallas de workflows y presupuestos (spec 21.3 §4 y
// §6.1). Puro: recibe las filas crudas y el registry.
import { DEFAULT_CADENCE_MINUTES } from "./config";
import { WORKFLOWS } from "./registry";

export interface BudgetRow {
	resource: string;
	dailyLimit: number;
	spent: number;
}

export interface WorkflowRow {
	workflow: string;
	enabled: boolean;
	cadenceMinutes: number;
	itemsPerTick: number;
	maxItemsPerTick: number;
	lastRunAt: string | null;
	resources: string[];
	/** Recursos que usa y tienen límite 0: con uno solo, el workflow no corre. */
	unfunded: string[];
}

const RESOURCE_LABELS: Record<string, string> = {
	model_usd: "Modelos de IA (USD)",
	apollo_credits: "Créditos de búsqueda",
};

export function resourceLabel(resource: string): string {
	return Object.hasOwn(RESOURCE_LABELS, resource)
		? RESOURCE_LABELS[resource]
		: resource;
}

export function budgetResources(agent = "outreach"): string[] {
	return [
		...new Set(
			Object.values(WORKFLOWS)
				.filter((wf) => wf.agent === agent)
				.flatMap((wf) => wf.resources),
		),
	].sort();
}

const num = (value: unknown): number => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

export function toBudgetRows(raw: readonly unknown[]): BudgetRow[] {
	return raw.flatMap((entry) => {
		const row = entry as Record<string, unknown>;
		return typeof row.resource === "string"
			? [
					{
						resource: row.resource,
						dailyLimit: num(row.daily_limit),
						spent: num(row.spent),
					},
				]
			: [];
	});
}

const positiveInt = (value: unknown): number | null =>
	typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;

export function workflowRows(
	tenantWorkflows: readonly unknown[],
	budgets: readonly BudgetRow[],
	agent = "outreach",
): WorkflowRow[] {
	const byName = new Map(
		tenantWorkflows.map((entry) => {
			const row = entry as Record<string, unknown>;
			return [String(row.workflow), row] as const;
		}),
	);
	const limits = new Map(budgets.map((b) => [b.resource, b.dailyLimit]));

	return Object.entries(WORKFLOWS)
		.filter(([, info]) => info.agent === agent)
		.map(([workflow, info]) => {
			const row = byName.get(workflow);
			const config = (row?.config ?? {}) as Record<string, unknown>;
			const max = info.caps.itemsPerTick;
			return {
				workflow,
				enabled: row?.enabled === true,
				cadenceMinutes:
					positiveInt(config.cadence_minutes) ?? DEFAULT_CADENCE_MINUTES,
				itemsPerTick: Math.min(positiveInt(config.items_per_tick) ?? max, max),
				maxItemsPerTick: max,
				lastRunAt:
					typeof row?.last_run_at === "string" ? row.last_run_at : null,
				resources: [...info.resources],
				unfunded: info.resources.filter(
					(resource) => (limits.get(resource) ?? 0) <= 0,
				),
			};
		});
}
```

```ts
// lib/outreach/outreach-settings-query.ts
// Normalización de config_values para /settings/outreach (spec 21.3 §6.1).
export type ListKind = "segmento" | "idioma" | "hook" | "vector";

export interface ListValueRow {
	kind: ListKind;
	value: string;
	label: string;
	active: boolean;
	defaultHook: string | null;
}

const ORDER: ListKind[] = ["segmento", "idioma", "hook", "vector"];

export function toListValues(raw: readonly unknown[]): ListValueRow[] {
	return raw
		.flatMap((entry) => {
			const row = entry as Record<string, unknown>;
			const kind = row.kind as ListKind;
			if (!ORDER.includes(kind) || typeof row.value !== "string") return [];
			const meta = (row.meta ?? {}) as Record<string, unknown>;
			return [
				{
					kind,
					value: row.value,
					label: typeof row.label === "string" ? row.label : row.value,
					active: row.active === true,
					defaultHook:
						typeof meta.default_hook === "string" ? meta.default_hook : null,
				},
			];
		})
		.sort(
			(a, b) =>
				ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
				a.label.localeCompare(b.label, "es"),
		);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/workflows/settings.test.ts tests/outreach/outreach-settings-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add lib/workflows/settings.ts lib/outreach/outreach-settings-query.ts tests/workflows/settings.test.ts tests/outreach/outreach-settings-query.test.ts
git commit -m "feat: lectura pura de listas, workflows y presupuestos para settings"
```

---

### Task 3: Acciones del cliente

**Files:**
- Create: `app/[tenant]/settings/action-helpers.ts`
- Modify: `app/[tenant]/settings/config-actions.ts` (usar los helpers)
- Create: `app/[tenant]/settings/outreach/actions.ts`
- Test: `tests/settings/outreach-actions.test.ts`

**Interfaces:**
- Consumes: funciones de Task 1; `outreachConfigSchema`, `SUPPORTED_IDIOMAS` (`lib/outreach/config.ts`); `isWorkflow`, `WORKFLOWS`; `reflectMarcoForTenant` (21.3a).
- Produces:
  ```ts
  // action-helpers.ts (sin "use server")
  type ConfigResult = { ok: true; message?: string } | { ok: false; message: string }
  const SIN_PERMISO, INVALIDO, GENERICO: ConfigResult
  adminOf(slug: string): Promise<{ supabase; tenantId: string; allowedModels: string[] } | ConfigResult>
  fromDbError(error: { code?: string; message: string; hint?: string | null }): ConfigResult
  // outreach/actions.ts ("use server")
  saveListValue(slug: string, kind: string, value: string, label: string, active: boolean): Promise<ConfigResult>
  saveOutreachConfig(slug: string, input: OutreachConfigInput): Promise<ConfigResult>
  saveWorkflow(slug: string, workflow: string, input: { enabled: boolean; cadenceMinutes: number; itemsPerTick: number }): Promise<ConfigResult>
  rereadMarco(slug: string): Promise<ConfigResult>
  ```
  `OutreachConfigInput = { timezone: string; bcc: string; dealPipeline: string; dealStage: string; companyName: string; companyUrl: string; models: Record<string, string> }` — todo texto, como sale del formulario; vacío significa "sin dato".

- [ ] **Step 1: Extraer los helpers compartidos**

Crear `app/[tenant]/settings/action-helpers.ts` moviendo desde `config-actions.ts`, sin cambiar su lógica, `ConfigResult`, `SIN_PERMISO`, `INVALIDO`, `GENERICO`, `slugSchema`, el tipo `Supabase`, `adminOf` y `fromDbError`, todos exportados. Dos cambios:

```ts
// Sin "use server": un archivo de acciones solo puede exportar funciones
// async, y esto exporta constantes y tipos. Lo importan las acciones de
// settings (config-actions.ts y outreach/actions.ts).
export type ConfigResult =
	| { ok: true; message?: string }
	| { ok: false; message: string };
```

y `adminOf` devuelve además los modelos permitidos:

```ts
export async function adminOf(
	slug: string,
): Promise<
	{ supabase: Supabase; tenantId: string; allowedModels: string[] } | ConfigResult
> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant || tenant.role === "tenant_member") return SIN_PERMISO;

	const supabase = await createServerSupabase();
	if (!(await actionAllowsLogin(supabase, tenant.userId, tenant.id))) {
		return SIN_PERMISO;
	}
	return {
		supabase,
		tenantId: tenant.id,
		allowedModels: tenant.allowedModels ?? [],
	};
}
```

En `config-actions.ts`, borrar lo movido e importar:

```ts
import {
	adminOf,
	type ConfigResult,
	fromDbError,
	INVALIDO,
} from "./action-helpers";
```

Como `config-actions.ts` exportaba `export type ConfigResult`, buscar quién lo importa de ahí (`grep -rn "ConfigResult" app tests`) y apuntarlo a `./action-helpers`. Un `export type` desde un archivo `"use server"` está permitido, pero no hace falta mantenerlo.

Run: `npm run typecheck && npm test -- tests/settings tests/server-actions-exports.test.ts`
Expected: PASS sin tocar los tests de la 21.2: el comportamiento no cambió.

```bash
git add "app/[tenant]/settings"
git commit -m "refactor: los helpers de permiso de las acciones de settings se comparten"
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/settings/outreach-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOWS } from "@/lib/workflows/registry";

const TENANT = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
	access: null as {
		id: string;
		slug: string;
		role: string;
		userId: string;
		allowedModels: string[];
	} | null,
	allows: true,
	rpc: { data: null, error: null } as {
		data: unknown;
		error: { code?: string; message: string; hint?: string } | null;
	},
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	revalidated: [] as string[],
	reflect: { ok: true, upserts: 2, deactivated: 1, unchanged: 3 } as Record<string, unknown>,
	reflectCalls: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.access,
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async () => state.allows,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
	}),
}));
vi.mock("@/lib/outreach/marco-reflect", () => ({
	reflectMarcoForTenant: async (tenantId: string) => {
		state.reflectCalls.push(tenantId);
		return state.reflect;
	},
}));

const actions = await import("@/app/[tenant]/settings/outreach/actions");

const SIN_PERMISO = { ok: false, message: "No tenés permiso." };
const INVALIDO = { ok: false, message: "No se pudo procesar el pedido." };
const CONFIG = {
	timezone: "America/Montevideo",
	bcc: "",
	dealPipeline: "",
	dealStage: "",
	companyName: "",
	companyUrl: "",
	models: {} as Record<string, string>,
};
const WF = { enabled: true, cadenceMinutes: 60, itemsPerTick: 2 };

beforeEach(() => {
	state.access = {
		id: TENANT,
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
		allowedModels: ["anthropic/claude-sonnet-5"],
	};
	state.allows = true;
	state.rpc = { data: null, error: null };
	state.rpcCalls = [];
	state.revalidated = [];
	state.reflect = { ok: true, upserts: 2, deactivated: 1, unchanged: 3 };
	state.reflectCalls = [];
});

describe("permisos", () => {
	it("un miembro no llama a la base ni relee el brain", async () => {
		state.access = { ...(state.access as NonNullable<typeof state.access>), role: "tenant_member" };
		expect(await actions.saveListValue("acme", "segmento", "seg", "Seg", true)).toEqual(SIN_PERMISO);
		expect(await actions.saveOutreachConfig("acme", CONFIG)).toEqual(SIN_PERMISO);
		expect(await actions.saveWorkflow("acme", "refresh-fichas", WF)).toEqual(SIN_PERMISO);
		expect(await actions.rereadMarco("acme")).toEqual(SIN_PERMISO);
		expect(state.rpcCalls).toHaveLength(0);
		expect(state.reflectCalls).toHaveLength(0);
	});
});

describe("saveListValue", () => {
	it("llama set_list_value con la empresa de la sesión y revalida", async () => {
		expect(await actions.saveListValue("acme", "segmento", "mid_market", " Mid market ", true)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_list_value",
				args: { p_tenant: TENANT, p_kind: "segmento", p_value: "mid_market", p_label: "Mid market", p_active: true },
			},
		]);
		expect(state.revalidated).toEqual(["/acme/settings/outreach"]);
	});

	it("hooks y vectores se rechazan sin llamar a la base", async () => {
		expect(await actions.saveListValue("acme", "hook", "h_uno", "Uno", true)).toEqual({
			ok: false,
			message: "Los hooks y vectores se editan en el brain.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un idioma que la plataforma no soporta se rechaza", async () => {
		expect(await actions.saveListValue("acme", "idioma", "pt_br", "Portugués", true)).toEqual({
			ok: false,
			message: "Ese idioma todavía no está disponible.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("muestra el mensaje de la base cuando trae hint settings", async () => {
		state.rpc = { data: null, error: { code: "23514", message: "tiene que quedar al menos uno activo", hint: "settings" } };
		expect(await actions.saveListValue("acme", "idioma", "es_ar", "Rioplatense", false)).toEqual({
			ok: false,
			message: "tiene que quedar al menos uno activo",
		});
	});
});

describe("saveOutreachConfig", () => {
	it("los campos vacíos viajan como null, no como cadena vacía", async () => {
		expect(await actions.saveOutreachConfig("acme", CONFIG)).toEqual({ ok: true });
		expect(state.rpcCalls[0]).toEqual({
			fn: "set_outreach_config",
			args: {
				p_tenant: TENANT,
				p_config: {
					timezone: "America/Montevideo",
					bcc: null,
					deal: null,
					company: null,
					models: {},
				},
			},
		});
	});

	it("arma deal, empresa y modelos cuando vienen completos", async () => {
		await actions.saveOutreachConfig("acme", {
			timezone: "America/Montevideo",
			bcc: "bcc@acme.test",
			dealPipeline: "default",
			dealStage: "123",
			companyName: "Acme",
			companyUrl: "https://acme.test",
			models: { draft_msg1: "anthropic/claude-sonnet-5", classify: "" },
		});
		expect(state.rpcCalls[0].args.p_config).toEqual({
			timezone: "America/Montevideo",
			bcc: "bcc@acme.test",
			deal: { pipeline: "default", stage: "123" },
			company: { name: "Acme", url: "https://acme.test" },
			models: { draft_msg1: "anthropic/claude-sonnet-5" },
		});
	});

	it.each([
		["zona horaria inválida", { ...CONFIG, timezone: "Marte/Olympus" }, "Revisá la zona horaria."],
		["BCC que no es un mail", { ...CONFIG, bcc: "no-es-mail" }, "Revisá el mail de BCC."],
		["deal a medias", { ...CONFIG, dealPipeline: "default" }, "El deal necesita pipeline y etapa, o ninguno de los dos."],
		["empresa a medias", { ...CONFIG, companyName: "Acme" }, "La empresa que firma necesita nombre y URL, o ninguno de los dos."],
		["URL inválida", { ...CONFIG, companyName: "Acme", companyUrl: "acme" }, "Revisá la URL de la empresa."],
		[
			"modelo fuera de los permitidos",
			{ ...CONFIG, models: { draft_msg1: "otro/modelo" } },
			"Ese modelo no está entre los permitidos de la empresa.",
		],
		["rol de modelo desconocido", { ...CONFIG, models: { inventado: "anthropic/claude-sonnet-5" } }, "No se pudo procesar el pedido."],
	])("%s: no llama a la base", async (_name, input, message) => {
		expect(await actions.saveOutreachConfig("acme", input)).toEqual({ ok: false, message });
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("saveWorkflow", () => {
	it("llama set_workflow", async () => {
		expect(await actions.saveWorkflow("acme", "refresh-fichas", WF)).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_workflow",
				args: {
					p_tenant: TENANT,
					p_workflow: "refresh-fichas",
					p_enabled: true,
					p_cadence_minutes: 60,
					p_items_per_tick: 2,
				},
			},
		]);
	});

	it("un workflow que no está en el registry no llega a la base", async () => {
		expect(await actions.saveWorkflow("acme", "inventado", WF)).toEqual({
			ok: false,
			message: "Ese proceso no existe.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("los ítems no pasan el tope del workflow", async () => {
		const max = WORKFLOWS["refresh-fichas"].caps.itemsPerTick;
		expect(
			await actions.saveWorkflow("acme", "refresh-fichas", { ...WF, itemsPerTick: max + 1 }),
		).toEqual({ ok: false, message: `Ese proceso admite hasta ${max} por pasada.` });
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("números que no son enteros se rechazan", async () => {
		expect(await actions.saveWorkflow("acme", "refresh-fichas", { ...WF, cadenceMinutes: 60.5 })).toEqual(INVALIDO);
		expect(await actions.saveWorkflow("acme", "refresh-fichas", { ...WF, cadenceMinutes: Number.NaN })).toEqual(INVALIDO);
	});
});

describe("rereadMarco", () => {
	it("relee el brain de la empresa de la sesión y cuenta lo que cambió", async () => {
		expect(await actions.rereadMarco("acme")).toEqual({
			ok: true,
			message: "Listo: 2 altas o cambios, 1 bajas, 3 sin cambios.",
		});
		expect(state.reflectCalls).toEqual([TENANT]);
		expect(state.revalidated).toEqual(["/acme/settings/outreach"]);
	});

	it.each([
		["sin_brain", [], "La empresa no tiene brain habilitado."],
		["brain_caido", [], "No pude leer el brain. Probá de nuevo."],
		["falta", [], "No encontré bloques hooks y vectores en páginas activas con el tag canon:hooks."],
		["invalido", ["a, línea 2: x", "b, línea 3: y"], "Los bloques no son válidos: a, línea 2: x · b, línea 3: y"],
	])("%s", async (reason, errors, message) => {
		state.reflect = { ok: false, reason, errors };
		expect(await actions.rereadMarco("acme")).toEqual({ ok: false, message });
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/settings/outreach-actions.test.ts`
Expected: FAIL, el módulo no existe.

- [ ] **Step 4: Implementar las acciones**

```ts
// app/[tenant]/settings/outreach/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	DEFAULT_OUTREACH_MODELS,
	outreachConfigSchema,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { reflectMarcoForTenant } from "@/lib/outreach/marco-reflect";
import { isWorkflow, WORKFLOWS } from "@/lib/workflows/registry";
import {
	adminOf,
	type ConfigResult,
	fromDbError,
	INVALIDO,
} from "../action-helpers";

type Admin = Exclude<Awaited<ReturnType<typeof adminOf>>, ConfigResult>;

async function call(
	slug: string,
	admin: Admin,
	fn: "set_list_value" | "set_outreach_config" | "set_workflow",
	args: Record<string, unknown>,
): Promise<ConfigResult> {
	// rpc() no valida nombre ni argumentos contra los tipos en este repo: los
	// tests de esta acción afirman ambos.
	const { error } = await admin.supabase.rpc(fn, args as never);
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings/outreach`);
	return { ok: true };
}

const fail = (message: string): ConfigResult => ({ ok: false, message });

const listSchema = z.object({
	kind: z.enum(["segmento", "idioma"]),
	value: z.string().min(1).max(61),
	label: z.string().trim().min(1).max(200),
	active: z.boolean(),
});

export async function saveListValue(
	slug: string,
	kind: string,
	value: string,
	label: string,
	active: boolean,
): Promise<ConfigResult> {
	if (kind === "hook" || kind === "vector") {
		return fail("Los hooks y vectores se editan en el brain.");
	}
	const parsed = listSchema.safeParse({ kind, value, label, active });
	if (!parsed.success) return INVALIDO;
	if (
		parsed.data.kind === "idioma" &&
		!(SUPPORTED_IDIOMAS as readonly string[]).includes(parsed.data.value)
	) {
		return fail("Ese idioma todavía no está disponible.");
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin, "set_list_value", {
		p_tenant: admin.tenantId,
		p_kind: parsed.data.kind,
		p_value: parsed.data.value,
		p_label: parsed.data.label,
		p_active: parsed.data.active,
	});
}

const text = z.string().max(300);
const inputSchema = z.object({
	timezone: text,
	bcc: text,
	dealPipeline: text,
	dealStage: text,
	companyName: text,
	companyUrl: text,
	models: z.record(z.string(), text),
});

const FIELD_MESSAGES: Record<string, string> = {
	timezone: "Revisá la zona horaria.",
	bcc: "Revisá el mail de BCC.",
	company: "Revisá la URL de la empresa.",
	models: "Revisá los modelos.",
	deal: "Revisá el deal.",
};

export async function saveOutreachConfig(
	slug: string,
	input: unknown,
): Promise<ConfigResult> {
	const parsed = inputSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;
	const form = parsed.data;
	const blank = (value: string) => value.trim() === "";

	if (blank(form.dealPipeline) !== blank(form.dealStage)) {
		return fail("El deal necesita pipeline y etapa, o ninguno de los dos.");
	}
	if (blank(form.companyName) !== blank(form.companyUrl)) {
		return fail(
			"La empresa que firma necesita nombre y URL, o ninguno de los dos.",
		);
	}
	const roles = Object.keys(DEFAULT_OUTREACH_MODELS);
	if (Object.keys(form.models).some((role) => !roles.includes(role))) {
		return INVALIDO;
	}
	// Vacío es "usar el default de la plataforma": la clave no viaja.
	const models = Object.fromEntries(
		Object.entries(form.models).filter(([, model]) => !blank(model)),
	);

	// El mismo schema que valida al leer: lo que se guarda siempre se puede leer.
	const config = outreachConfigSchema.safeParse({
		timezone: form.timezone.trim(),
		bcc: blank(form.bcc) ? null : form.bcc.trim(),
		deal: blank(form.dealPipeline)
			? null
			: { pipeline: form.dealPipeline.trim(), stage: form.dealStage.trim() },
		company: blank(form.companyName)
			? null
			: { name: form.companyName.trim(), url: form.companyUrl.trim() },
		models,
	});
	if (!config.success) {
		const field = String(config.error.issues[0]?.path[0] ?? "");
		return fail(FIELD_MESSAGES[field] ?? "Revisá los datos.");
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	if (Object.values(models).some((m) => !admin.allowedModels.includes(m))) {
		return fail("Ese modelo no está entre los permitidos de la empresa.");
	}

	return call(slug, admin, "set_outreach_config", {
		p_tenant: admin.tenantId,
		p_config: config.data,
	});
}

const workflowSchema = z.object({
	enabled: z.boolean(),
	cadenceMinutes: z.number().int(),
	itemsPerTick: z.number().int(),
});

export async function saveWorkflow(
	slug: string,
	workflow: string,
	input: unknown,
): Promise<ConfigResult> {
	// El registry vive en código: la base no sabe qué workflows existen ni su tope.
	if (typeof workflow !== "string" || !isWorkflow(workflow)) {
		return fail("Ese proceso no existe.");
	}
	const parsed = workflowSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;
	const max = WORKFLOWS[workflow].caps.itemsPerTick;
	if (parsed.data.itemsPerTick > max) {
		return fail(`Ese proceso admite hasta ${max} por pasada.`);
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin, "set_workflow", {
		p_tenant: admin.tenantId,
		p_workflow: workflow,
		p_enabled: parsed.data.enabled,
		p_cadence_minutes: parsed.data.cadenceMinutes,
		p_items_per_tick: parsed.data.itemsPerTick,
	});
}

const REREAD_MESSAGES: Record<string, string> = {
	sin_brain: "La empresa no tiene brain habilitado.",
	brain_caido: "No pude leer el brain. Probá de nuevo.",
	falta:
		"No encontré bloques hooks y vectores en páginas activas con el tag canon:hooks.",
};

/** Relee hooks y vectores del brain de la empresa de la sesión. No recibe
 * contenido del navegador: el reflejo corre con service role, así que el
 * permiso se comprueba acá antes (spec 21.3 §7). */
export async function rereadMarco(slug: string): Promise<ConfigResult> {
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	const result = await reflectMarcoForTenant(admin.tenantId);
	if (!result.ok) {
		return fail(
			result.reason === "invalido"
				? `Los bloques no son válidos: ${result.errors.slice(0, 3).join(" · ")}`
				: REREAD_MESSAGES[result.reason],
		);
	}
	revalidatePath(`/${slug}/settings/outreach`);
	return {
		ok: true,
		message: `Listo: ${result.upserts} altas o cambios, ${result.deactivated} bajas, ${result.unchanged} sin cambios.`,
	};
}
```

El schema del test "URL inválida" depende de que el primer `issue` de zod tenga `path[0] === "company"`, y "BCC que no es un mail" de `path[0] === "bcc"`. Si zod los ordena distinto, ordenar los `issues` no es la solución: validar esos dos campos antes de `outreachConfigSchema` con `z.email()` y `z.url()` y devolver su mensaje.

- [ ] **Step 5: Run tests**

Run: `npm run typecheck && npm test -- tests/settings tests/server-actions-exports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/[tenant]/settings/outreach/actions.ts" tests/settings/outreach-actions.test.ts
git commit -m "feat: acciones del cliente para listas, datos de outreach, workflows y releer el brain"
```

---

### Task 4: Pantalla `/<slug>/settings/outreach`

**Files:**
- Create: `app/[tenant]/settings/outreach/page.tsx`
- Create: `app/[tenant]/settings/outreach/lists-section.tsx`
- Create: `app/[tenant]/settings/outreach/config-form.tsx`
- Create: `app/[tenant]/settings/outreach/workflows-section.tsx`
- Create: `app/[tenant]/settings/outreach/readonly-sections.tsx`
- Modify: `app/[tenant]/settings/page.tsx` (link)
- Test: `tests/settings/outreach-sections.test.ts`

**Interfaces:**
- Consumes: acciones de Task 3; `ListValueRow`, `WorkflowRow`, `BudgetRow`, `resourceLabel` (Task 2); `IcpLevels` (21.3a); `runRowAction`, `Feedback` (`app/[tenant]/settings/usuarios/run-row-action.ts`).
- Produces: componentes `ListsSection`, `OutreachConfigForm`, `WorkflowsSection` (cliente) e `IcpSummary`, `MarcoSummary`, `BudgetSummary` (sin estado).

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings/outreach-sections.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/outreach/actions", () => ({
	saveListValue: async () => ({ ok: true }),
	saveOutreachConfig: async () => ({ ok: true }),
	saveWorkflow: async () => ({ ok: true }),
	rereadMarco: async () => ({ ok: true }),
}));

const { ListsSection } = await import("@/app/[tenant]/settings/outreach/lists-section");
const { OutreachConfigForm } = await import("@/app/[tenant]/settings/outreach/config-form");
const { WorkflowsSection } = await import("@/app/[tenant]/settings/outreach/workflows-section");
const { BudgetSummary, IcpSummary, MarcoSummary } = await import(
	"@/app/[tenant]/settings/outreach/readonly-sections"
);

const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);

describe("ListsSection", () => {
	const values = [
		{ kind: "segmento" as const, value: "mid", label: "Mid market", active: true, defaultHook: null },
		{ kind: "segmento" as const, value: "viejo", label: "Viejo", active: false, defaultHook: null },
		{ kind: "idioma" as const, value: "es_ar", label: "Rioplatense", active: true, defaultHook: null },
	];

	it("muestra segmentos e idiomas con su estado y el alta", () => {
		const html = render(
			createElement(ListsSection, { slug: "acme", values, idiomas: ["es_ar", "es_es"] }),
		);
		expect(html).toContain("Mid market");
		expect(html).toContain("Viejo");
		expect(html).toContain("Desactivado");
		expect(html).toContain("Agregar segmento");
		// Solo se ofrecen los idiomas que faltan.
		expect(html).toMatch(/<option[^>]*value="es_es"/);
		expect(html).not.toMatch(/<option[^>]*value="es_ar"/);
	});
});

describe("OutreachConfigForm", () => {
	it("precarga los datos y ofrece solo los modelos permitidos", () => {
		const html = render(
			createElement(OutreachConfigForm, {
				slug: "acme",
				initial: {
					timezone: "America/Montevideo",
					bcc: "bcc@acme.test",
					dealPipeline: "default",
					dealStage: "123",
					companyName: "Acme",
					companyUrl: "https://acme.test",
					models: { draft_msg1: "anthropic/claude-sonnet-5" },
				},
				allowedModels: ["anthropic/claude-sonnet-5"],
				defaults: { draft_msg1: "anthropic/claude-opus-5" },
			}),
		);
		expect(html).toMatch(/<input[^>]*value="America\/Montevideo"/);
		expect(html).toMatch(/<input[^>]*value="bcc@acme.test"/);
		expect(html).toContain("anthropic/claude-sonnet-5");
		expect(html).toContain("El de la plataforma (anthropic/claude-opus-5)");
	});
});

describe("WorkflowsSection", () => {
	const row = {
		workflow: "target-search",
		enabled: true,
		cadenceMinutes: 60,
		itemsPerTick: 2,
		maxItemsPerTick: 2,
		lastRunAt: null,
		resources: ["apollo_credits"],
		unfunded: ["apollo_credits"],
	};

	it("avisa cuando un workflow encendido no tiene presupuesto", () => {
		const html = render(createElement(WorkflowsSection, { slug: "acme", workflows: [row] }));
		expect(html).toContain("target-search");
		expect(html).toContain(
			"No va a correr: INNOV.AS todavía no cargó presupuesto de Créditos de búsqueda.",
		);
		expect(html).toMatch(/<input[^>]*max="2"/);
		expect(html).toContain("Todavía no corrió");
	});

	it("con presupuesto no avisa", () => {
		const html = render(
			createElement(WorkflowsSection, { slug: "acme", workflows: [{ ...row, unfunded: [] }] }),
		);
		expect(html).not.toContain("No va a correr");
	});
});

describe("secciones de solo lectura", () => {
	it("ICP: muestra los niveles o el motivo, con link al brain", () => {
		const ok = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: {
					ok: true,
					value: {
						encaje_empresa: ["No encaja: afuera", "Encaja: adentro"],
						rol_decisor: ["Sin relación", "Decide"],
						excluir: "Es competidora",
					},
				},
			}),
		);
		expect(ok).toContain("Encaja: adentro");
		expect(ok).toContain('href="/acme/brain"');

		const missing = render(
			createElement(IcpSummary, { slug: "acme", icp: { ok: false, reason: "falta", errors: [] } }),
		);
		expect(missing).toContain("Todavía no hay un ICP");

		const invalid = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: { ok: false, reason: "invalido", errors: ["comercial/icp, línea 2: corto"] },
			}),
		);
		expect(invalid).toContain("comercial/icp, línea 2: corto");
	});

	it("marco: lista activos, hook por defecto y el fallo del último reflejo", () => {
		const html = render(
			createElement(MarcoSummary, {
				slug: "acme",
				values: [
					{ kind: "hook" as const, value: "h_uno", label: "Hook uno", active: true, defaultHook: null },
					{ kind: "hook" as const, value: "h_viejo", label: "Viejo", active: false, defaultHook: null },
					{ kind: "vector" as const, value: "v_uno", label: "Vector", active: true, defaultHook: "h_uno" },
				],
				lastFailure: { at: "2026-10-10T12:00:00Z", errors: ["a, línea 2: x"] },
			}),
		);
		expect(html).toContain("Hook uno");
		expect(html).not.toContain("Viejo");
		expect(html).toContain("h_uno");
		expect(html).toContain("a, línea 2: x");
		expect(html).toContain("Releer del brain");
	});

	it("presupuesto: límite y gastado por recurso", () => {
		const html = render(
			createElement(BudgetSummary, {
				budgets: [{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 }],
			}),
		);
		expect(html).toContain("Modelos de IA (USD)");
		expect(html).toContain("0,40");
		expect(html).toContain("2,50");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settings/outreach-sections.test.ts`
Expected: FAIL, los componentes no existen.

- [ ] **Step 3: Componentes de solo lectura**

```tsx
// app/[tenant]/settings/outreach/readonly-sections.tsx
// Lo que el cliente ve pero no edita acá (spec 21.3 §4.1): el ICP y el marco
// viven en el brain, y el presupuesto lo fija INNOV.AS.
import Link from "next/link";
import type { CanonLoad } from "@/lib/outreach/canon";
import type { IcpLevels } from "@/lib/outreach/canon-blocks";
import type { ListValueRow } from "@/lib/outreach/outreach-settings-query";
import { type BudgetRow, resourceLabel } from "@/lib/workflows/settings";
import { RereadButton } from "./lists-section";

const BrainLink = ({ slug, children }: { slug: string; children: string }) => (
	<Link className="text-sm underline underline-offset-4" href={`/${slug}/brain`}>
		{children}
	</Link>
);

const ICP_MISSING: Record<string, string> = {
	sin_brain: "La empresa no tiene brain habilitado.",
	brain_caido: "No pude leer el brain. Recargá la página.",
	falta:
		"Todavía no hay un ICP. Completá el bloque icp de la página con el tag canon:icp y pasala a estado activo.",
};

export function IcpSummary({
	slug,
	icp,
}: {
	slug: string;
	icp: CanonLoad<IcpLevels>;
}) {
	if (!icp.ok) {
		return (
			<div className="space-y-2">
				<p className="text-muted-foreground text-sm">
					{icp.reason === "invalido"
						? "El bloque icp del brain no es válido, así que no se califica a nadie:"
						: ICP_MISSING[icp.reason]}
				</p>
				{icp.errors.length > 0 ? (
					<ul className="list-disc pl-5 text-destructive text-sm">
						{icp.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				) : null}
				<BrainLink slug={slug}>Abrir el brain →</BrainLink>
			</div>
		);
	}
	const { encaje_empresa, rol_decisor, excluir } = icp.value;
	return (
		<div className="space-y-3 text-sm">
			{(
				[
					["Encaje de la empresa", encaje_empresa],
					["Rol de la persona", rol_decisor],
				] as const
			).map(([title, levels]) => (
				<div key={title}>
					<h3 className="mb-1 font-medium">{title}</h3>
					<ol className="list-decimal pl-5 text-muted-foreground">
						{levels.map((level) => (
							<li key={level}>{level}</li>
						))}
					</ol>
				</div>
			))}
			<p>
				<span className="font-medium">Se excluye si:</span>{" "}
				<span className="text-muted-foreground">{excluir}</span>
			</p>
			<BrainLink slug={slug}>Editar en el brain →</BrainLink>
		</div>
	);
}

export function MarcoSummary({
	slug,
	values,
	lastFailure,
}: {
	slug: string;
	values: ListValueRow[];
	lastFailure: { at: string; errors: string[] } | null;
}) {
	const active = (kind: ListValueRow["kind"]) =>
		values.filter((row) => row.kind === kind && row.active);
	return (
		<div className="space-y-3 text-sm">
			<p className="text-muted-foreground">
				Salen de los bloques hooks y vectores de las páginas del brain con el
				tag canon:hooks. Se actualizan solos al guardar esas páginas.
			</p>
			{lastFailure ? (
				<div className="rounded-lg border border-destructive/40 px-4 py-3">
					<p className="text-destructive">
						La última lectura del brain falló, así que sigue vigente la lista
						anterior:
					</p>
					<ul className="list-disc pl-5 text-destructive">
						{lastFailure.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			) : null}
			{(
				[
					["Hooks", active("hook")],
					["Vectores", active("vector")],
				] as const
			).map(([title, rows]) => (
				<div key={title}>
					<h3 className="mb-1 font-medium">{title}</h3>
					{rows.length === 0 ? (
						<p className="text-muted-foreground">Todavía no hay ninguno.</p>
					) : (
						<ul className="divide-y rounded-lg border bg-card">
							{rows.map((row) => (
								<li className="flex flex-wrap gap-x-3 px-4 py-2" key={row.value}>
									<span className="min-w-0 flex-1">{row.label}</span>
									<span className="font-mono text-muted-foreground text-xs">
										{row.value}
										{row.defaultHook ? ` → ${row.defaultHook}` : ""}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			))}
			<div className="flex flex-wrap items-center gap-4">
				<BrainLink slug={slug}>Editar en el brain →</BrainLink>
				<RereadButton slug={slug} />
			</div>
		</div>
	);
}

const amount = (value: number) =>
	value.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

export function BudgetSummary({ budgets }: { budgets: BudgetRow[] }) {
	return (
		<div className="space-y-2 text-sm">
			<p className="text-muted-foreground">
				Es el tope diario de los procesos automáticos. Lo fija INNOV.AS; el
				gasto del chat también cuenta.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{budgets.map((budget) => (
					<li className="flex flex-wrap gap-x-3 px-4 py-3" key={budget.resource}>
						<span className="min-w-0 flex-1">
							{resourceLabel(budget.resource)}
						</span>
						<span className="tabular-nums">
							{amount(budget.spent)} de {amount(budget.dailyLimit)} hoy
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
```

- [ ] **Step 4: Listas (y el botón de releer)**

```tsx
// app/[tenant]/settings/outreach/lists-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ListValueRow } from "@/lib/outreach/outreach-settings-query";
import type { ConfigResult } from "../action-helpers";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { rereadMarco, saveListValue } from "./actions";

/** Corre una acción de settings y devuelve qué mostrar. */
function useAction() {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const run = (action: () => Promise<ConfigResult>, onFail?: () => void) => {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: action,
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			if (out.failed) onFail?.();
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	};
	return { pending, feedback, run };
}

export function Message({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<span
			className={
				feedback.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"
			}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</span>
	);
}

export function RereadButton({ slug }: { slug: string }) {
	const { pending, feedback, run } = useAction();
	return (
		<span className="inline-flex flex-wrap items-center gap-2">
			<Button
				disabled={pending}
				onClick={() => run(() => rereadMarco(slug))}
				size="sm"
				type="button"
				variant="outline"
			>
				Releer del brain
			</Button>
			<Message feedback={feedback} />
		</span>
	);
}

const INPUT = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

function ValueRow({ slug, row }: { slug: string; row: ListValueRow }) {
	const { pending, feedback, run } = useAction();
	const [label, setLabel] = useState(row.label);
	const [active, setActive] = useState(row.active);

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<input
				aria-label={`Rótulo de ${row.value}`}
				className={`${INPUT} min-w-0 flex-1`}
				disabled={pending}
				maxLength={200}
				onChange={(event) => setLabel(event.target.value)}
				value={label}
			/>
			<span className="font-mono text-muted-foreground text-xs">{row.value}</span>
			{active ? null : (
				<span className="text-muted-foreground text-xs">Desactivado</span>
			)}
			<Message feedback={feedback} />
			<Button
				disabled={pending || label.trim() === "" || label === row.label}
				onClick={() =>
					run(() => saveListValue(slug, row.kind, row.value, label, active))
				}
				size="sm"
				type="button"
				variant="outline"
			>
				Guardar
			</Button>
			<Button
				disabled={pending}
				onClick={() => {
					const next = !active;
					setActive(next);
					// Si la base lo rechaza (el último activo), vuelve a como estaba.
					run(
						() => saveListValue(slug, row.kind, row.value, row.label, next),
						() => setActive(!next),
					);
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				{active ? "Desactivar" : "Activar"}
			</Button>
		</li>
	);
}

function AddSegment({ slug }: { slug: string }) {
	const { pending, feedback, run } = useAction();
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");
	return (
		<form
			className="flex flex-wrap items-center gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				run(() => saveListValue(slug, "segmento", value, label, true));
			}}
		>
			<input
				aria-label="Identificador del segmento"
				className={INPUT}
				disabled={pending}
				onChange={(event) => setValue(event.target.value)}
				pattern="[a-z0-9][a-z0-9_]{0,60}"
				placeholder="identificador_sin_espacios"
				required
				value={value}
			/>
			<input
				aria-label="Rótulo del segmento"
				className={`${INPUT} min-w-0 flex-1`}
				disabled={pending}
				maxLength={200}
				onChange={(event) => setLabel(event.target.value)}
				placeholder="Cómo se muestra"
				required
				value={label}
			/>
			<Button disabled={pending} size="sm" type="submit">
				Agregar segmento
			</Button>
			<Message feedback={feedback} />
		</form>
	);
}

const IDIOMA_LABELS: Record<string, string> = {
	es_ar: "Español rioplatense",
	es_es: "Español de España",
};

function AddIdioma({ slug, options }: { slug: string; options: string[] }) {
	const { pending, feedback, run } = useAction();
	const [value, setValue] = useState(options[0] ?? "");
	if (options.length === 0) return null;
	return (
		<form
			className="flex flex-wrap items-center gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				run(() =>
					saveListValue(slug, "idioma", value, IDIOMA_LABELS[value] ?? value, true),
				);
			}}
		>
			<select
				aria-label="Idioma a agregar"
				className={INPUT}
				disabled={pending}
				onChange={(event) => setValue(event.target.value)}
				value={value}
			>
				{options.map((option) => (
					<option key={option} value={option}>
						{IDIOMA_LABELS[option] ?? option}
					</option>
				))}
			</select>
			<Button disabled={pending} size="sm" type="submit">
				Agregar idioma
			</Button>
			<Message feedback={feedback} />
		</form>
	);
}

export function ListsSection({
	slug,
	values,
	idiomas,
}: {
	slug: string;
	values: ListValueRow[];
	/** Los idiomas que soporta la plataforma. */
	idiomas: readonly string[];
}) {
	const of = (kind: ListValueRow["kind"]) =>
		values.filter((row) => row.kind === kind);
	const taken = new Set(of("idioma").map((row) => row.value));
	return (
		<div className="space-y-6">
			{(
				[
					["Segmentos", of("segmento")],
					["Idiomas", of("idioma")],
				] as const
			).map(([title, rows]) => (
				<div className="space-y-2" key={title}>
					<h3 className="font-medium text-sm">{title}</h3>
					{rows.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Todavía no hay ninguno.
						</p>
					) : (
						<ul className="divide-y rounded-lg border bg-card">
							{rows.map((row) => (
								<ValueRow key={`${row.kind}:${row.value}`} row={row} slug={slug} />
							))}
						</ul>
					)}
					{title === "Segmentos" ? (
						<AddSegment slug={slug} />
					) : (
						<AddIdioma
							options={idiomas.filter((idioma) => !taken.has(idioma))}
							slug={slug}
						/>
					)}
				</div>
			))}
		</div>
	);
}
```

- [ ] **Step 5: Formulario de datos**

```tsx
// app/[tenant]/settings/outreach/config-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { saveOutreachConfig } from "./actions";
import { Message } from "./lists-section";

export interface OutreachConfigDraft {
	timezone: string;
	bcc: string;
	dealPipeline: string;
	dealStage: string;
	companyName: string;
	companyUrl: string;
	models: Record<string, string>;
}

const MODEL_ROLES: Record<string, string> = {
	draft_msg1: "Primer mensaje",
	draft_followup: "Seguimientos",
	classify: "Clasificar respuestas",
	researcher: "Investigar cuentas",
};

const INPUT =
	"h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function OutreachConfigForm({
	slug,
	initial,
	allowedModels,
	defaults,
}: {
	slug: string;
	initial: OutreachConfigDraft;
	allowedModels: string[];
	/** El modelo que usa la plataforma si la empresa no elige uno. */
	defaults: Record<string, string>;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [draft, setDraft] = useState(initial);
	const set = (patch: Partial<OutreachConfigDraft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const field = (
		label: string,
		key: Exclude<keyof OutreachConfigDraft, "models">,
		help?: string,
	) => (
		<label className="block space-y-1 text-sm">
			<span>{label}</span>
			<input
				className={INPUT}
				disabled={pending}
				maxLength={300}
				onChange={(event) => set({ [key]: event.target.value })}
				value={draft[key]}
			/>
			{help ? <span className="text-muted-foreground text-xs">{help}</span> : null}
		</label>
	);

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				setFeedback(null);
				startTransition(async () => {
					const out = await runRowAction({
						run: () => saveOutreachConfig(slug, draft),
						confirm: () => true,
						refresh: () => router.refresh(),
					});
					setFeedback(
						out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
					);
				});
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{field("Zona horaria", "timezone", "Por ejemplo America/Argentina/Buenos_Aires.")}
				{field("Copia oculta (BCC)", "bcc", "Mail que recibe copia de cada envío. Vacío: sin copia.")}
				{field("Pipeline del deal", "dealPipeline", "Vacío: no se crean deals.")}
				{field("Etapa inicial del deal", "dealStage")}
				{field("Empresa que firma", "companyName")}
				{field("URL de la empresa", "companyUrl")}
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{Object.entries(MODEL_ROLES).map(([role, label]) => (
					<label className="block space-y-1 text-sm" key={role}>
						<span>Modelo: {label}</span>
						<select
							className={INPUT}
							disabled={pending}
							onChange={(event) =>
								set({ models: { ...draft.models, [role]: event.target.value } })
							}
							value={draft.models[role] ?? ""}
						>
							<option value="">
								El de la plataforma ({defaults[role] ?? "sin definir"})
							</option>
							{allowedModels.map((model) => (
								<option key={model} value={model}>
									{model}
								</option>
							))}
						</select>
					</label>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button disabled={pending} type="submit">
					Guardar datos
				</Button>
				<Message feedback={feedback} />
			</div>
		</form>
	);
}
```

- [ ] **Step 6: Workflows**

```tsx
// app/[tenant]/settings/outreach/workflows-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resourceLabel, type WorkflowRow } from "@/lib/workflows/settings";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { saveWorkflow } from "./actions";
import { Message } from "./lists-section";

const INPUT = "h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm";

const when = (value: string | null) =>
	value
		? `Última corrida: ${new Date(value).toLocaleString("es-AR")}`
		: "Todavía no corrió";

function Row({ slug, row }: { slug: string; row: WorkflowRow }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [enabled, setEnabled] = useState(row.enabled);
	const [cadence, setCadence] = useState(String(row.cadenceMinutes));
	const [items, setItems] = useState(String(row.itemsPerTick));

	function save(nextEnabled: boolean) {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () =>
					saveWorkflow(slug, row.workflow, {
						enabled: nextEnabled,
						cadenceMinutes: Number(cadence),
						itemsPerTick: Number(items),
					}),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			// Si no se guardó, el estado vuelve a lo que la base tiene.
			setEnabled(out.failed ? row.enabled : nextEnabled);
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="space-y-2 px-4 py-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="font-mono text-sm">{row.workflow}</div>
					<div className="text-muted-foreground text-xs">
						{when(row.lastRunAt)} · usa {row.resources.map(resourceLabel).join(" y ")}
					</div>
				</div>
				<Message feedback={feedback} />
				<Button
					disabled={pending}
					onClick={() => save(!enabled)}
					size="sm"
					type="button"
					variant={enabled ? "outline" : "default"}
				>
					{enabled ? "Apagar" : "Encender"}
				</Button>
			</div>
			<div className="flex flex-wrap items-end gap-3 text-sm">
				<label className="space-y-1">
					<span className="block text-xs">Cada cuántos minutos</span>
					<input
						className={INPUT}
						disabled={pending}
						max={10080}
						min={5}
						onChange={(event) => setCadence(event.target.value)}
						type="number"
						value={cadence}
					/>
				</label>
				<label className="space-y-1">
					<span className="block text-xs">
						Por pasada (hasta {row.maxItemsPerTick})
					</span>
					<input
						className={INPUT}
						disabled={pending}
						max={row.maxItemsPerTick}
						min={1}
						onChange={(event) => setItems(event.target.value)}
						type="number"
						value={items}
					/>
				</label>
				<Button
					disabled={pending}
					onClick={() => save(enabled)}
					size="sm"
					type="button"
					variant="outline"
				>
					Guardar
				</Button>
			</div>
			{enabled && row.unfunded.length > 0 ? (
				<p className="text-destructive text-xs">
					No va a correr: INNOV.AS todavía no cargó presupuesto de{" "}
					{row.unfunded.map(resourceLabel).join(" ni de ")}.
				</p>
			) : null}
		</li>
	);
}

export function WorkflowsSection({
	slug,
	workflows,
}: {
	slug: string;
	workflows: WorkflowRow[];
}) {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm">
				Son los procesos que corren solos. Cada uno gasta de tu presupuesto
				diario; apagado no gasta nada.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{workflows.map((row) => (
					<Row key={row.workflow} row={row} slug={slug} />
				))}
			</ul>
		</div>
	);
}
```

- [ ] **Step 7: Run the component tests**

Run: `npm test -- tests/settings/outreach-sections.test.ts`
Expected: PASS. `renderToStaticMarkup` escapa el apóstrofo y los signos, no las vocales con tilde: si un `toContain` con texto en castellano falla, mirar el HTML real con `console.log(html)` antes de cambiar el componente.

- [ ] **Step 8: La página**

```tsx
// app/[tenant]/settings/outreach/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	brainForTenant,
	type CanonLoad,
	loadIcpLevels,
} from "@/lib/outreach/canon";
import type { IcpLevels } from "@/lib/outreach/canon-blocks";
import {
	DEFAULT_OUTREACH_MODELS,
	parseOutreachConfig,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { toListValues } from "@/lib/outreach/outreach-settings-query";
import { dayStart } from "@/lib/outreach/time";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import {
	budgetResources,
	toBudgetRows,
	workflowRows,
} from "@/lib/workflows/settings";
import { OutreachConfigForm } from "./config-form";
import { ListsSection } from "./lists-section";
import {
	BudgetSummary,
	IcpSummary,
	MarcoSummary,
} from "./readonly-sections";
import { WorkflowsSection } from "./workflows-section";

const Unreadable = () => (
	<p className="text-muted-foreground text-sm">
		No pude leer esta sección. Recargá la página.
	</p>
);

const MARCO_EVENTS = ["outreach.marco_reflected", "outreach.marco_reflect_failed"];

export default async function OutreachSettingsPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();
	const { data: agent, error: agentError } = await supabase
		.from("tenant_agents")
		.select("config, enabled")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		.maybeSingle();
	if (agentError) console.error("outreach settings: tenant_agents:", agentError);
	// Sin el agente habilitado no hay nada que configurar acá.
	if (!agentError && agent?.enabled !== true) notFound();

	// Una config guardada rota no puede dejar al administrador sin pantalla
	// para arreglarla: se muestra el formulario con los defaults.
	let config: ReturnType<typeof parseOutreachConfig>;
	let rawModels: Record<string, string> = {};
	try {
		const raw = (agent?.config as { outreach?: unknown } | null)?.outreach;
		config = parseOutreachConfig(raw);
		rawModels =
			((raw as { models?: Record<string, string> } | null)?.models as
				| Record<string, string>
				| undefined) ?? {};
	} catch (error) {
		console.error("outreach settings: config inválida:", error);
		config = parseOutreachConfig({});
	}

	const resources = budgetResources();
	const since = dayStart(config.timezone, new Date()).toISOString();
	const [valuesResult, workflowsResult, budgetsResult, eventsResult, icp] =
		await Promise.all([
			supabase
				.from("config_values")
				.select("kind, value, label, active, meta")
				.eq("tenant_id", tenant.id),
			supabase
				.from("tenant_workflows")
				.select("workflow, enabled, config, last_run_at")
				.eq("tenant_id", tenant.id),
			supabase.rpc("tenant_budget_status", {
				p_tenant: tenant.id,
				p_resources: resources,
				p_since: since,
			} as never),
			supabase
				.from("events")
				.select("type, payload, created_at")
				.eq("tenant_id", tenant.id)
				.in("type", MARCO_EVENTS)
				.order("created_at", { ascending: false })
				.limit(1),
			brainForTenant(tenant.id)
				.then(loadIcpLevels)
				.catch((error): CanonLoad<IcpLevels> => {
					console.error("outreach settings: brain:", error);
					return { ok: false, reason: "brain_caido", errors: [] };
				}),
		]);
	for (const [name, result] of [
		["config_values", valuesResult],
		["tenant_workflows", workflowsResult],
		["tenant_budget_status", budgetsResult],
		["events", eventsResult],
	] as const) {
		if (result.error) console.error(`outreach settings: ${name}:`, result.error);
	}

	const values = toListValues(valuesResult.data ?? []);
	const budgets = toBudgetRows((budgetsResult.data as unknown[] | null) ?? []);
	const lastEvent = eventsResult.data?.[0];
	const lastFailure =
		lastEvent?.type === "outreach.marco_reflect_failed"
			? {
					at: lastEvent.created_at as string,
					errors:
						((lastEvent.payload as { errors?: unknown } | null)?.errors as
							| string[]
							| undefined) ?? ["No pude leer el brain."],
				}
			: null;

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<Link
					className="text-sm underline underline-offset-4"
					href={`/${slug}/settings`}
				>
					← Configuración
				</Link>
				<h1 className="mt-2 mb-4 text-3xl leading-tight">Outreach</h1>
				<h2 className="mb-3 text-lg">Cliente ideal (ICP)</h2>
				<IcpSummary icp={icp} slug={slug} />
			</section>

			<section>
				<h2 className="mb-3 text-lg">Hooks y vectores</h2>
				{valuesResult.error ? (
					<Unreadable />
				) : (
					<MarcoSummary lastFailure={lastFailure} slug={slug} values={values} />
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Segmentos e idiomas</h2>
				{valuesResult.error ? (
					<Unreadable />
				) : (
					<ListsSection idiomas={SUPPORTED_IDIOMAS} slug={slug} values={values} />
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Datos de outreach</h2>
				{agentError ? (
					<Unreadable />
				) : (
					<OutreachConfigForm
						allowedModels={tenant.allowedModels}
						defaults={DEFAULT_OUTREACH_MODELS}
						initial={{
							timezone: config.timezone,
							bcc: config.bcc ?? "",
							dealPipeline: config.deal?.pipeline ?? "",
							dealStage: config.deal?.stage ?? "",
							companyName: config.company?.name ?? "",
							companyUrl: config.company?.url ?? "",
							models: rawModels,
						}}
						slug={slug}
					/>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Procesos automáticos</h2>
				{workflowsResult.error || budgetsResult.error ? (
					<Unreadable />
				) : (
					<WorkflowsSection
						slug={slug}
						workflows={workflowRows(workflowsResult.data ?? [], budgets)}
					/>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Presupuesto de hoy</h2>
				{budgetsResult.error ? (
					<Unreadable />
				) : (
					<BudgetSummary budgets={budgets} />
				)}
			</section>
		</div>
	);
}
```

`rawModels` y no `config.models`: `parseOutreachConfig` rellena los defaults, y el formulario tiene que distinguir "la empresa eligió este modelo" de "usa el de la plataforma".

En `app/[tenant]/settings/page.tsx`, justo antes del `<Link … >Usuarios →</Link>` del final, agregar:

```tsx
			<Link
				className="mr-6 inline-block text-sm underline underline-offset-4"
				href={`/${slug}/settings/outreach`}
			>
				Outreach →
			</Link>
```

Si `tests/settings/settings-page.test.ts` afirma el HTML completo de esa zona, sumar el link al valor esperado.

- [ ] **Step 9: Run and commit**

Run: `npm run typecheck && npm test -- tests/settings tests/server-actions-exports.test.ts`
Expected: PASS.

```bash
git add "app/[tenant]/settings" tests/settings/outreach-sections.test.ts
git commit -m "feat: pantalla de outreach en settings con ICP, hooks, listas, datos, procesos y presupuesto"
```

---

### Task 5: Presupuestos en la consola de plataforma

**Files:**
- Modify: `app/plataforma/[slug]/console-actions.ts` (`setBudget`)
- Create: `app/plataforma/[slug]/console/budgets-section.tsx`
- Modify: `app/plataforma/[slug]/page.tsx`
- Test: `tests/plataforma/console-actions.test.ts`, `tests/plataforma/console-sections.test.ts`

**Interfaces:**
- Consumes: `platform_set_budget`, `tenant_budget_status` (Task 1); `budgetResources`, `toBudgetRows`, `resourceLabel`, `BudgetRow` (Task 2).
- Produces: `setBudget(slug: string, tenantId: string, resource: string, dailyLimit: string): Promise<ConsoleResult>` — el límite llega como texto del formulario; `BudgetsSection({ slug, tenantId, budgets })`.

- [ ] **Step 1: Write the failing tests**

En `tests/plataforma/console-actions.test.ts`, agregar `expect(await actions.setBudget("acme", TENANT, "model_usd", "2")).toEqual(SIN_PERMISO);` al test de permisos existente (el que recorre todas las acciones sin sesión de plataforma), y un `describe` nuevo:

```ts
describe("setBudget", () => {
	it("llama platform_set_budget con el actor y el número", async () => {
		expect(await actions.setBudget("acme", TENANT, "model_usd", "2.5")).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "platform_set_budget",
				args: { p_actor: "u1", p_tenant: TENANT, p_resource: "model_usd", p_daily_limit: 2.5 },
			},
		]);
	});

	it("un recurso que ningún workflow usa no llega a la base", async () => {
		expect(await actions.setBudget("acme", TENANT, "inventado", "2")).toEqual({
			ok: false,
			message: "Ese recurso no existe.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it.each(["", "  ", "2,5", "abc", "-1", "100001", "1e3", "NaN"])(
		"límite %j: se rechaza con un mensaje",
		async (raw) => {
			expect(await actions.setBudget("acme", TENANT, "model_usd", raw)).toEqual({
				ok: false,
				message: "El límite diario es un número entre 0 y 100000, con punto decimal.",
			});
			expect(state.rpcCalls).toHaveLength(0);
		},
	);

	it("0 es un límite válido: apaga el gasto", async () => {
		expect(await actions.setBudget("acme", TENANT, "model_usd", "0")).toEqual({ ok: true });
		expect(state.rpcCalls[0].args.p_daily_limit).toBe(0);
	});
});
```

En `tests/plataforma/console-sections.test.ts`, siguiendo cómo ese archivo importa y renderiza las otras secciones (mock de `console-actions` incluido: sumarle `setBudget: async () => ({ ok: true })`), agregar:

```ts
describe("BudgetsSection", () => {
	it("una fila por recurso con su límite editable y lo gastado hoy", async () => {
		const { BudgetsSection } = await import(
			"@/app/plataforma/[slug]/console/budgets-section"
		);
		const html = renderToStaticMarkup(
			createElement(BudgetsSection, {
				slug: "acme",
				tenantId: "11111111-1111-4111-8111-111111111111",
				budgets: [
					{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 },
					{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
				],
			}),
		);
		expect(html).toContain("Modelos de IA (USD)");
		expect(html).toMatch(/<input[^>]*value="2.5"/);
		expect(html).toContain("Gastado hoy: 0,40");
		expect(html).toContain("Sin presupuesto: los procesos que lo usan no corren.");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/plataforma`
Expected: FAIL: `actions.setBudget is not a function` y el módulo `budgets-section` no existe.

- [ ] **Step 3: Implementar la acción**

En `app/plataforma/[slug]/console-actions.ts`: agregar `| "platform_set_budget"` a la unión del parámetro `fn` de `call`, el import `import { budgetResources } from "@/lib/workflows/settings";`, y al final:

```ts
// Entero o decimal con punto, hasta 6 decimales (la precisión de la columna).
const LIMIT = /^\d{1,6}(\.\d{1,6})?$/;

export async function setBudget(
	slug: string,
	tenantId: string,
	resource: string,
	dailyLimit: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	// El registry vive en código: la base no sabe qué recursos existen.
	if (typeof resource !== "string" || !budgetResources().includes(resource)) {
		return { ok: false, message: "Ese recurso no existe." };
	}
	const raw = typeof dailyLimit === "string" ? dailyLimit.trim() : "";
	const limit = LIMIT.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isFinite(limit) || limit > 100_000) {
		return {
			ok: false,
			message:
				"El límite diario es un número entre 0 y 100000, con punto decimal.",
		};
	}

	return call(slug, "platform_set_budget", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_resource: resource,
		p_daily_limit: limit,
	});
}
```

- [ ] **Step 4: Implementar la sección**

```tsx
// app/plataforma/[slug]/console/budgets-section.tsx
"use client";

import { useState } from "react";
import { type BudgetRow, resourceLabel } from "@/lib/workflows/settings";
import { setBudget } from "../console-actions";
import { ConsoleButton } from "./console-button";

const amount = (value: number) =>
	value.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

function Row({
	slug,
	tenantId,
	budget,
}: {
	slug: string;
	tenantId: string;
	budget: BudgetRow;
}) {
	const [limit, setLimit] = useState(String(budget.dailyLimit));
	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
			<div className="min-w-0 flex-1">
				<div>{resourceLabel(budget.resource)}</div>
				<div className="text-muted-foreground text-xs">
					Gastado hoy: {amount(budget.spent)}
					{budget.dailyLimit <= 0
						? " · Sin presupuesto: los procesos que lo usan no corren."
						: ""}
				</div>
			</div>
			<input
				aria-label={`Límite diario de ${resourceLabel(budget.resource)}`}
				className="h-9 w-28 rounded-md border border-input bg-transparent px-2 text-sm"
				inputMode="decimal"
				onChange={(event) => setLimit(event.target.value)}
				value={limit}
			/>
			<ConsoleButton
				label="Guardar"
				run={() => setBudget(slug, tenantId, budget.resource, limit)}
			/>
		</li>
	);
}

export function BudgetsSection({
	slug,
	tenantId,
	budgets,
}: {
	slug: string;
	tenantId: string;
	budgets: BudgetRow[];
}) {
	return (
		<div className="space-y-2">
			<p className="text-muted-foreground text-sm">
				Tope diario por recurso para los procesos automáticos de la empresa. El
				cliente lo ve, pero no lo cambia.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{budgets.map((budget) => (
					<Row
						budget={budget}
						key={budget.resource}
						slug={slug}
						tenantId={tenantId}
					/>
				))}
			</ul>
		</div>
	);
}
```

- [ ] **Step 5: Sumarla a la página de la consola**

En `app/plataforma/[slug]/page.tsx`, agregar imports:

```ts
import { budgetResources, toBudgetRows } from "@/lib/workflows/settings";
import { BudgetsSection } from "./console/budgets-section";
```

Después de calcular `readiness`, leer los presupuestos con el cliente de la sesión del `platform_admin` (`admin.supabase`: `tenant_budget_status` acepta a un administrador de plataforma). El día se corta en UTC: la consola no conoce la zona horaria del outreach de cada empresa y no hace falta para fijar un tope.

```ts
	const dayStartUtc = new Date();
	dayStartUtc.setUTCHours(0, 0, 0, 0);
	const { data: budgetRows, error: budgetsError } = await admin.supabase.rpc(
		"tenant_budget_status",
		{
			p_tenant: tenant.id,
			p_resources: budgetResources(),
			p_since: dayStartUtc.toISOString(),
		} as never,
	);
	if (budgetsError) {
		console.error("consola:", budgetsError.code, budgetsError.message);
	}
```

Y en el JSX, después de la sección de Conectores (la última sección de configuración antes de los links del final; buscar `<ConnectionsSection` o el `<h2>` "Conectores"), agregar:

```tsx
			<section>
				<h2 className="mb-3 text-lg">Presupuestos</h2>
				{budgetsError ? (
					<p className="text-muted-foreground text-sm">
						No pude leer esta sección. Recargá la página.
					</p>
				) : (
					<BudgetsSection
						budgets={toBudgetRows((budgetRows as unknown[] | null) ?? [])}
						slug={slug}
						tenantId={tenant.id}
					/>
				)}
			</section>
```

Si `tests/plataforma/detail-page.test.ts` dobla `admin.supabase` sin `rpc`, agregarle `rpc: async () => ({ data: [], error: null })` al doble.

- [ ] **Step 6: Run and commit**

Run: `npm run typecheck && npm test -- tests/plataforma tests/server-actions-exports.test.ts`
Expected: PASS.

```bash
git add "app/plataforma/[slug]" tests/plataforma
git commit -m "feat: la consola fija el presupuesto diario por recurso de cada empresa"
```

---

### Task 6: Retiro de scripts, verificación en navegador y documentación

**Files:**
- Delete: `scripts/outreach-config.mts`, `scripts/outreach-config-args.ts`, `scripts/workflows-set.mts`, `scripts/workflows-set-args.ts`, `tests/scripts/outreach-config-args.test.ts`, `tests/scripts/workflows-set-args.test.ts`, `tenants/innovas/outreach.json`
- Modify: `package.json`, `lib/outreach/config.ts`, `tests/outreach/config.test.ts`, `docs/02-orquestacion.md`, `docs/01-roadmap-etapas.md`

- [ ] **Step 1: Verificar en navegador antes de retirar nada**

`npm run db:reset` y levantar el servidor con la herramienta de preview. Los scripts siguen existiendo en este paso, por si hace falta comparar.

Como `platform_admin`, en `/plataforma/<slug>`: poner `model_usd` en 2 y ver "Gastado hoy"; probar "2,5" y ver el mensaje; dejar `apollo_credits` en 0.

Como `tenant_admin`, en `/<slug>/settings/outreach`:
1. El ICP muestra los niveles (o el motivo) con el link al brain.
2. Hooks y vectores muestra la lista; "Releer del brain" responde con los contadores.
3. Agregar un segmento, cambiarle el rótulo, desactivarlo. Intentar desactivar el único idioma: el botón vuelve a "Desactivar" y aparece "tiene que quedar al menos uno activo".
4. Guardar datos con BCC vacío y recargar: sigue vacío. Poner una zona horaria inválida: "Revisá la zona horaria."
5. Encender `target-search`: aparece "No va a correr…" por `apollo_credits`. Subir los ítems por encima del tope: el mensaje del tope.
6. Presupuesto de hoy muestra `2,00` para modelos.
7. A 375 px no hay desborde horizontal.

Como `tenant_member`: `/<slug>/settings/outreach` da 404.

- [ ] **Step 2: Retirar los scripts**

```bash
git rm scripts/outreach-config.mts scripts/outreach-config-args.ts scripts/workflows-set.mts scripts/workflows-set-args.ts tests/scripts/outreach-config-args.test.ts tests/scripts/workflows-set-args.test.ts tenants/innovas/outreach.json
```

En `package.json`, borrar las líneas `"outreach:config": …` y `"workflows:set": …`.

En `lib/outreach/config.ts`: borrar `outreachFileSchema`, `OutreachFile`, `ConfigValueRow`, `ConfigValuesPlan`, `KINDS`, `planConfigValues`, `VALUE` y `valueSchema` (todo lo que sigue a `parseOutreachConfig` salvo el tipo `ConfigValueKind`, que lo usa `lib/outreach/store.ts`). Dejar la cabecera así:

```ts
// Configuración de outreach por tenant (spec 03 §4.3 y §4.8). Se edita en
// /<slug>/settings/outreach (spec 21.3). Los niveles del ICP no están acá:
// viven en el brain.
```

En `tests/outreach/config.test.ts`: borrar los `describe` de `outreachFileSchema` y de `planConfigValues` y sus imports.

Run: `grep -rn "outreach:config\|workflows:set\|outreach-config\|workflows-set\|outreachFileSchema\|planConfigValues\|outreach\.json" --include="*.ts" --include="*.tsx" --include="*.mts" --include="*.json" app lib agents scripts tests tenants package.json`
Expected: sin resultados.

- [ ] **Step 3: Documentación**

En `docs/02-orquestacion.md`, reemplazar cada mención a `npm run workflows:set` o `workflows:set` por la pantalla que lo reemplaza: "se enciende en `/<slug>/settings/outreach`" para el encendido, la cadencia y los ítems, y "lo fija INNOV.AS en `/plataforma/<slug>`" para el presupuesto. No tocar `docs/2026-10-09-evaluacion-gap-plataforma.md`: es una foto fechada.

En `docs/01-roadmap-etapas.md`, reemplazar la viñeta de la 21.3 por:

```
- [ ] **21.3 · Configuración de outreach.** Código terminado; falta el cierre en producción. El ICP, los hooks y los vectores viven en el brain (bloques `icp`, `hooks` y `vectores` en las páginas de canon; guardar una página `canon:hooks` actualiza `config_values` sola). El administrador del cliente edita segmentos, idiomas, datos de outreach y procesos automáticos en `/<slug>/settings/outreach`, y ve su presupuesto y su gasto del día. INNOV.AS fija los presupuestos en `/plataforma/<slug>`. `outreach:config`, `workflows:set` y `tenants/innovas/outreach.json` se van. **Antes de desplegar:** pegar los bloques en las páginas de canon de `innovas` (spec §10 paso 1); `npx supabase migration list` y aplicar `20261017120000_outreach_marco_reflect` y `20261018120000_outreach_settings` antes que el código. Después del deploy: "Releer del brain" en `/innovas/settings/outreach` y comprobar que no desactiva nada.
```

Anotar debajo qué se verificó en navegador y qué no (lo que necesita producción: el scoring leyendo el brain real, y el reflejo sobre el brain de `innovas`).

- [ ] **Step 4: Chequeo final y commit**

Run: `npm run lint:fix && npm run typecheck && npm test && npm run db:test`
Expected: todo PASS. Revertir con `git checkout --` los archivos que `lint:fix` haya tocado fuera de este plan.

```bash
git add -A scripts tests package.json lib/outreach/config.ts docs
git commit -m "refactor: se retiran outreach:config y workflows:set, los reemplazan las pantallas"
```

`git add -A` va acotado a esas rutas a propósito: en la raíz hay archivos sin seguimiento (`.codex/`, `docs/producto-innovas-ai-os.md`) que no son de esta entrega. Si `git status` muestra `docs/producto-innovas-ai-os.md` en el commit, sacarlo con `git restore --staged docs/producto-innovas-ai-os.md` antes de commitear.
