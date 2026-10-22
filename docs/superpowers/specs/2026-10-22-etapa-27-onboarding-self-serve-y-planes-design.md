# Etapa 27 · Onboarding self-serve y planes — diseño

**Fecha:** 2026-10-22
**Estado:** borrador para revisión de Matías.
**Origen:** reflexiones de Matías del 2026-10-21 (grabaciones de Plaud "Estrategia de Precios y Onboarding" y "Monetización Self-Serve") y la conversación de diseño del 2026-10-21 y 22.
**Base:** `2026-10-05-alta-empresas-landing-design.md` (alta desde `/plataforma`, landing por empresa), `2026-10-09-ingreso-por-dominio-design.md` (ingreso abierto, candado de columnas, dominios públicos), `2026-10-09-etapa-20-login-design.md` (métodos de login), `2026-10-13-etapa-21-5-gasto-ia-por-empresa-design.md` (libro de gasto en USD), `2026-10-11-etapa-24-1-skills-paquete-publicacion-design.md` (skills publicadas), `2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` (carpetas y reglas), `2026-10-05-etapa-17-permisos-brain-design.md` (carpetas restringidas).

La página de pricing del sitio innov.as **no** es parte de esta etapa: se pide por otro canal. Esta spec define lo que pasa desde que alguien toca "Empezar" en ese sitio.

## 1. Qué resuelve

Hoy una empresa entra a Central IA solo si un administrador de INNOV.AS la da de alta desde `/plataforma`, le crea el brain, le fija el presupuesto y le invita al primer admin. Eso sirve para enterprise y no escala: nadie puede probar el producto sin hablar con nosotros, y no hay forma de cobrar sin una factura a mano.

Al cerrar la etapa:

- Una persona con correo de trabajo crea su cuenta y su empresa sola, y en diez minutos tiene un brain con carpetas pensadas para su empresa, permisos razonables y contenido inicial para no arrancar de cero.
- Hay tres planes con topes aplicados en el servidor: **Free** (3 usuarios, 5 skills, un crédito mensual de IA, 3 meses), **Pago** (USD 10 por usuario por mes, IA por consumo) y **Enterprise** (como hoy, a mano).
- Al tocar un tope, la app pide la tarjeta con Stripe y sigue; INNOV.AS cobra una factura mensual por empresa sin intervención.
- Una empresa puede abrir el ingreso a todo su dominio con aprobación de quien administra.

**Terminado cuando:** en producción, una persona ajena a INNOV.AS crea su empresa desde el link del sitio, llega al chat con el brain armado, invita a dos personas, intenta invitar a la cuarta, carga la tarjeta en Stripe y la cuarta entra; a fin de mes Stripe emite una factura con 4 licencias y el consumo de IA del período. Cada entrega tiene su propio criterio (§5 a §8).

## 2. Decisiones

Las tomó Matías en la conversación, salvo las marcadas **(mi criterio)**, que son del diseño y se pueden cambiar.

