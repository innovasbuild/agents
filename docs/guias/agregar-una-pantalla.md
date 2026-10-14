---
title: Agregar una pantalla
category: guias
status: activo
tags: [pantallas, nextjs, server-actions, design-system, menu]
updated: 2026-10-13
sources:
  - app/[tenant]/layout.tsx
  - app/[tenant]/cola/page.tsx
  - app/[tenant]/cola/actions.ts
  - app/[tenant]/settings/page.tsx
  - lib/tenants/nav.ts
  - lib/tenants/enabled-agents.ts
  - lib/tenants/home.ts
  - lib/tenants/resolve.ts
  - lib/brand/contrast.ts
  - components.json
  - components/ui/button.tsx
  - tests/tenants/nav.test.ts
  - tests/tenants/enabled-agents.test.ts
  - tests/server-actions-exports.test.ts
  - docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md
---

# Agregar una pantalla

Una pantalla de empresa vive en `app/[tenant]/<nombre>/`. Las de plataforma (`/plataforma/...`) tienen otro guard, `requirePlatformAdmin()`, y no se tratan acá. Para no escribir lo que ya está resuelto en otro lado: el tenant, la marca y el menú los pone `app/[tenant]/layout.tsx`; los datos de la empresa los cierra la RLS (ver [tenancy](../arquitectura/tenancy.md) e [identidad y acceso](../arquitectura/identidad-y-acceso.md)).

## Pasos

1. Creá `app/[tenant]/<nombre>/page.tsx` como server component. Los nombres de ruta van en castellano (`cola`, `contactos`, `mis-cuentas`). El arranque es siempre el mismo (ejemplo real: `app/[tenant]/cola/page.tsx`):

   ```tsx
   const { tenant: slug } = await params;
   const tenant = await resolveTenantAccess(slug);
   if (!tenant) notFound(); // 404 y no 403: un 403 confirma que el cliente existe
   await requireAgent(tenant.id, "outreach");
   ```

   `params` es una promesa y se espera. `resolveTenantAccess` devuelve `null` si no hay sesión, si no pertenece a la empresa o si el método de ingreso no está permitido.

2. Si la pantalla pertenece a un agente, llamá a `requireAgent(tenant.id, "<agente>")` (de `lib/tenants/enabled-agents.ts`): da 404 si la empresa no tiene habilitado ese agente. Para la pantalla de chat existe `requireChatAgent`. Si la lectura falla, deja pasar y registra el error: es navegación, no autorización. Las pantallas que no son de ningún agente (brain, conectar, configuración) no lo llaman.

3. Si es solo para administradores, cortá con `if (tenant.role === "tenant_member") notFound();` (así lo hacen `/[tenant]/settings` y `/[tenant]/settings/usuarios`).

4. Leé los datos con el cliente del usuario, `createServerSupabase()`, para que la RLS limite por `tenant_id`. El cliente de servicio (`createAdminClient`) solo para lo que el usuario no puede leer, con el tenant tomado de la sesión y nunca de un parámetro.

5. Si hay interacción, la parte de cliente va en un archivo aparte con `"use client"` (como `cola-client.tsx`) y las escrituras en `actions.ts` con `"use server"`:
   - Cada server action vuelve a validar sus argumentos en el borde (`zod`): la puede invocar cualquier cliente autenticado con lo que quiera.
   - Resuelve el acceso por su cuenta (`webSession(slug)` o `resolveTenantAccess`), no confía en que la página lo haya hecho.
   - Devuelve un resultado tipado `{ ok: true } | { ok: false; message }` con el mensaje escrito para la persona, y llama a `revalidatePath` si cambió algo que se ve.
   - Un archivo `"use server"` solo puede exportar funciones `async`. Los tipos, las constantes y los esquemas van en otro archivo o sin `export`.

6. Armá la interfaz con los componentes de `components/ui/` (shadcn sobre Tailwind, estilo `radix-nova` según `components.json`) y con los componentes propios del dominio en `components/<dominio>/` (hoy `components/brain/`). Usá las variables del tema (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`) y nunca colores fijos: el layout pisa `--primary`, `--primary-foreground` y `--ring` con la marca de cada empresa (`brandStyle` en `lib/brand/contrast.ts`, que deriva el color del texto por contraste). Para sumar un componente de shadcn:

   ```bash
   npx shadcn@latest add dialog
   ```

   Textos de la interfaz en español rioplatense; a 375 px de ancho no puede haber scroll horizontal de página (el layout ya cuida el header y el menú).

7. Si va en el menú, sumala a `NAV` en `lib/tenants/nav.ts`: `{ href, label, agent?, adminOnly? }`. `agent` oculta la entrada si la empresa no tiene ese agente; `adminOnly` la oculta a los miembros comunes; varias entradas de un mismo dominio van dentro de un desplegable (`items`), que no se muestra si queda sin ítems visibles. Ocultar el link no cierra la ruta: el guard del paso 2 sí.

8. Si la pantalla puede ser el aterrizaje de una empresa, la decisión está en un solo lugar, `tenantHome` (`lib/tenants/home.ts`): chat si hay un agente con chat, si no brain, si no conectar. No pongas redirecciones a `/chat` a mano; mandá a `/[tenant]`.

9. Tests: la lógica en funciones puras bajo `lib/` con su test (como `tests/tenants/nav.test.ts`), y las acciones con su test (`tests/cola/actions.test.ts` es el modelo). Después:

   ```bash
   npm run typecheck
   ```

   ```bash
   npm test
   ```

   Para ver la pantalla andando hace falta la base local (Docker): seguí [instalación local](instalacion-local.md).

10. Documentá la ruta por su path exacto (por ejemplo `/[tenant]/cola`) en la página del dominio que corresponda y regenerá la referencia (`docs/referencia/rutas.md`):

    ```bash
    npm run docs:sync
    ```

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Falla | Dónde |
|---|---|---|
| Exportar solo funciones `async` desde un archivo `"use server"` | "archivos use server solo exportan funciones async" (en el runtime de Next aparece recién al ejecutar) | `tests/server-actions-exports.test.ts` |
| Poner la entrada nueva del menú con `agent` o `adminOnly` según corresponda | los casos de qué ve cada rol | `tests/tenants/nav.test.ts` |
| Cerrar la pantalla de un agente cuando no está habilitado | los casos de `requireAgent` | `tests/tenants/enabled-agents.test.ts` |
| Regenerar la referencia de rutas | "docs/referencia coincide con lo que genera docs:sync" | `tests/docs/wiki.test.ts` |
| Nombrar la ruta en la wiki | "toda superficie está mencionada en arquitectura/, dominios/ o guias/…" | `tests/docs/cobertura.test.ts` |
| El guard de tenant y de rol | Nada lo detecta. Una pantalla sin `notFound()` para quien no pertenece es un hueco de acceso: se ve en la revisión del PR | revisión |

Una carpeta nueva de primer nivel en `app/` (fuera de `[tenant]`) tapa cualquier empresa con ese slug. Por eso la base reserva esas palabras (`supabase/tests/17_reserved_tenant_slugs.test.sql`, ver [identidad y acceso](../arquitectura/identidad-y-acceso.md)): si agregás una, hace falta una migración nueva.
