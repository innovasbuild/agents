# Etapa 19: "Conectá tus herramientas" y cierre en producción: diseño

**Fecha:** 2026-10-09
**Base:** `docs/2026-10-09-plan-cierre-gap-plataforma.md` (Etapa 19), `docs/brain-mcp-conexion.md`, `docs/agente-mcp-conexion.md`, `lib/agents/mcp-channel-auth.ts` y `lib/brain/core/mcp-server/access.ts`.

## 1. Objetivo y criterio de cierre

Que cada persona vea dentro de la plataforma qué puede conectar a su herramienta de uso diario y cómo, con la URL de su empresa ya puesta y los pasos en castellano. Hoy eso vive en dos markdown del repo, uno desactualizado.

La etapa original también incluía verificar en producción lo pendiente de las etapas 17, 18 e ingreso por dominio. Eso lo hace una persona con cuentas reales, así que esta entrega lo deja como una lista de pasos (anexo A) y **no bloquea el cierre del código**.

**Terminado cuando (código):** un `tenant_member` y un `tenant_admin` abren `/<slug>/conectar` y ven las mismas tarjetas con las URLs de su empresa; una persona sin membresía recibe 404; un agente apagado en `tenant_agents` no aparece en la página y su canal MCP rechaza la conexión.

**Terminado cuando (producción):** la persona que verifica completa el anexo A y saca las etiquetas "sin probar" de los clientes que andan.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| C1 | La lista de conectables sale de una función pura en código, sin tabla nueva | La Etapa 22 trae el catálogo de agentes. Una tabla ahora se duplicaría y se tiraría |
| C2 | La página es visible para todos los roles y muestra lo mismo | Hoy los permisos finos del brain no cambian la URL ni las tools que se listan: la regla decide al usar. No hay nada que ocultar por rol |
| C3 | La tarjeta del brain aparece si el tenant tiene un binding habilitado de capacidad `brain` | Es la misma condición con la que el endpoint responde 404 `brain_not_configured` |
| C4 | Una tarjeta por fila de `tenant_agents` con `enabled = true` | Es la condición que ya aplica el canal del dashboard |
| C5 | Nombre y descripción de cada agente salen de un mapa en código, con un texto genérico para un agente que no esté en el mapa | Hoy solo existe `outreach`. La Etapa 22 reemplaza el mapa por el catálogo |
| C6 | Las URLs salen de `publicSettings()` y no se hardcodean | Funcionan en producción y en preview |
| C7 | Cada cliente MCP lleva una marca `tested: boolean`; los no probados muestran "Sin probar" | No prometemos pasos que nadie ejecutó. Hoy solo Claude Code está probado |
| C8 | El canal MCP del agente chequea `tenant_agents.enabled` y responde con un mensaje propio | Hoy el canal web lo exige y el MCP no: el freno llega recién en las tools. Solo se llega acá siendo miembro, así que el mensaje puede decir la causa |
| C9 | Sin tabla, sin migración | Todo lo que se lee ya existe y un miembro ya lo puede leer por RLS |
| C10 | El alias `search`/`fetch` para ChatGPT queda fuera | Se decide después de probar ChatGPT contra el brain real |

## 3. Datos

### 3.1 `lib/connect/connectables.ts`

Función pura:

```ts
type Connectable =
  | { kind: "brain"; name: string; description: string; url: string }
  | { kind: "agent"; agent: string; name: string; description: string; url: string }
  | { kind: "tools"; name: string; description: string; soon: true };

buildConnectables(input: {
  slug: string;
  publicUrl: string;
  hasBrain: boolean;
  enabledAgents: string[];
}): Connectable[]
```

Orden fijo: brain, agentes (en el orden recibido), herramientas. Reglas:

- Brain: `${publicUrl}/brain/${slug}/mcp`, solo si `hasBrain`.
- Agente: `${publicUrl}/eve/${agent}/v1/mcp?tenant=${slug}`, uno por cada agente habilitado.
- Herramientas: siempre, con `soon: true` y sin URL. Es el lugar reservado para la Etapa 23.
- `publicUrl` se recibe sin barra final; la función no asume nada más.
- El mapa de nombres vive en el mismo archivo. `outreach`: "Agente de outreach", "Investiga cuentas, redacta mensajes y arma la cola de envíos de tu empresa." Un agente desconocido usa su identificador como nombre y "Agente de tu empresa." como descripción.

### 3.2 `lib/connect/instructions.ts`

Función pura `instructionsFor(client, { name, url })` que devuelve `{ tested, steps: string[], snippet?: { language, code } }`. Clientes: `claude-code`, `claude-ai`, `chatgpt`, `codex`, `cursor`. `name` es un identificador corto sin espacios para los comandos (`brain-<slug>`, `<agente>-<slug>`).