| # | Decisión | Por qué |
|---|---|---|
| P1 | Tres planes: Free, Pago, Enterprise. El plan vive en `tenants.plan` | Un solo lugar que leen los topes, las pantallas y Stripe |
| P2 | Free: hasta 3 usuarios, hasta 5 skills publicadas, crédito mensual de IA, y dura 3 meses | Alcanza para probar con un equipo chico. Los tres topes y el plazo son los cuatro momentos de conversión |
| P3 | Pago: USD 10 por usuario por mes; con 4 o más se cobran todos; sin límite de skills; la IA se cobra por consumo en la misma factura | Precio inicial para probar; se ajusta después con más features |
| P4 | Enterprise: sin topes, sin Stripe, alta y presupuesto desde `/plataforma` como hoy. Las empresas existentes quedan en Enterprise | Es el modelo consultivo (Lagomarsino). No cambia nada de lo que hoy funciona |
| P5 | Free no pide tarjeta. La IA de Free sale de un crédito mensual incluido; al agotarse, se pide la tarjeta para seguir | Pedir tarjeta en el alta frena la prueba. Traer clave propia (BYOK) queda para más adelante |
| P6 | Vía dura al llegar a un tope: la invitación del cuarto usuario, la publicación de la sexta skill y el chat con el crédito agotado no salen hasta que hay tarjeta. No hay período de gracia | La vía blanda son dos features más (plazo y mora) y recién probamos el precio |
| P7 | Stripe, con la entidad de EE. UU. Checkout para la tarjeta, Customer Portal para cambiarla, ver facturas y cancelar. Una suscripción por empresa con cantidad = usuarios activos, más un ítem medido para la IA | No se construye formulario de tarjeta ni portal propio |
| P8 | Correo de trabajo obligatorio para crear una empresa. Los dominios públicos (gmail, hotmail, outlook.com, yahoo, etc.) no pueden crear empresa. El dominio de la empresa sale del correo | Sin dominio no hay research ni "todos los del dominio", y filtra curiosos. La lista ya existe (`is_public_email_domain`) |
| P9 | Primera entrega solo por invitación. "Todos los del dominio" para empresas self-serve llega con la aprobación del administrador (27.4) | Si cobramos por usuario, nadie puede sumarse solo sin que quien paga lo apruebe |
| P10 | El research propone entre 8 y 10 carpetas raíz a partir del sitio de la empresa; las de finanzas y dirección nacen restringidas; la persona edita antes de confirmar | Es el molde que ya funciona en O'Keefe y Lagomarsino |
| P11 | El setup automático también escribe contenido: página de la empresa, 3 a 5 páginas de ejemplo aplicadas a la empresa, una primera skill de design system (con el logo del sitio) y una página de agentes con ejemplos para su rubro | Que arranque sin ayuda externa y con algo que corregir en vez de una hoja en blanco |
| P12 | La skill de design system cuenta como una de las 5 de Free | No hay excepciones en el contador: es una skill publicada más |
| P13 | Login con Microsoft incluido desde la primera entrega | Ya está en `main` (Etapa 20.1, PR 85); solo falta configurar Azure y Supabase (PR 135, guía) |
| P14 | Orden de entregas: 27.1 alta self-serve → 27.2 cobro → 27.3 setup de contenido → 27.4 ingreso abierto con aprobación | Nadie paga sin poder entrar; hasta la 27.2 un tope muestra "Hablá con nosotros" |
| P15 | **(mi criterio)** La conversación del chat sigue siendo individual: el botón es "Invitá a un colaborador", no compartir el hilo | Decisión explícita de Matías: hilos compartidos no son parte de esto |
| P16 | **(mi criterio)** El research corre de fondo: la persona confirma las carpetas, cae en el chat, y el contenido se va escribiendo con un aviso de progreso | El setup completo tarda minutos; nadie mira un spinner tanto tiempo |
| P17 | **(mi criterio)** Si el dominio ya tiene empresa en Central IA y no está abierto, quien se registra ve "Tu empresa ya está en Central IA; pedile a quien la administra que te invite", sin nombres. Con 27.4, ese lugar pasa a "Pedir acceso" | No se puede dejar que alguien cree una segunda empresa con el mismo dominio por error, ni revelar quién administra |
| P18 | **(mi criterio)** Estado "suspendida" (`tenants.suspended_reason`): se lee todo, no se escribe en el brain, no se publican skills, no se invita y el chat no responde. Causas: trial vencido, pago fallido, suscripción cancelada | Aun con la vía dura, Stripe obliga a tener un estado para el pago que falla; el fin del trial usa el mismo |
| P19 | **(mi criterio)** Crédito de Free: USD 5 por mes calendario (UTC), constante en código, medido con el libro de `usage_entries` que ya existe. El gasto del setup automático se asienta igual y cuenta contra ese crédito | Un solo número, el mismo que ya ve el admin en Gasto. USD 5 absorbe el setup y un par de semanas de uso liviano |
| P20 | **(mi criterio)** Pago sin tope de IA por defecto; el admin puede fijarse un tope mensual propio desde su configuración | Quien paga por consumo decide cuánto; el tope evita sustos |
| P21 | **(mi criterio)** El slug sale del dominio (`lagomarsino.com.ar` → `lagomarsino`), con sufijo numérico si está tomado. No se pregunta | Una pregunta menos; el slug casi no se ve una vez que hay dominio propio (21.6) |
| P22 | **(mi criterio)** El `tenant_admin` pasa a poder editar `display_name`, `brand`, `auth_methods` y su tope de IA desde su configuración, por funciones `security definer` con `settings_actor`, el patrón de la 21.2. El trigger `tenants_guard_columns` no se abre. `allowed_domains` sigue siendo solo de plataforma; el dominio inicial lo fija el alta a partir del correo verificado | Sin esto, "dejar el logo para después" no tiene dónde. Los dominios siguen cerrados por la razón de D1 del ingreso por dominio. Hoy conviven el trigger y las funciones; se elige el patrón más nuevo |
| P25 | Para el tope y para Stripe, "usuarios" son las filas de `memberships` con rol `tenant_admin` o `tenant_member`. El chequeo del tope al invitar cuenta miembros activos más invitaciones pendientes (una invitación pendiente reserva lugar para el tope); la cobranza de Stripe cuenta solo miembros activos (la licencia corre cuando la persona acepta y queda activa). Por eso la tarjeta se pide al mandar la invitación que sería la cuarta persona. El ingreso por dominio sigue deshabilitado fuera de enterprise (27.4), así que aceptar no suma lugares más allá de los reservados al invitar; dos invitaciones simultáneas pueden pasarse por un lugar (tope blando aceptado). Las filas `platform_admin` (soporte de INNOV.AS) no cuentan ni se facturan **(esto último, mi criterio)** | Decidido por Matías el 2026-10-22. Quien crea la empresa es 1 de 3 |
| P26 | **(mi criterio)** El setup de contenido (27.3) corre como workflow con un dispatcher de plataforma que despacha por `work_items` pendientes, no por agente, y la action que encola dispara el primer tick enseguida con `after()` | El único dispatcher de hoy lista tenants con outreach habilitado; una empresa self-serve no lo tiene. Un tick inmediato evita esperar al cron para el aviso del chat |
| P27 | **(mi criterio)** La cantidad de licencias en Stripe se concilia: un schedule cada hora compara `tenant_counts` con la suscripción y la corrige. Checkout nace ya con la cantidad correcta (incluida la invitación que chocó con el tope) | Las membresías se crean dentro de Postgres al entrar; llamar a Stripe desde cada punto es frágil. Stripe prorratea por tiempo, así que una hora de desfase no cambia la factura |
| P23 | **(mi criterio)** Una empresa self-serve nace con el agente Asistente (22.1) y el brain; no con outreach | Outreach necesita conectores y configuración que un equipo que recién entra no tiene |
| P24 | **(mi criterio)** La empresa se crea en el paso 2 del alta (nombre y dominio), no al final. Los pasos siguientes la editan. `tenants.onboarding_completed_at` nulo hasta el último paso | Si la persona cierra la pestaña, vuelve y sigue donde estaba |

