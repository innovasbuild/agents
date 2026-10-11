# Etapa 21.4: segundo tenant (empresa sin agentes, código por correo y alta de Lagomarsino)

**Fecha:** 2026-10-11
**Estado:** diseño aprobado en conversación; falta la revisión de este documento.
**Rama:** `feat/etapa-21-4-segundo-tenant`, sale de `main` con la 21.3 mergeada (PR 90).
**Antecedentes:** `docs/01-roadmap-etapas.md` (Etapa 7 y Etapa 21), `docs/2026-10-09-plan-cierre-gap-plataforma.md` §2 (G4 y G7), `2026-10-10-etapa-21-1-consola-conectores-design.md` (alta, catálogo de agentes, "qué falta"), `2026-10-10-etapa-21-3-config-outreach-design.md` (O9 y O10, páginas de canon al crear el brain), `2026-10-09-etapa-20-login-design.md` e `2026-10-09-ingreso-por-dominio-design.md` (métodos e ingreso), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por carpeta), `2026-10-09-etapa-19-conectar-design.md` (pantalla Conectar), `docs/brain-mcp-conexion.md`.

## 1. Qué resuelve

La Etapa 7 pedía un segundo tenant que corriera el piloto de 5 contactos sin tocar `agents/` ni `lib/`. El segundo tenant va a ser **Lagomarsino**, el primer cliente en producción, y su primera ola es brain y trigo: sin agente de outreach, sin CRM y sin Gmail. El piloto de outreach no aplica.

Lo que se prueba en su lugar es la promesa de fondo, "la diferencia entre empresas es una fila y su brain", con una empresa que solo usa el brain.

Al revisar el código contra ese caso aparecieron supuestos de outreach en la plataforma:

- Todo ingreso aterriza en `/<slug>/chat`, que depende del agente de outreach. Sin el agente deja escribir y falla con 401 sin aviso. `/<slug>` da 404.
- La navegación y `/settings` muestran todo lo de outreach aunque no haya agente.
- El alta exige al menos un agente y el catálogo solo tiene `outreach`.
- El brain nace con categorías fijas y dos páginas de outreach, y las categorías solo se cambian por SQL.
- El método de correo manda un link. Al cliente se le dijo "código al mail corporativo", y en Microsoft 365 los filtros de enlaces pueden abrir el link antes que la persona y dejarlo gastado (riesgo sin verificar en la casilla de ellos).

Ninguno de estos arreglos es específico de Lagomarsino: son capacidad de plataforma ("una empresa puede no tener agentes"). El criterio de la Etapa 7 se lee como "nada del cliente en código", y se mantiene.

Al cerrar esta entrega:

- Una empresa sin agentes se da de alta, entra y trabaja en su brain sin ver nada de outreach.
- El método de correo acepta un código de 6 dígitos además del link.
- Lagomarsino está dada de alta en producción, hecha entera desde el navegador, con las horas medidas.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| T1 | El segundo tenant es Lagomarsino, solo brain. El piloto de 5 contactos con un segundo tenant queda sin probar y se anota así en la Etapa 7 | Decidido el 2026-10-10. La ola de Arranque firmada excluye agentes |
| T2 | Una spec, dos planes: 21.4a (plataforma) y 21.4b (alta de Lagomarsino) | La 21.4a es código y deja el sistema funcionando. La 21.4b es operación en producción y medición |
| T3 | El alta acepta cero agentes | Hoy hay que crear con outreach y apagarlo, y queda la fila deshabilitada |
| T4 | El aterrizaje se decide en un solo lugar, `/<slug>`: chat si hay un agente con chat habilitado, si no brain, si no Conectar | Hoy cinco lugares mandan a `/<slug>/chat` |
| T5 | Cada entrada del menú declara qué agente necesita. Las pantallas de un agente dan 404 si el agente no está habilitado | Mismo criterio que ya usa `/settings/outreach`. Ocultar el link sin cerrar la ruta deja pantallas vacías alcanzables |
| T6 | Las páginas de canon de outreach se siembran cuando hay un agente que las usa, no al crear el brain. Corrige O9 de la 21.3 | El brain de una empresa sin outreach no tiene por qué nacer con `comercial/icp` y `comercial/hooks` |
| T7 | Las categorías del brain las edita INNOV.AS desde `/plataforma/<slug>` | INNOV.AS crea y estructura el brain en el alta (frontera de la 21.1). El cliente ordena por carpetas, que son libres |
| T8 | El método `email` manda link y código en el mismo mail. No se agrega un método nuevo | No cambia `tenants.auth_methods`, ni `current_login_method()`, ni la configuración de ninguna empresa |
| T9 | No se agregan tools `search` ni `fetch` al MCP del brain | Mati conectó el brain de `innovas` desde Codex y desde ChatGPT (cuenta personal) el 2026-10-10 con las tres tools actuales |
| T10 | Lagomarsino entra solo por invitación, no con ingreso abierto por dominio | Todo miembro nace lector de todo el brain. Con ingreso abierto, cualquiera de la empresa leería trigo hasta que alguien lo restrinja |
| T11 | Nada en `tenants/lagomarsino/` ni carga por `brain:import` | El contenido lo vuelca el cliente por el editor y por MCP. Si hiciera falta la carga masiva, es un hallazgo |