| Cliente | `tested` | Contenido |
|---|---|---|
| Claude Code | sí | `claude mcp add --transport http <name> "<url>"`, después `/mcp`, elegir el servidor y autenticar. Se abre el navegador, se entra con la cuenta de la plataforma y se aprueba |
| claude.ai | no | Configuración, Conectores, Agregar conector personalizado, pegar la URL, guardar y apretar Conectar. En planes Team y Enterprise primero lo agrega un dueño de la organización y después cada persona se conecta |
| ChatGPT | no | Configuración, Conectores (puede figurar como Apps), Ajustes avanzados, activar Modo desarrollador, Crear, pegar la URL, elegir OAuth y crear. Requiere un plan con modo desarrollador y, en espacios de trabajo, que un administrador lo habilite |
| Codex | no | `codex mcp add <name> --url "<url>"` y después `codex mcp login <name>` |
| Cursor | no | En `~/.cursor/mcp.json` (o `.cursor/mcp.json` del proyecto): `{ "mcpServers": { "<name>": { "url": "<url>" } } }`. Al primer uso abre el navegador para autenticar. Abrir un chat nuevo del agente para que vea las tools |

Los pasos salen de la documentación vigente de cada cliente al 2026-10-09. Los nombres de menú cambian entre versiones y los textos lo dicen cuando hay más de un nombre posible.

## 4. Pantalla

`app/[tenant]/conectar/page.tsx`, componente de servidor.

1. `resolveTenantAccess(slug)`; sin acceso, `notFound()`.
2. Con el cliente Supabase del usuario (la RLS ya deja leer a cualquier miembro): filas de `tenant_agents` con `enabled = true` y existencia de un `tenant_connections` habilitado con `capability = 'brain'`.
3. Si alguna de las dos lecturas falla, la página muestra un aviso de error en lugar de una lista vacía. Una lista vacía por un error parecería "no tenés nada habilitado".
4. `buildConnectables(...)` y render de una tarjeta por conectable.

Cada tarjeta muestra nombre, descripción, la URL en un campo de solo lectura con botón **Copiar** y las pestañas de los cinco clientes. Cada pestaña muestra los pasos numerados, el comando o JSON en un bloque copiable y, si `tested` es falso, la etiqueta "Sin probar". La tarjeta de herramientas se ve atenuada con el texto "Próximamente: las herramientas de tu empresa (CRM, búsqueda de contactos) desde tu propio Claude o ChatGPT".

Arriba de las tarjetas, un párrafo corto: "Estas son las conexiones que tu empresa te habilitó. Al conectar vas a entrar con tu cuenta de la plataforma y vas a ver solo lo que tu cuenta tiene permitido."

Componente cliente `connect-card.tsx` solo para pestañas y copiar al portapapeles. Usa `Tabs`, `Card` y `Button` de `components/ui`. Si el portapapeles falla, el campo queda seleccionable. Responsive: una columna a 375 px, sin scroll horizontal; los bloques de código hacen scroll interno.

Menú: `{ href: "/conectar", label: "Conectar" }` en `NAV` de `app/[tenant]/layout.tsx`, sin `adminOnly`, entre Métricas y Configuración.

## 5. Canal MCP del agente: `enabled`

En `lib/agents/mcp-channel-auth.ts`, `McpChannelAuthDeps` suma `agentEnabled(tenantId: string): Promise<boolean>`. Después de resolver tenant y rol, y antes de armar la sesión, si devuelve `false` responde `forbidden` con "Ese agente no está habilitado para este cliente.". Aplica también a `platform_admin`, igual que el canal del dashboard.

- Si la consulta falla, el error cae en el mismo `catch` que ya devuelve "No pude verificar tu acceso a ese cliente. Probá de nuevo." Falla cerrado.
- `agents/outreach/channels/mcp.ts` arma la dependencia con el cliente admin y el nombre `outreach`, que es el agente de esa carpeta.
- Sin migración. `tenant_agents.enabled` ya existe.

## 6. Docs

- `docs/brain-mcp-conexion.md`: se quita "si no, solo leer" y la restricción de `brain_upsert` a administradores. Ahora dice que escribe quien tenga nivel editor sobre la carpeta o la página, y que las tres tools se listan siempre. Queda un párrafo que apunta a `/<slug>/conectar` como fuente de las instrucciones por cliente.
- `docs/agente-mcp-conexion.md`: se agrega que el agente tiene que estar habilitado para la empresa y el mensaje de error nuevo; mismo párrafo hacia la página.
- Roadmap: la Etapa 19 queda con sus casillas de código tildadas y la verificación apuntando al anexo A.

## 7. Pruebas