## 3. Planes y topes

| | Free | Pago | Enterprise |
|---|---|---|---|
| Usuarios | hasta 3 lugares (miembros activos + invitaciones pendientes); la invitación que sería la cuarta persona pide tarjeta | sin tope; USD 10 por usuario activo por mes | sin tope |
| Skills publicadas | hasta 5 | sin tope | sin tope |
| IA | crédito USD 5 por mes calendario | por consumo, en la factura; tope mensual opcional | presupuesto diario de plataforma, como hoy |
| Duración | 3 meses desde el alta | mientras pague | — |
| Ingreso abierto por dominio | no (hasta 27.4, con aprobación) | no (hasta 27.4, con aprobación) | sí, como hoy |
| Tarjeta | no | Stripe | no |

Los topes viven en un solo módulo, `lib/plans/limits.ts`, y los aplica el servidor: la invitación (`inviteToTenant` y la ruta `/api/invitations`), la publicación (`brain_publish_skill` o su caller), el chat (antes de cada turno) y el runner. La pantalla solo refleja lo que el servidor va a rechazar.

Cuando un tope se alcanza, la acción no se ejecuta y la respuesta trae un motivo (`limit:users`, `limit:skills`, `limit:ai_credit`, `suspended:<causa>`) que la pantalla traduce a un diálogo con el camino para seguir: hasta 27.2 dice "Hablá con nosotros" con un mailto; desde 27.2 abre Checkout.

### 3.1 Base

Migración de la 27.1 (antes de escribirla se carga `supabase-postgres-best-practices`):

