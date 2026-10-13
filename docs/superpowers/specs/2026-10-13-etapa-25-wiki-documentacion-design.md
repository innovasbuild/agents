# Etapa 25 · Wiki de documentación y harness que la mantiene — Diseño

**Fecha:** 2026-10-13 · **Estado:** propuesta para revisión de Mati · **Ejecuta:** Sonnet (plan en `docs/superpowers/plans/2026-10-13-etapa-25-wiki-documentacion.md`)

## 1. Qué se quiere y para quién

Entra un programador nuevo al repo. Tiene que poder:

1. Clonar, instalar y levantar la plataforma en local siguiendo solo el `README.md`.
2. Entender la arquitectura entera (tenancy, eve, orquestación, brain, conectores, datos, auth, deploy) leyendo una wiki en `docs/`, sin tener que abrir 29 specs ni la conversación de nadie.
3. Agregar una feature y que el repo le exija documentarla, de forma mecánica, sin depender de que alguien se acuerde.

Y para INNOV.AS: que la documentación se **mantenga sola**. Cada feature nueva (etapa, tool, nodo, workflow, tabla, pantalla, conector, variable) tiene que dejar rastro en la wiki o el repo se pone rojo.

## 2. Qué existe hoy

| Cosa | Estado |
|---|---|
| `README.md` | El de `create-next-app`. No dice qué es el proyecto ni cómo levantarlo. |
| `docs/` | Once archivos sueltos sin índice: kickoff, roadmap, orquestación, llaves, dos guías de MCP, producto, evaluación y plan de cierre del gap, un diagrama `archify` (HTML de 815 KB más su JSON). |
| `docs/superpowers/specs` y `plans` | 29 specs y 33 planes, una por etapa. Es la memoria real del proyecto, pero no hay nada que las ordene ni que diga cuál sigue vigente. |
| `lib/brain/README.md` | La única doc por módulo que existe. Buena. Queda donde está y la wiki la enlaza. |
| `CLAUDE.md` | Reglas de trabajo para el modelo. No dice dónde se documenta. |
| Patrón de "tabla a mano contra el disco" | `tests/workflows/registry.test.ts` y `tests/agents/running-tool.test.ts` fallan hasta que alguien decide qué hacer con lo nuevo. Es el idioma del repo para detectar features. |
| gstack `/ship` | Corre tests, y en el paso 14.5 despacha `/document-release`, que descubre las raíces de documentación por los links del README y por las instrucciones del proyecto, y mantiene `VERSION` y `CHANGELOG.md` si existen. Hoy no existen. |

## 3. La wiki

### 3.1 Forma

Igual que el brain del producto: páginas markdown chicas, una idea por página, con frontmatter, agrupadas por categoría, con un índice como punto de entrada. Todo en castellano rioplatense; código e identificadores en inglés.

Una diferencia a propósito: **no se usan `[[wikilinks]]`**. GitHub y los editores no los renderizan en un repo. Se usan links markdown relativos (`[brain](../dominios/brain.md)`) y el harness verifica que todos resuelvan. Si algún día la wiki se importa al brain del producto, `brain:import` ya convierte links relativos.

### 3.2 Árbol