## 3. Empresa sin agentes (21.4a)

### 3.1 Alta

- `lib/tenants/tenant-create.ts`: `agents` deja de exigir `.min(1)`. Siguen las validaciones de catálogo y de duplicados.
- `platform_create_tenant`: se quita el `raise` de "la empresa necesita al menos un agente". Con lista vacía no inserta en `tenant_agents`.
- `app/plataforma/nueva/create-form.tsx`: el agente sigue tildado por defecto; destildarlo ya no da error.
- La invitación del primer administrador apunta a `/<slug>` en vez de `/<slug>/chat`.

### 3.2 Aterrizaje

Función `tenantHome` en `lib/tenants/`, pura, que recibe los agentes habilitados y si hay brain habilitado, y devuelve la ruta:

1. `/chat` si está habilitado un agente con chat.
2. `/brain` si hay brain habilitado.
3. `/conectar` en cualquier otro caso.

"Agente con chat" sale del catálogo: `AgentCatalogEntry` suma `chat: boolean` (`outreach: true`).

`app/[tenant]/page.tsx` es nueva: resuelve la empresa, llama a `tenantHome` y redirige. Pasan a apuntar a `/<slug>`:

- `app/page.tsx` (dos lugares)
- `app/(auth)/login/[tenant]/page.tsx`
- `app/plataforma/nueva/actions.ts`
- `app/[tenant]/settings/usuarios/actions.ts`
- `app/plataforma/[slug]/page.tsx`

### 3.3 Navegación

En `lib/tenants/nav.ts`, `NavLink` suma `agent?: CatalogAgent`. `visibleNav(role, enabledAgents)` filtra por rol y por agente; un desplegable sin ítems visibles no se muestra.

| Entrada | Necesita |
|---|---|
| Chat, Outreach (Cola, Pipeline, Contactos, Cuentas, Focos), Métricas, Mis cuentas | `outreach` |
| Brain, Conectar, Configuración | nada |

`app/[tenant]/layout.tsx` lee los agentes habilitados de la empresa y se los pasa a `visibleNav`.

### 3.4 Pantallas

- Un helper `requireAgent(tenantId, agent)` en `lib/tenants/` hace el chequeo que hoy está escrito a mano en `settings/outreach/page.tsx`: si el agente no está habilitado, `notFound()`. Si la consulta falla, deja pasar y registra el error, igual que hoy.
- Lo usan las páginas de Chat, Cola, Pipeline, Contactos, Cuentas, Focos, Métricas, Mis cuentas y `/settings/outreach`.
- `app/[tenant]/settings/page.tsx`: las secciones Modelo default, Ejecutores, Aprobaciones y Conectores se muestran solo si hay algún agente habilitado. Ingreso y Usuarios quedan siempre.

### 3.5 Estado de la empresa en la consola

`lib/tenants/readiness.ts`: "sin agentes habilitados" deja de ser un faltante cuando la empresa tiene brain habilitado. Sin brain y sin agentes siguen figurando los dos faltantes.

## 4. Brain neutro (21.4a)

### 4.1 Páginas de canon

- `AgentCatalogEntry` suma `seedsCanon: boolean` (`outreach: true`).
- `createBrain` llama a `seedCanonPagesForTenant` solo si la empresa tiene habilitado un agente con `seedsCanon`.
- `setAgent`, al habilitar un agente con `seedsCanon` en una empresa con brain, siembra las páginas que falten. Nunca pisa una página existente.
- La consola no nombra `outreach`: pregunta al catálogo.

### 4.2 Categorías

- Sección Brain de `/plataforma/<slug>`: la lista de categorías pasa de solo lectura a editable, con Guardar.
- Función `platform_set_brain_categories(p_actor, p_tenant, p_categories text[])`, de `service_role`, con la misma verificación de `platform_admin` que las demás `platform_*`:
  - entre 1 y 20 categorías, sin repetidas, cada una con el mismo patrón que valida `brain_pages.category`;
  - rechaza quitar una categoría que tenga páginas (en cualquier estado), y dice cuál y cuántas;
  - actualiza solo `config.categories` del binding `wiki`; el resto de `config` no se toca.