- `tenants.plan text not null default 'enterprise' check (plan in ('free','pago','enterprise'))`. Las filas existentes quedan en `enterprise`.
- `tenants.trial_ends_at timestamptz null`. Free: `created_at + interval '3 months'`. Otros: nulo.
- `tenants.suspended_reason text null check (suspended_reason in ('trial_vencido','pago_fallido','cancelado'))`.
- `tenants.onboarding_completed_at timestamptz null`.
- `tenants.ai_monthly_limit_usd numeric(10,2) null` (Pago: tope opcional del admin; Free: se ignora, manda la constante).
- `empezar` entra en la lista de slugs reservados (`tenants_slug_not_reserved`), como toda ruta nueva de primer nivel.
- Las columnas nuevas nacen cerradas para el `tenant_admin` por el trigger `tenants_guard_columns`, que no se toca. Lo que el admin edita (P22) va por funciones `tenant_settings_*` `security definer` con `settings_actor`, como en la 21.2. `plan`, `trial_ends_at`, `suspended_reason` y `onboarding_completed_at` las escriben solo funciones `security definer` propias o la service role (el alta, el webhook de Stripe, el vencimiento del trial).
- Función `tenant_is_writable(tenant_id)` → `active and suspended_reason is null`. Las escrituras del brain y de invitaciones van con la service role, que no pasa por RLS, así que la red es un trigger `before insert or update` en `brain_pages`, `brain_skill_versions`, `brain_folders` e `invitations` que la llama y falla con `42501` cuando devuelve falso, para cualquier rol. Las funciones SQL que ya existen (`brain_publish_skill`, `brain_ensure_folders`, `brain_set_access_rule`) quedan cubiertas por el trigger sin tocarlas; el webhook de Stripe y el alta escriben en `tenants`, no en esas tablas, así que no los frena.
- `tenant_counts(tenant_id)` → `{ users, pending_invitations, published_skills }` según P25, lectura para el servidor y la pantalla de Plan.

El gasto del mes de una empresa es `sum(amount)` de `usage_entries` con `resource = 'model_usd'` en el mes calendario UTC, el mismo corte de `tenant_spend_report` (G7 de la 21.5).

## 4. Flujo de alta (27.1)

Se diseña en Pencil antes del plan de implementación (§5.4). Esta sección fija qué hay en cada paso; cómo se ve es del diseño.

**Entrada.** El sitio manda a `/empezar` o `/empezar?plan=pago`. Los dos botones del sitio llegan al mismo flujo; el parámetro solo decide si al final se pide la tarjeta (27.2) o no.

**Paso 1 · Tu cuenta.** Google, Microsoft o correo. Texto: qué incluye Free y que la IA tiene un crédito mensual incluido. Con correo público: "Necesitás un correo de tu empresa para crear una cuenta". Después del login, `login_gate` decide:

- tiene membresía → su chat, como hoy;
- tiene invitación pendiente → la acepta, como hoy;
- su dominio está abierto en alguna empresa → entra, como hoy;
- su dominio está en los `allowed_domains` de alguna empresa activa pero no abierto → pantalla de P17;
- nada de lo anterior y dominio de trabajo → paso 2;
- nada y dominio público → mensaje de P8 y vuelta al login.

Para el correo (OTP), `canSignUpByDomain` pasa a devolver `true` también cuando el dominio no es público, así Supabase crea la cuenta. Google y Microsoft ya crean el usuario; el corte sigue en el gate.

**Paso 2 · Tu empresa.** Nombre y dominio principal (precargado desde el correo, editable solo entre dominios que no sean públicos; si cambia, se exige que coincida con el del correo: no hay otra verificación). Al confirmar se crea la empresa (§5.1) y arranca el research de carpetas de fondo.

**Paso 3 · Las carpetas de tu brain.** Mientras el research corre, la pantalla explica qué es el brain y qué son las carpetas. Cuando termina muestra las 8 a 10 propuestas con nombre, una línea de para qué sirve y si es abierta o restringida. La persona renombra, saca, agrega y cambia abierta/restringida. Explicación al pie de qué significa restringida (solo quien administra y a quien invite a esa carpeta) y de que las invitaciones y permisos se manejan desde Configuración. Si el research no encontró nada legible en el sitio, pide tres líneas sobre la empresa y vuelve a correr; si falla de nuevo, propone la plantilla genérica (§5.2). Al confirmar se crean las carpetas y las reglas de acceso.

**Paso 4 · Tu logo.** Subir PNG, SVG o WebP hasta 1 MB, o "Lo dejo para después". Los colores del sitio los propone el research (§5.2) y se pueden tocar en Configuración.

**Paso 5 · Quién entra.** Métodos de login (Google, Microsoft, correo; al menos uno; precargado el que usó la persona) y si se limita a correos del dominio de la empresa (invitaciones a correos externos requieren el tilde "Permitir correo externo", como hoy). La opción "Todos los del dominio" aparece deshabilitada con "Disponible pronto" hasta la 27.4.

**Paso 6 · Listo.** Caja para invitar a dos personas (correo y rol), que se puede saltear, y el botón "Ir al chat". Se marca `onboarding_completed_at`. Si vino con `?plan=pago`, acá se abre Checkout antes del chat (27.2); hasta entonces el parámetro se ignora.