```
README.md                       qué es, requisitos, instalación, comandos, link a docs/README.md
CHANGELOG.md                    lo mantiene /ship (una entrada por PR)
VERSION                         lo mantiene /ship
docs/
  README.md                     ÍNDICE: una línea por página, agrupado por categoría. Es el hub.
  arquitectura/                 cómo encaja todo (explicación)
    vision-general.md           el dibujo del kickoff §2, actualizado, y los principios
    tenancy.md                  tenants, memberships, roles, RLS, platform_admin, tenant dueño
    orquestacion.md             el 02-orquestacion.md actual, movido
    datos.md                    tablas por dominio, events append-only, work_items, runs, usage_entries
    identidad-y-acceso.md       Supabase Auth, OAuth server, ingreso por dominio, bloqueos, consentimiento
    entornos-y-deploy.md        Vercel, preview vs producción, migraciones a producción, variables
    modelos-y-costos.md         AI Gateway, tiers, metered(), presupuestos
  dominios/                     un módulo por página (explicación + mapa del código)
    agentes-eve.md              agents/outreach, defineDynamic, canal MCP del agente, sesiones, evals
    outreach.md                 cola, pipeline, focos, fichas, canon, gate, listen, CRM
    brain.md                    resumen y link a lib/brain/README.md; proveedor wiki y mcp; editor; permisos
    workflows.md                registry, enqueue, ticks, caps, piezas pending
    conectores.md               capacidades, proveedores, Vercel Connect, bindings, consola
    plataforma.md               consola /plataforma, alta de empresas, settings del cliente
    invitaciones-y-usuarios.md
    gmail.md
  guias/                        cómo hacer X (how-to)
    instalacion-local.md        lo mismo que el README pero con el detalle y los problemas conocidos
    documentar.md               cómo se mantiene esta wiki (la lee el skill /docs-wiki)
    alta-de-tenant.md
    llaves-de-clientes.md       movido
    migraciones-a-produccion.md
    agregar-una-tool.md
    agregar-un-nodo-o-workflow.md
    agregar-un-conector.md
    agregar-una-pantalla.md
    correr-evals.md
    conectar-brain-por-mcp.md   movido (brain-mcp-conexion.md)
    conectar-agente-por-mcp.md  movido (agente-mcp-conexion.md)
  referencia/                   tablas, GENERADAS por npm run docs:sync (no se editan a mano)
    comandos.md                 scripts de package.json
    variables-de-entorno.md
    tablas.md                   tablas y la migración que las crea
    migraciones.md
    rutas.md                    páginas y endpoints de app/
    tools-del-agente.md         con su etiqueta de TOOL_LABELS
    nodos-y-workflows.md        desde lib/workflows/registry.ts
    proveedores.md              desde lib/connectors/providers.ts
    schedules.md
    evals.md
  decisiones/
    README.md                   tabla: una fila por spec (fecha, etapa, spec, plan, estado, páginas)
    prs.md                      tabla: una fila por PR mergeado (#, fecha, título, páginas o motivo)
  producto/
    kickoff.md                  movido
    roadmap.md                  movido (01-roadmap-etapas.md), sigue siendo el tracker
    posicionamiento.md          movido (producto-innovas-ai-os.md)
    evaluacion-gap-2026-10.md   movido
    plan-cierre-gap-2026-10.md  movido
  diagramas/
    arquitectura.html, arquitectura.archify.json   movidos
  _meta/
    cobertura.ts                exclusiones con motivo (lo que a propósito no se documenta)
    prs.json                    snapshot de PR mergeados (npm run docs:prs)
  superpowers/                  queda como está: lo escriben brainstorming y writing-plans
```

Los archivos se **mueven con `git mv`** para conservar historia. Los paths viejos que cita `CLAUDE.md` (`docs/innovas-agents-kickoff.md`, `docs/02-orquestacion.md`) se actualizan en el mismo commit. Las memorias de Claude y los planes viejos que citan paths viejos no se tocan: son historia.

### 3.3 Frontmatter de una página

```yaml
---
title: Brain
category: dominios            # arquitectura | dominios | guias | referencia | decisiones | producto
status: activo                # activo | borrador | archivado
tags: [brain, mcp, permisos]
updated: 2026-10-13
sources:                      # qué la respalda; el harness avisa si una fuente dejó de existir
  - lib/brain/README.md
  - docs/superpowers/specs/2026-09-13-brain-design.md
generated: false              # true solo en referencia/
---
```

`title`, `category`, `status`, `updated` son obligatorios. `sources` es obligatorio salvo en `producto/` y `decisiones/`.

### 3.4 Forma de una página de dominio

1. **Qué es y para qué** (dos párrafos).
2. **Dónde vive en el código** (lista de carpetas y archivos clave con una línea cada uno).
3. **Cómo funciona** (lo que un programador necesita para tocarlo sin romperlo: contratos, invariantes, lo que nunca se hace).
4. **Cómo se prueba** (qué tests lo cubren, cómo correrlos).
5. **Decisiones** (links a las specs de `decisiones/README.md` que lo moldearon).

Tope orientativo de 300 líneas por página. Si crece, se parte.

## 4. El harness

Tres capas, de la más mecánica a la que necesita un modelo.

### 4.1 Inventario determinístico (`scripts/docs/inventory.ts`)

Funciones puras, sin modelo, que listan las **superficies** del repo leyendo el disco:

| Superficie | De dónde sale | Clave |
|---|---|---|
| tools del agente | `agents/*/tools/*.ts` | `outreach/send_email` |
| schedules | `agents/*/schedules/*.ts` | `outreach/followups` |
| nodos y workflows | `lib/workflows/registry.ts` (import directo) | `outreach/draft`, `draft-queue` |
| tablas | regex `create table ... public.<x>` en `supabase/migrations/*.sql` | `queue_items` |
| migraciones | nombres de archivo | `20260921100000_work_items` |
| rutas | `app/**/page.tsx` y `route.ts` → path de URL | `/[tenant]/cola`, `/api/invitations` |
| proveedores | `lib/connectors/providers.ts` (import directo) | `hubspot` |
| scripts npm | `package.json` | `db:reset` |
| variables de entorno | regex `process.env.X` en `lib app agents scripts proxy.ts`, excluyendo `**/.eve/**` y una lista fija de variables de la plataforma (`NODE_ENV`, `VERCEL_*`, `XDG_*`, `PATH`...) | `PLATFORM_OWNER_TENANT_SLUG` |
| evals | `agents/*/evals/*.eval.ts` | `outreach/frenos` |
| specs | `docs/superpowers/specs/*.md` | nombre de archivo |
| PR mergeados | `docs/_meta/prs.json` (snapshot, ver §4.8) | `#91` |

### 4.1b Los PR como fuente

Los PR son donde quedaron las decisiones de arquitectura de verdad: 91 mergeados al 2026-10-13, con título que nombra la etapa y cuerpo que explica qué se decidió y por qué. La wiki los trata como fuente de primera clase, no como historia:

- **Snapshot versionado.** `npm run docs:prs` corre `gh pr list --state merged --limit 500 --json number,title,mergedAt,headRefName,body,files` y escribe `docs/_meta/prs.json` ordenado por número. Se versiona para que los tests corran en CI sin credenciales de GitHub. Lo refresca el skill `/docs-wiki` (§4.5) y quien cierre una etapa.
- **Tabla de PR.** `docs/decisiones/prs.md`: una fila por PR mergeado: `| # | fecha | título | páginas o motivo |`. La columna final nombra las páginas de la wiki donde quedó lo que ese PR cambió, o un motivo de por qué no deja rastro (`fix sin cambio de contrato`, `spike borrado`, `chore`). Es manual a propósito: la decisión de dónde va cada cosa la toma una persona o el modelo que ella invoca, nunca un script.
- **Test.** Todo PR de `prs.json` tiene fila; todo PR cuyo título empieza con `feat:` tiene al menos una página que existe, o un motivo de diez caracteres o más. Filas de PR que todavía no están en el snapshot (el PR abierto de la rama actual) se permiten: así `/ship` puede dejar la fila antes de mergear.
- **Lectura por el modelo.** Cuando `/docs-wiki` encuentra PR sin fila, lee su cuerpo y su lista de archivos (`gh pr view N --json body,files`) y de ahí saca qué página tocar. Para el llenado inicial (plan, fase 3) Sonnet lee los 91 cuerpos agrupados por dominio **antes** de escribir cada página de `dominios/`: las specs dicen qué se quiso, los PR dicen qué se hizo y qué se cambió sobre la marcha.

### 4.2 Páginas generadas (`npm run docs:sync`)

`scripts/docs/sync.ts` escribe `docs/referencia/*.md` a partir del inventario. Cada archivo arranca con `generated: true` en el frontmatter y un comentario `<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->`. Determinístico y ordenado, así el diff es legible. Es lo que `/document-release` llama "generated output": no lo edita, edita la fuente.

### 4.3 Tests (`tests/docs/*.test.ts`, corren con `npm test` y con `npm run docs:check`)

Mismo idioma que `registry.test.ts`: fallan hasta que alguien decide.

1. **Frontmatter válido.** Toda página fuera de `superpowers/` parsea con el schema zod de §3.3.
2. **Links resuelven.** Todo link markdown relativo apunta a un archivo que existe.
3. **Índice completo.** Toda página es alcanzable desde `docs/README.md` por links, y el índice no enlaza páginas que no existen.
4. **Fuentes existen.** Toda ruta en `sources` existe en el disco.
5. **Referencia fresca.** Correr `sync` en memoria produce exactamente lo que hay en `docs/referencia/`. Si no, el mensaje dice `npm run docs:sync`.
6. **Toda spec tiene fila.** Cada archivo de `docs/superpowers/specs` aparece en la tabla de `docs/decisiones/README.md`. **Este es el detector de feature nueva**: cada etapa nace con una spec. Y si la fila dice estado `cerrada`, la columna `páginas` tiene que nombrar al menos una página de la wiki que exista. `en curso` y `descartada` no exigen páginas. Así una etapa no se cierra sin documentarse, igual que el `[x]` del roadmap.
7. **Todo PR tiene fila.** Cada PR de `docs/_meta/prs.json` aparece en `docs/decisiones/prs.md`; los `feat:` nombran páginas que existen o un motivo (§4.1b).
8. **Toda superficie está cubierta.** Cada tool, nodo, workflow, tabla, ruta, proveedor, schedule y variable de entorno propia aparece **mencionada literalmente** en alguna página de `arquitectura/`, `dominios/` o `guias/` (las generadas no cuentan), o figura en `docs/_meta/cobertura.ts` con un motivo de al menos diez caracteres. Y al revés: nada en `cobertura.ts` que ya no exista en el disco.