- El brain se sigue creando con las categorías por defecto y se editan después.

### 4.3 Textos de outreach en el brain

- `app/[tenant]/brain/page.tsx`: los chips de `CANON_TAGS` se muestran solo si hay un agente con `seedsCanon` habilitado.
- `lib/brain/core/contract.ts`: quien arma el contrato indica si va la mención al canon. Sin ella, las descripciones quedan generales ("Busca en el brain de esta empresa por texto, categoría o tag…"; "Categorías válidas: …"). El agente de outreach la pide siempre. El servidor MCP del brain la pide solo si la empresa tiene un agente con `seedsCanon` habilitado.

## 5. Código por correo (21.4a)

### 5.1 Flujo

1. La persona escribe su correo y aprieta "Mandarme un código". Es la misma llamada de hoy (`signInWithOtp`), con las mismas reglas de alta por dominio.
2. La pantalla pasa a pedir el código de 6 dígitos, con "Mandar otro" y "Usar otro correo". El mail trae el código y el link.
3. El código se valida con `verifyOtp` en una server action.
4. Después de validar corre lo mismo que hoy corre `/auth/callback`: compuerta de método (`login_gate`), alta por dominio (`join_tenants_by_domain`) y redirección a `next`. Ese tramo se extrae a una función compartida para que link y código no diverjan.

El link sigue funcionando sin cambios. El formulario es uno solo, así que el código también queda disponible en el login genérico al que redirige el consentimiento OAuth del MCP.

### 5.2 Plantillas

- `supabase/templates/magic_link.html` y `supabase/templates/confirmation.html`, en castellano, con `{{ .Token }}` y el link. Se declaran en `supabase/config.toml` para la base local.
- En producción se pegan a mano en el panel de Supabase Auth. Pasan a estar versionadas en el repo, que es la fuente.
- La plantilla de invitación no cambia.

### 5.3 Rótulos

`AUTH_METHOD_LABELS.email` pasa de "Link por correo" a "Código por correo". El valor guardado (`email`) no cambia.

### 5.4 Caso de la invitación gastada

Una persona invitada cuyo link de invitación ya fue consumido (por ella o por un filtro de correo) tiene que poder entrar pidiendo un código desde la landing de su empresa, y quedar con la membresía que le dio la invitación. Se prueba en local antes de dar por cerrada la 21.4a. Si Supabase no lo permite para un usuario invitado sin confirmar, el plan lo resuelve dentro de esta entrega, porque Lagomarsino entra por invitación (T10).

## 6. Pantalla Conectar (21.4a)

`lib/connect/instructions.ts`:

- Codex pasa a `tested: true`.
- ChatGPT pasa a `tested: true` después de repetir la conexión siguiendo los pasos que muestra la pantalla y corregir el texto donde difiera de lo que pide ChatGPT hoy (en particular, si hace falta activar el Modo desarrollador y si la escritura con `brain_upsert` funciona).
- El caso de un espacio de trabajo corporativo no está probado: la prueba fue con cuenta personal. Queda dicho en la nota del paso y se prueba en la 21.4b.

## 7. Base de datos

Una migración, `20261019120000_agentless_tenant.sql`:

- `create or replace function platform_create_tenant(...)`: igual a la vigente menos el mínimo de agentes.
- `platform_set_brain_categories(...)`: nueva (§4.2). `revoke all` de `public`, `anon` y `authenticated`; `grant execute` a `service_role`.

No hay tablas ni columnas nuevas. `events` no se toca.

Antes de escribirla se carga `supabase-postgres-best-practices`.

## 8. Seguridad

- Las dos funciones verifican adentro que `p_actor` sea `platform_admin`; no confían en el caller.
- `requireAgent` es navegación, no autorización: el acceso a los datos de outreach lo sigue cerrando RLS por `tenant_id`.
- El código de 6 dígitos dura lo que hoy dura el link (`otp_expiry`, una hora) y lo limita el rate limit de Supabase Auth por IP. No se agrega un límite propio.
- La compuerta de método corre igual por código que por link: una empresa sin `email` en `auth_methods` no acepta el código.
- El MCP del brain no cambia su control de acceso.

## 9. Qué no entra

- El login del flujo OAuth del MCP sigue siendo el genérico, con marca INNOV.AS. Hallazgo anotado.
- Nombre del servidor MCP (`innovas-brain`).
- Carga masiva del brain desde la UI.
- Que el cliente edite sus dominios o métodos de ingreso.
- Active Directory o Entra para Lagomarsino.
- Un agente nuevo, o habilitarle outreach a Lagomarsino.
- Fuentes de SharePoint, listados DBF y Softland: son trabajo de la ola del cliente, no de esta etapa.
- Clave de modelos por empresa (21.5).