**En el chat.** Botón "Invitá a un colaborador" en la cabecera (abre la misma caja de invitación). En el brain, al lado de una carpeta restringida, "Invitá a alguien a esta carpeta". El contenido del setup (27.3) aparece con un aviso "Estamos armando tu brain: 2 de 4 páginas listas" que se va a solo cuando termina.

**Vuelta a medias.** Con `onboarding_completed_at` nulo, cualquier ruta de la empresa redirige al paso que falta, que se deduce del estado: sin carpetas → paso 3; sin `auth_methods` confirmados → paso 5 (se guarda un flag en `brand` o en una columna `onboarding_step`; es del builder).

## 5. Entrega 27.1 · Alta self-serve

### 5.1 Creación de la empresa

Función SQL `self_serve_create_tenant(p_display_name, p_domain)`, `security definer`, `search_path = ''`, `grant execute to authenticated`:

1. `auth.uid()` nulo → excepción. Lee el correo de `auth.users` con `email_confirmed_at not null`; su dominio tiene que ser igual a `p_domain` y no ser público (`is_public_email_domain`). Si no, `42501`.
2. El método de login sale de `current_login_method()`; si es `null` (por ejemplo Microsoft sin `xms_edov`) → excepción `login_method_unknown`. Así nadie crea una empresa con un método que después `login_gate` no reconoce.
3. Si existe un tenant con `active = true` y `p_domain` en `allowed_domains` → excepción `domain_taken` (la pantalla ya lo evitó en el gate; esto es la red). Una empresa dada de baja (`active = false`) no bloquea el dominio.
4. Slug según P21; reintenta con sufijo hasta encontrar uno libre; respeta los reservados.
5. Inserta en `tenants`: `plan = 'free'`, `trial_ends_at = now() + 3 months`, `allowed_domains = [p_domain]`, `auth_methods = [método del paso 2]`, `self_signup_by_domain = false`. `allowed_models` y `default_model` quedan en sus defaults de columna, como hace `platform_create_tenant`.
6. Inserta la membresía `tenant_admin` para `auth.uid()` (misma vía que `accept_pending_invitations`: insert directo dentro de la función, que corre como owner).
7. Inserta `tenant_agents` para el Asistente (P23).
8. Eventos: `tenant.created` con `payload.origin = 'self_serve'` y `membership.created`.
9. Devuelve `{ id, slug }`.

Después, la server action (con el cliente admin, como la de plataforma) crea el brain con `platform_bind_connection` (wiki) **con `categories: []`**: las carpetas raíz son las que la persona confirma en el paso 3, no el molde de cuatro de `DEFAULT_BRAIN_CONFIG`. En el mismo paso habilita las skills (`platform_enable_brain_skills`), porque P12 y la 27.3 las necesitan desde el día uno. Luego encola el research. Si el brain falla, la pantalla lo dice y ofrece reintentar; la empresa no queda sin brain en silencio.

Presupuesto: Free no usa `tenant_budgets` (manda P19). Un solo módulo decide cuánto puede gastar una empresa, `lib/plans/ai-allowance.ts`: `free` por su crédito mensual, `pago` por `ai_monthly_limit_usd` (o sin tope), `enterprise` por `tenant_budgets` como hoy. El chat se corta solo por suspensión (cualquier plan) y por el crédito Free / el tope Pago (`aiAllowanceForChat`); nunca por `tenant_budgets` de Enterprise (se mantiene G4 de la 21.5). El runner es el único consumidor de `tenant_budgets` (`aiAllowance` + `budgetStatus`; este último, que hoy cortaría a una Free por "límite 0", queda solo para enterprise).

### 5.2 Research de carpetas

Nodo `onboarding/propose-folders` en `lib/onboarding/services/propose-folders.ts`, registrado con `effect: 1, tier: "barato"`. Entra `{ domain, displayName, hint? }` (el hint son las tres líneas del paso 3 cuando el sitio no alcanza). Sale, con schema:

```
{
  found: boolean,
  company: { summary, industry, size_hint, location, products[] },
  brand: { colors[], fonts[], logo_url? },
  folders: [{ slug, name, description, restricted }]   // 8 a 10
}
```