Los tests leen el disco y nada más: corren en menos de dos segundos.

### 4.4 Hooks

- `.claude/settings.json` y `.codex/hooks.json`: al `Stop` hook actual (`npm run typecheck --silent`) se le suma `npm run docs:check --silent`. Si una sesión agregó una tool y no la documentó, el modelo ve el rojo antes de devolver el turno.
- Sin hook de git. El gate real es `npm test` en `/ship` y en CI.

### 4.5 Skill de proyecto `/docs-wiki` (`.claude/skills/docs-wiki/SKILL.md`)

Es la capa que necesita un modelo. Procedimiento corto que apunta a `docs/guias/documentar.md` (fuente única, así Codex también la lee):

1. `git diff main --stat` para saber qué cambió, y `npm run docs:prs` para traer los PR mergeados nuevos.
2. `npm run docs:sync` y `npm run docs:check`.
2b. Por cada PR sin fila en `decisiones/prs.md`: leer `gh pr view N --json body,files` y decidir páginas o motivo.
3. Por cada falla: página nueva, página existente actualizada, o exclusión con motivo. Nunca borrar el test.
4. Fila en `decisiones/README.md` si hay spec nueva; `updated` en cada página tocada.
5. Si la etapa cierra: estado `cerrada` + páginas.

Se invoca a mano al cerrar una etapa (va al checklist del roadmap §Cómo usar, junto con `/context-save`) y lo invoca quien corre `/ship` si `docs:check` está rojo.

### 4.6 CLAUDE.md y AGENTS.md

Tres líneas en CLAUDE.md, sección nueva "Documentación": dónde vive la wiki, que `referencia/` se regenera y no se edita, y que una etapa no cierra sin `/docs-wiki` en verde. Una línea en `AGENTS.md` (lo lee Codex) apuntando a `docs/guias/documentar.md`.

### 4.7 CI

No hay GitHub Actions hoy. Un workflow mínimo `.github/workflows/ci.yml`: `npm ci`, `npm run typecheck`, `npm test`. Sin Docker: los tests de Supabase (`db:test`) y las integraciones (`test:it*`) quedan fuera, igual que hoy. Es lo que vuelve al harness obligatorio para un PR, no solo para quien corre `/ship`.

## 5. Cómo interactúa con gstack

| Skill | Qué hace con la wiki | Qué hay que dejar listo |
|---|---|---|
| `/ship` | Corre `npm test` (incluye `tests/docs`), bumpea `VERSION`, escribe `CHANGELOG.md`, y en el paso 14.5 despacha `/document-release` para auditar docs. | Crear `VERSION` (`0.1.0`, igual que `package.json`) y `CHANGELOG.md` con formato Keep a Changelog y encabezado `[0.1.0]`. El README tiene que enlazar `docs/README.md` y CLAUDE.md declarar la raíz: así `/document-release` descubre la wiki. |
| `/document-release` | Lee el diff y actualiza docs que quedaron desactualizadas; respeta generados. | El comentario `Generado por...` en `referencia/` y la regla en CLAUDE.md de que se regeneran. |
| `/document-generate` | Escribe docs nuevas con Diataxis (tutorial / how-to / reference / explanation). | Nuestras carpetas son ese mapa: `guias/` = how-to, `referencia/` = reference, `arquitectura/` y `dominios/` = explanation, `guias/instalacion-local.md` = tutorial. `documentar.md` lo dice para que el skill ubique cada página. |
| `/review` | Revisa el diff antes de mergear. | Nada. `docs:check` rojo ya rompe los tests. |
| `/ship` (PR) | Crea el PR con el cuerpo que explica la decisión. | El cuerpo del PR sigue siendo la explicación larga: la wiki lo cita por número en `decisiones/prs.md`. `/ship` deja la fila del PR nuevo con sus páginas antes de pushear (el número sale de `gh pr create`). |
| `/context-save` y `/context-restore` | Contexto de sesión en `~/.gstack`, personal. | Nada. No es documentación del repo. Lo que sirve para otros va a la wiki. |
| `/learn` y `/retro` | Learnings personales en `~/.gstack`. | Nada. Si un learning es del repo, se pasa a mano a la página que corresponde. |
| `/sync-gbrain` | Indexa el repo en **gbrain**, el brain del coding agent. | **No aplica** y conviene decirlo en `documentar.md`: gbrain no es el brain del producto (`lib/brain`, MCP `brain-innovas`). Nadie tiene que confundirlos. |
| `/qa`, `/design-review` | Reportes en `.gstack/qa-reports`, no versionados. | Nada. |