## 10. Pruebas

- Unitarias: `tenantHome` (los tres destinos), `visibleNav` (por rol y por agente, desplegable vacío), `tenantReadiness` (brain sin agentes está lista), esquema del alta con cero agentes, contrato del brain con y sin canon, `instructions`.
- Base (`npm run db:test`): `platform_create_tenant` con lista vacía; `platform_set_brain_categories` (rechaza a quien no es `platform_admin`, rechaza quitar una categoría con páginas, no toca el resto de `config`).
- Integración: `createBrain` sin agentes no siembra canon; habilitar outreach después siembra lo que falta y no pisa.
- Navegador, base local, con una empresa nueva sin agentes:
  - alta sin agentes y creación del brain; la consola la muestra lista;
  - el administrador invitado aterriza en `/brain`; el menú muestra Brain, Conectar y Configuración;
  - `/chat`, `/cola` y `/mis-cuentas` dan 404;
  - cambio de categorías y rechazo al quitar una en uso;
  - ingreso con código leído del correo local, código vencido o equivocado con su mensaje, y el caso de la invitación gastada (§5.4);
  - la empresa `demo`, con outreach, sigue aterrizando en el chat y viendo todo su menú.
- `npm run typecheck`, `npm test` y `npm run lint:fix` (revirtiendo los archivos ajenos que reformatea).

## 11. Alta de Lagomarsino (21.4b)

Corre en producción, con la 21.4a desplegada. Cada vez que haga falta la terminal, SQL o un cambio de código, se anota como hallazgo con la hora.

### 11.1 Precondiciones

- Producción al día: los cierres que el roadmap marca pendientes para las etapas 17, 19, 20, 21.1, 21.2 y 21.3, cada uno con su lista. `npx supabase migration list` antes de cada `db push`, porque aplica todas las pendientes.
- Migración de la 21.4a aplicada antes que el código, y las dos plantillas de correo pegadas en el panel de Supabase Auth.
- Probar con una casilla de INNOV.AS que el mail trae el código y que el código entra.
- Confirmar con sistemas de Lagomarsino (Emiliano o Juan Martín) que su espacio de trabajo de ChatGPT permite agregar un conector propio, y que los correos de la plataforma no caen en cuarentena.

### 11.2 Alta, cronometrada

1. `/plataforma/nueva`: empresa `lagomarsino`, dominio `lagomarsino.com.ar`, método código por correo, sin agentes, primer administrador Marcos P. Lagomarsino.
2. `/plataforma/lagomarsino`: crear el brain y ajustar sus categorías. La lista se define con Mati en el momento; punto de partida: `empresa`, `trigo`, `comercial`, `operacion`.
3. Ingreso: solo por invitación.
4. Como `platform_admin`, crear la página `trigo/leeme` para que exista la carpeta, y en `trigo` poner el acceso general en Restringido.
5. Invitar a Víctor, Andrés Silveira y Javier Bonano como miembros. Cuando hayan entrado: Víctor editor de `trigo`, los otros dos lectores. Marcos L. ya administra todo por ser administrador de la empresa.
6. Invitar a Juan Martín y a Emiliano como miembros, sin acceso a `trigo`, para la prueba de conexión.

Supuesto a confirmar con Mati antes del paso 1: que el primer administrador sea Marcos L. y no alguien de sistemas.

### 11.3 Prueba de conexión

Con Juan Martín, antes de la reunión presencial:

- entra con el código que le llega a su casilla corporativa;
- en el menú ve solo Brain y Conectar (Configuración no, porque es miembro);
- no ve la carpeta `trigo`;
- conecta el brain a ChatGPT desde `/conectar` y hace una búsqueda y una lectura;
- Mati, con un usuario de `innovas`, comprueba que el MCP de `lagomarsino` lo rechaza.

### 11.4 Cierre

- Horas del alta (11.2 y 11.3) contra las de la Etapa 3, y la lista de hallazgos, en la sección de la Etapa 21 del roadmap.
- Etapa 7: se anota que el segundo tenant corrió solo con brain y que el piloto de outreach con un segundo tenant sigue sin probar.
- Página de la cuenta en el brain de `innovas` actualizada, y `/context-save`.

## 12. Terminado cuando

- **21.4a:** en producción, una empresa sin agentes se crea desde la consola, su administrador entra con un código, aterriza en el brain y no encuentra ninguna pantalla de outreach; `innovas` sigue funcionando igual.
- **21.4b:** una persona de Lagomarsino entra con el código de su correo corporativo, ve solo lo que sus permisos le dejan y consulta el brain desde su asistente, con todo el alta hecha desde el navegador y las horas anotadas.