Lee el sitio con `fetchPublicPage` y la misma estrategia que `runResearch` (home y hasta 8 páginas enlazadas, priorizando "nosotros", "servicios", "productos", "equipo", "contacto"). No hay búsqueda web en el repo y esta entrega no la agrega: si el sitio no responde o no tiene texto, `found = false`. El `brand` sale de lo que el HTML declara (`og:image`, `<link rel="icon">`, `<img>` con "logo" en `src` o `alt`, colores repetidos en CSS inline o en hojas del mismo host); es un intento, no una garantía, y la 27.3 lo refina.

Reglas del prompt: siempre incluye una carpeta de empresa/dirección (restringida) y una de finanzas (restringida); nombres en castellano rioplatense, slugs en minúsculas sin acentos; nunca `skills`, `skill`, `brain` (reservados); descripciones de una línea que digan qué va adentro, no qué es la carpeta. La plantilla genérica para `found = false` y sin hint: `direccion` (r), `finanzas` (r), `comercial`, `operacion`, `marketing`, `talento`, `tecnologia`, `proyectos`.

Se asienta en `usage_entries` con `metered()` como cualquier nodo. El tenant ya existe cuando corre.

### 5.3 Carpetas, permisos y páginas iniciales

Al confirmar el paso 3, una server action con el cliente admin:

- crea cada carpeta con `brain_ensure_folders` y guarda la descripción (`createSupabaseFolderWriter`), sin pasar por la autorización del editor porque el actor es la propia persona que administra la raíz;
- para cada restringida, `brain_set_access_rule(principal = 'members', level = 'ninguno')` en ese path; el `tenant_admin` administra todo por rol, no necesita grant;
- escribe `00-reglas` en la raíz con una regla mínima en castellano ("Cada página empieza con un párrafo que dice para qué sirve"); es del builder el texto exacto, con el molde de la 26.2;
- escribe una página `empresa/que-sabemos` (o el slug de la carpeta de empresa que la persona dejó) con `company.summary` del research, firmada "Escrita por Central IA al crear la empresa. Corregila.". Esta es la única página de contenido de la 27.1; el resto es 27.3.

### 5.4 Pantallas

Se diseñan en Pencil, un archivo por flujo, antes del plan: los seis pasos del §4, la pantalla de P17, el diálogo de tope (tres variantes: usuarios, skills, crédito) y la cabecera del chat con "Invitá a un colaborador". Con la marca de Central IA, no la de INNOV.AS. El diseño se aprueba en conversación antes de `superpowers:writing-plans`.

### 5.5 Topes en 27.1

- Invitación: si `plan = 'free'`, `users + pending_invitations >= 3` (la pendiente reserva lugar; la cobranza cuenta solo activos) y no hay tarjeta cargada, `inviteToTenant` devuelve `limit:users`. Lo mismo `join_tenants_by_domain` (no aplica hasta 27.4, pero la función ya chequea).
- Publicación: si `plan = 'free'` y `published_skills >= 5`, la publicación devuelve `limit:skills`.
- Chat: antes de cada turno, un hook consulta `aiAllowanceForChat`; si la empresa está suspendida o el crédito Free / tope Pago del mes está agotado, el turno falla y la pantalla muestra el diálogo. Enterprise nunca se corta por `tenant_budgets`. El corte se implementa como un turno fallido (`ai_allowance:<motivo>` en `turn.failed`) y no como una respuesta fija, así que los turnos del canal MCP de una empresa cortada también fallan con un `turn.failed` pelado. El runner usa `aiAllowance` y conserva su presupuesto diario para enterprise.
- Trial: un schedule diario (eve `schedules/`, mismo patrón que los que ya existen) pone `suspended_reason = 'trial_vencido'` a las Free con `trial_ends_at < now()` y deja el evento `tenant.suspended`. Aviso en la app desde 14 días antes, con la fecha.
- Suspendida: cabecera con el aviso y el motivo; el diálogo de tope dice "Hablá con nosotros" hasta la 27.2.

### 5.6 Configuración

En `/[tenant]/settings` el admin gana: nombre, logo y colores (`brand`), métodos de login, y una pestaña **Plan** con plan actual, usuarios, skills y crédito del mes contra los topes, fecha de fin del trial, y el botón del tope ("Hablá con nosotros" en 27.1; Checkout y Portal en 27.2).

**Terminado cuando:** en producción, una persona con un correo de trabajo que nunca estuvo en Central IA crea su empresa desde `/empezar`, confirma carpetas propuestas a partir de su sitio, llega al chat, invita a dos personas que entran, y al invitar a la cuarta ve el tope. El evento `tenant.created` con `origin = 'self_serve'` queda en `events`.