**Aplicación** (`npm test`):

- `buildConnectables`: con y sin brain; sin agentes; dos agentes en orden; agente fuera del mapa; `publicUrl` sin barra; el brain nunca lleva `?tenant`; la tarjeta de herramientas siempre está y no tiene URL.
- `instructionsFor`: cada cliente incluye el `name` y la URL pasados; solo Claude Code tiene `tested: true`; el JSON de Cursor es válido y parsea; los comandos no tienen la URL sin comillas.
- Página: sin sesión o sin membresía da 404; un miembro y un admin reciben las mismas tarjetas; un agente con `enabled = false` no aparece; tenant sin brain no muestra la tarjeta del brain; un error de lectura muestra el aviso y no una lista vacía.
- Canal MCP (`tests/agents/mcp-channel-auth.test.ts`): `agentEnabled` en `false` rechaza a un miembro y a un `platform_admin` con el mensaje nuevo; en `true` sigue entrando; si la dependencia tira, responde el mensaje de "No pude verificar" y no deja pasar.
- Menú: el link "Conectar" aparece para `tenant_member`.

**Navegador** (lo corre quien verifica, anexo A): la página a 1280 y 375 px, copiar de cada campo, las pestañas, el modo oscuro.

## 8. Límites declarados

- Las instrucciones de claude.ai, ChatGPT, Codex y Cursor no se probaron contra la plataforma. Los pasos vienen de la documentación pública de cada cliente y los menús cambian.
- ChatGPT puede exigir tools llamadas `search` y `fetch` para algunas funciones. No se agrega nada hasta probarlo.
- Codex y Cursor dependen del registro dinámico de clientes OAuth de Supabase, que sí está prendido y funciona con Claude Code.
- El mapa de nombres de agentes en código es provisorio hasta la Etapa 22.
- La página no muestra qué carpetas del brain puede leer o escribir cada persona. Eso lo decide la regla al usar.

## 9. Fuera de alcance

- Probar los clientes MCP en producción (anexo A).
- El MCP de herramientas (Etapa 23); acá solo hay una tarjeta "próximamente".
- El alias `search`/`fetch` para ChatGPT.
- Cambios de permisos, catálogo de agentes o selector de agente en el chat (Etapa 22).

## Anexo A: verificación en producción (la corre una persona)

Cada punto indica quién lo hace y qué se espera. Al terminar, se tildan en el roadmap y se actualizan las etiquetas `tested`.

**Antes de probar**
1. En Vercel: `PLATFORM_OWNER_TENANT_SLUG` cargada en producción.
2. En Supabase Auth de producción: "Confirm email" prendido.
3. Una cuenta `tenant_member` real en `innovas` y otra cuenta sin membresía.

**Esta etapa**
4. `/innovas/conectar` con la cuenta miembro: aparecen el brain y el agente de outreach; las URLs copiadas coinciden con las de los markdown. Apretar **Copiar** en un navegador normal y pegar: tiene que copiar la URL y el botón dice "Copiado" (en el navegador integrado de la herramienta de desarrollo el permiso de portapapeles está negado, así que el caso de éxito no se vio; el aviso "No se pudo copiar" sí).
5. Con la cuenta sin membresía: 404.
6. Apagar `outreach` en `tenant_agents` de un tenant de prueba: desaparece la tarjeta y el canal MCP responde "Ese agente no está habilitado para este cliente.". Volver a prenderlo.
7. Conectar el brain desde claude.ai con los pasos de la página. Si anda, `tested: true` para claude.ai.
8. Lo mismo desde ChatGPT. Anotar si hace falta `search`/`fetch` o un plan específico.
9. Lo mismo desde Codex y Cursor, si hay acceso.

**Etapa 17**
10. Un admin restringe una carpeta desde el diálogo de compartir y le da lectura a una persona. Esa persona la ve en el árbol y por MCP; otro miembro no la ve en el árbol ni en `brain_search`; el agente en el chat tampoco se la muestra a ese otro miembro.

**Etapa 18**
11. Borrar una página enlazada desde otras dos: orden y color del ítem, contenido del diálogo, redirección, vista de un miembro que no es administrador, 375 px y que el diálogo no deje `pointer-events` trabado.
12. Editor visual: entrada en edición o lectura según el rol, barra de herramientas, sugerencias de `[[`, menú de tabla, interruptor de Markdown, barra de guardado, flujo de conflicto y diff, Descartar, hoja blanca en modo oscuro, 375 px.

**Ingreso por dominio**
13. Una empresa en modo abierto con un dominio cargado: una persona nunca invitada entra por `/login/<slug>`, cae en `/<slug>/chat` como `tenant_member` y queda el evento `membership.joined_by_domain`.