## 6. Migración del contenido existente

| Hoy | Destino | Cómo |
|---|---|---|
| `docs/innovas-agents-kickoff.md` | `docs/producto/kickoff.md` | `git mv` + frontmatter. Se agrega una nota arriba: "documento fundacional, 2026-09-11; lo vigente está en arquitectura/". |
| `docs/01-roadmap-etapas.md` | `docs/producto/roadmap.md` | `git mv`. Sigue siendo el tracker de etapas. Se le suma al checklist de cierre `/docs-wiki`. |
| `docs/02-orquestacion.md` | `docs/arquitectura/orquestacion.md` | `git mv` + frontmatter. CLAUDE.md lo cita: actualizar. |
| `docs/llaves-de-clientes.md` | `docs/guias/llaves-de-clientes.md` | `git mv` + frontmatter. |
| `docs/brain-mcp-conexion.md` | `docs/guias/conectar-brain-por-mcp.md` | `git mv`. |
| `docs/agente-mcp-conexion.md` | `docs/guias/conectar-agente-por-mcp.md` | `git mv`. |
| `docs/producto-innovas-ai-os.md` (sin versionar) | `docs/producto/posicionamiento.md` | `git add` + frontmatter. Mati confirma que va al repo. |
| `docs/2026-10-09-evaluacion-gap-plataforma.md` y `plan-cierre` | `docs/producto/` | `git mv`. |
| `docs/arquitectura.html` y `.archify.json` | `docs/diagramas/` | `git mv`. El HTML pesa 815 KB: queda, pero la wiki enlaza el JSON como fuente y dice cómo regenerarlo con el skill `archify`. |
| `lib/brain/README.md` | Queda. | `dominios/brain.md` lo resume y lo enlaza. |

## 7. Criterio de terminado

1. Alguien que no conoce el repo clona, sigue `README.md` y llega a `npm run dev` con login funcionando en local sin preguntar nada. Se prueba de verdad: Mati lo hace en una carpeta limpia o se lo pide al programador nuevo el primer día, y lo que trabe se corrige en `guias/instalacion-local.md`.
2. `npm run docs:check` verde en `main`.
3. Prueba del detector: en una rama descartable se agrega `agents/outreach/tools/dummy_tool.ts`, una tabla en una migración y una ruta; `docs:check` falla nombrando las tres; se documentan; pasa. Se registra en el plan como verificación, no se mergea.
4. `/ship` de esta misma etapa termina con `Documentation: updated` o `current`, `VERSION` y `CHANGELOG.md` escritos por el skill.
5. `docs/decisiones/README.md` tiene las 29 specs con estado, y toda `cerrada` apunta a páginas.
6. `docs/decisiones/prs.md` tiene los 91 PR con páginas o motivo, y lo que dicen los cuerpos de los PR `feat:` está reflejado en `dominios/` y `arquitectura/`.

## 8. Fuera de alcance

- Render web de la wiki (Docusaurus, Nextra). Se lee en GitHub y en el editor.
- Documentación en inglés.
- Importar la wiki al brain del producto. El formato lo permite (`brain:import`); se decide después.
- Generar prosa con un modelo en CI. El modelo escribe solo cuando una persona lo invoca (`/docs-wiki`, `/ship`).
- Documentar `node_modules/eve/docs`: se enlaza, no se copia.

## 9. Riesgos

- **Prosa generada por Sonnet que suena bien y está mal.** Mitigación: cada página de dominio lleva `sources`, y el plan exige leer esas fuentes antes de escribir. La revisión de Mati mira dominios/ y arquitectura/, no referencia/.
- **El test de cobertura por mención literal es laxo.** Que `queue_items` aparezca en una página no prueba que esté explicado. Es a propósito: el test detecta ausencia, la calidad la pone la persona. Se puede endurecer después.
- **Fricción.** Si el harness pide demasiado, se desactiva. Por eso las exclusiones con motivo existen desde el día uno y `en curso` no exige páginas.