## 6. Entrega 27.2 · Cobro con Stripe

- Tabla `tenant_billing (tenant_id pk, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)`, sin RLS para `authenticated` (solo service role). Los datos de tarjeta nunca pasan por la app.
- Productos en Stripe: un precio por licencia (USD 10/mes, por cantidad) y un precio medido para la IA (USD por unidad = 1 centavo, con un *meter* de Stripe Billing). Los ids van en variables de entorno.
- **Checkout** se abre desde el diálogo de tope, desde Plan y desde el paso 6 con `?plan=pago`. Desde la cuarta invitación va en modo `setup`: guarda la tarjeta sin cobrar, la invitación sale, y la suscripción se crea (cantidad = usuarios activos) cuando el cuarto acepta, que es cuando el plan pasa a `pago`. Desde la sexta skill, el crédito agotado o `?plan=pago` va en modo suscripción con cantidad = usuarios activos, porque ahí el cobro arranca ya. `success_url` vuelve a donde estaba; la acción que chocó con el tope se repite sola al volver si el webhook ya confirmó.
- **Webhook** `/api/stripe/webhook` (firma verificada): `checkout.session.completed` → crea o completa `tenant_billing` (cliente y tarjeta; suscripción si la hubo), y cuando hay suscripción `plan = 'pago'`, `trial_ends_at = null`, `suspended_reason = null`; `customer.subscription.updated` con `past_due` o `unpaid` (después de los reintentos de Stripe) → `suspended_reason = 'pago_fallido'`; `customer.subscription.deleted` → `suspended_reason = 'cancelado'` (la empresa queda legible; para volver, Checkout de nuevo). Cada cambio deja un evento `billing.*`.
- **Licencias:** según P27, un schedule de plataforma cada hora compara `tenant_counts.users` con la cantidad de la suscripción de cada empresa Pago y la corrige; Stripe prorratea. El mismo schedule crea la suscripción de una empresa Free con tarjeta cargada en cuanto `users > 3` (la aceptación del cuarto), además del intento inmediato desde `completeLogin`. Un fallo se registra y se reintenta en el tick siguiente; ninguna membresía se bloquea por eso.
- **IA:** un schedule diario manda al meter el `model_usd` del día anterior (UTC) de cada empresa Pago, en centavos, con `idempotency key` por empresa y día. La factura del período incluye las licencias y ese consumo. El tope mensual opcional del admin (P20) corta el chat y el runner igual que el crédito de Free.
- **Portal:** link "Administrar pago y facturas" en Plan, con `billing portal session`.
- Enterprise no toca nada de esto.

**Terminado cuando:** en producción, con Stripe en modo real, una empresa Free carga la tarjeta al invitar al cuarto usuario, el cuarto entra, y la primera factura de Stripe muestra 4 licencias y un ítem de IA con el consumo del período; un pago fallido deja la empresa suspendida y el portal la reactiva.

## 7. Entrega 27.3 · Setup automático de contenido

Workflow `onboarding-setup` (por capacidad, no por cliente), que se encola al confirmar el paso 3 y corre de fondo con el runner, despachado por el dispatcher de plataforma de P26 (nuevo: el de hoy solo ve empresas con outreach). La action dispara el primer tick con `after()` para que el contenido empiece a aparecer mientras la persona llega al chat. El código itera; el modelo no. Cuatro nodos, cada uno con su schema de salida, registrados con `effect: 1`; un ítem que falla no frena al resto, y el aviso del chat cuenta lo que entró contra lo que salió:

1. `onboarding/company-page`: reescribe `empresa/que-sabemos` con más detalle (productos, clientes visibles, ubicación, equipo si el sitio lo muestra). Con `found = false`, usa el hint y lo dice.
2. `onboarding/example-pages`: 3 a 5 páginas en la carpeta de empresa, elegidas según el rubro y escritas con lo que se sabe (por ejemplo "A quién le vendemos", "Cómo cotizamos", "Preguntas que nos hacen siempre"), cada una con el encabezado "Ejemplo escrito por Central IA: reemplazalo con lo real". El prompt lista los títulos candidatos por rubro; el modelo elige y redacta.
3. `onboarding/design-system-skill`: skill `skills/design-system` con `SKILL.md` (colores, tipografías, tono, usos del logo) y el logo como archivo en `brain_skill_files` si se pudo bajar (misma protección de `fetchPublicPage`, hasta 1 MB, PNG/SVG/WebP). Se publica (P12). Si no hay logo, la skill lo dice y pide subirlo.
4. `onboarding/agents-page`: página `empresa/agentes` con 3 a 5 agentes ejemplo para el rubro (nombre, qué hace, qué lee del brain, qué produce, qué lo dispara). El prompt y los ejemplos por rubro salen de `docs/producto/onboarding-ejemplos-agentes.md` (hilo aparte, en curso).

Todo lo escrito lleva autor "Central IA" y aparece en el historial de la página como cualquier edición. Progreso: cada nodo deja un evento `onboarding.page_written`; el chat lo lee para el aviso de P16.

**Terminado cuando:** una empresa nueva en producción tiene, sin tocar nada, la página de la empresa, entre 3 y 5 ejemplos, la skill de design system publicada con el logo y la página de agentes; la corrida aparece en `runs`.

## 8. Entrega 27.4 · Ingreso abierto con aprobación

- `tenants.signup_mode text check in ('invitacion','abierto','aprobacion')` reemplaza a `self_signup_by_domain` (migración con backfill: `true` → `abierto`, `false` → `invitacion`; la columna vieja se borra en una migración posterior cuando nada la lea). Enterprise puede elegir `abierto`; Free y Pago solo `invitacion` o `aprobacion` (check por plan).
- Tabla `membership_requests (tenant_id, user_id, email, status pending|approved|rejected, decided_by, decided_at, created_at)` con RLS: el solicitante ve la suya, el `tenant_admin` ve las de su empresa.
- `join_tenants_by_domain()`: con `aprobacion`, inserta la solicitud en vez de la membresía y deja `membership.requested`. La persona ve "Pedimos acceso a <Empresa> por vos; te avisamos por correo".
- Aviso al admin por correo (misma vía que las invitaciones) y lista en `settings/usuarios` con Aprobar y Rechazar. Aprobar crea la membresía por función `security definer` y respeta el tope de usuarios: en Free con 3, Aprobar abre el diálogo de tope. Eventos `membership.approved` y `membership.rejected`.
- La opción del paso 5 y de Configuración pasa de "Disponible pronto" a activa.

**Terminado cuando:** en producción, una empresa Pago en modo aprobación recibe la solicitud de alguien de su dominio, el admin la aprueba desde Configuración y la persona entra; en Free con 3 usuarios, aprobar pide la tarjeta.

## 9. Lo que decide el builder

- Nombres de rutas dentro de `/empezar`, cómo se guarda el paso en curso (P24) y el texto exacto de cada pantalla (lo fija el diseño en Pencil).
- Cómo el canal del chat devuelve el motivo del tope al cliente sin llamar al modelo.
- Estrategia de reintento cuando Stripe no responde al actualizar la cantidad.
- Dónde vive la constante del crédito (P19) y la lista de títulos candidatos por rubro (27.3).
- Si `allowed_models` del alta self-serve se resuelve en SQL o en la action.

## 10. Fuera de alcance

- Página de pricing del sitio innov.as (otro canal).
- Traer clave propia (BYOK) de IA.
- Precio y contrato de Enterprise.
- Hilos de chat compartidos.
- Facturación local (AFIP) o moneda distinta de USD.
- Búsqueda web para el research: solo se lee el sitio del dominio.
- Borrado automático de empresas que abandonan el alta a medias.
- Bajar de Pago a Free con más de 3 usuarios: se cancela y queda suspendida (P18); la reducción manual es un pedido a INNOV.AS.

## 11. Riesgos y pendientes

- **Microsoft en producción:** depende de que Matías registre la app en Azure con el claim `xms_edov` y prenda el proveedor en Supabase (guía en el PR 135). Sin eso el botón existe pero la sesión no se reconoce.
- **Research sin sitio:** muchas pymes no tienen sitio o tienen uno sin texto. El hint de tres líneas es la red; conviene medir en las primeras altas cuántas caen ahí.
- **Costo del setup:** el workflow de la 27.3 gasta contra el crédito de Free (P19). Si en las primeras altas se come más de la mitad, se sube la constante o se exime el setup.
- **Stripe meters y cambio de cantidad en el mismo período:** prorrateo y consumo conviven en una factura; verificar con una suscripción de prueba antes de salir.
- **Dos empresas con el mismo dominio:** la D2 del ingreso por dominio lo permite a propósito para enterprise. El alta self-serve lo rechaza (§5.1 paso 2); si un grupo necesita dos, es un alta de plataforma.
