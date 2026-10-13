# Etapa 25: Wiki de documentación y harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un programador nuevo levante el proyecto siguiendo solo `README.md`, entienda la arquitectura leyendo `docs/`, y que el repo se ponga rojo cuando una feature nueva (tool, nodo, workflow, tabla, ruta, proveedor, variable, spec o PR) no dejó rastro en la wiki.

**Architecture:** Wiki markdown en `docs/` con frontmatter y categorías (arquitectura, dominios, guias, referencia, decisiones, producto). Un inventario determinístico (`scripts/docs/inventory.ts`) lista las superficies del repo; `docs:sync` genera `referencia/` desde ese inventario; `tests/docs/` compara wiki contra disco y contra el snapshot de PR mergeados, y falla hasta que alguien decide. Un skill de proyecto `/docs-wiki` es el procedimiento para que un modelo cierre lo que falta. gstack `/ship` mantiene `VERSION` y `CHANGELOG.md` y audita la wiki.

**Tech Stack:** TypeScript con `node:fs`, Zod 4, Vitest, Biome, `gh` CLI. Sin dependencias nuevas salvo que se necesite un parser de frontmatter: usar `yaml` (ya instalado) con un split manual de `---`.

**Spec:** `docs/superpowers/specs/2026-10-13-etapa-25-wiki-documentacion-design.md`. Los números de sección de abajo (§) son de la spec.

## Global Constraints

- Rama `docs/etapa-25-wiki` (ya creada desde `main`). Identidad git local `innovasbuild` / `matias@innov.as`.
- Español rioplatense en toda la prosa de la wiki, el README y los mensajes de test. Código e identificadores en inglés.
- Los archivos existentes se mueven con `git mv`, nunca copiar y borrar: hay que conservar la historia.
- Antes de escribir una página de `dominios/` o `arquitectura/`, leer sus `sources` completas (specs, README de módulo, código) **y los cuerpos de los PR** que la tabla de la Task 13 le asigna. No escribir de memoria. Si algo de la spec no coincide con el código, manda el código, y se anota en la página bajo "Decisiones" que la spec quedó atrás.
- Nada específico de un tenant en la wiki salvo en `producto/` y en ejemplos marcados como ejemplo.
- Todo `async` con `try/catch`. Funciones del inventario puras: reciben la raíz del repo como argumento para poder testearlas contra `tests/fixtures/docs/`.
- Después de cada tarea: `npm run typecheck` y `npm test`. `npm run lint:fix` reformatea cuatro archivos ajenos: revertirlos con `git checkout -- <archivo>` antes de commitear.
- Commits con prefijo `feat:`, `fix:`, `docs:`, `refactor:` y la línea final `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Un commit por tarea como mínimo.
- No tocar `docs/superpowers/`, salvo para leer.
- No tocar `.gstack/`, `.eve/`, `node_modules/`.
- Si `gh` pide autenticación o falla, frenar y avisar: la Task 11 y la 13 dependen de él.

## Review Focus

1. **El harness no se puede esquivar en silencio.** Toda excepción vive en `docs/_meta/cobertura.ts` o en la columna "motivo" de las tablas, con texto. No existe un `skip` en los tests. Task 6 y 7.
2. **Las páginas generadas no mienten.** `docs:sync` es determinístico: dos corridas seguidas sobre el mismo disco producen bytes idénticos (orden alfabético, sin fechas ni timestamps). Task 5.
3. **Prosa respaldada.** Cada afirmación de `dominios/` y `arquitectura/` tiene que poder rastrearse a una `source` o a un PR citado. Las páginas que no cumplen vuelven. Task 14 a 20.
4. **El README se prueba en limpio.** La Task 9 incluye clonar en una carpeta temporal y seguir el README al pie de la letra.
5. **El detector funciona.** La Task 23 lo prueba con una tool, una tabla y una ruta falsas, y registra la salida en el plan.

---

## Fase 0 · Convenciones y esqueleto

### Task 1: Esqueleto de carpetas e índice vacío

**Files:**
- Create: `docs/README.md`, `docs/arquitectura/.gitkeep`, `docs/dominios/.gitkeep`, `docs/guias/.gitkeep`, `docs/referencia/.gitkeep`, `docs/decisiones/.gitkeep`, `docs/producto/.gitkeep`, `docs/diagramas/.gitkeep`, `docs/_meta/.gitkeep`

- [ ] **Step 1:** Crear `docs/README.md` con frontmatter (`title: Índice de la documentación`, `category: indice`, `status: activo`, `updated`) y las seis secciones vacías del árbol de la spec §3.2, en este orden: Empezar acá · Arquitectura · Dominios · Guías · Referencia · Decisiones · Producto. Debajo del título, tres líneas: qué es este índice, que las páginas de `referencia/` se regeneran con `npm run docs:sync`, y que la forma de mantener la wiki está en `guias/documentar.md`.
- [ ] **Step 2:** Crear las carpetas con `.gitkeep` (se borran cuando cada carpeta tenga su primera página).
- [ ] **Step 3:** Commit `docs: esqueleto de la wiki`.

### Task 2: Mover lo que ya existe

**Files:**
- Move (git mv): según la tabla de la spec §6.
- Modify: `CLAUDE.md` (dos paths citados), `docs/README.md`

- [ ] **Step 1:** `git mv` de cada archivo según §6. `docs/producto-innovas-ai-os.md` no entra al repo (decisión de Mati: vive en el brain de innovas, `producto/innovas-central-ia`); no se mueve ni se versiona.
- [ ] **Step 2:** Agregar frontmatter (§3.3) a cada archivo movido. Los que ya tienen frontmatter (`roadmap`, `kickoff`) se adaptan al schema: conservar `title`, `fecha` pasa a `updated`, `estado` se borra o pasa a `status: activo`, agregar `category`. `sources` no es obligatorio en `producto/`.
- [ ] **Step 3:** En `kickoff.md`, agregar debajo del frontmatter una nota de tres líneas: documento fundacional del 2026-09-11, parcialmente superado, lo vigente está en `../arquitectura/`.
- [ ] **Step 4:** En `CLAUDE.md`, reemplazar `docs/innovas-agents-kickoff.md` por `docs/producto/roadmap.md` (es el tracker, lo que de verdad se usa) y `docs/02-orquestacion.md` por `docs/arquitectura/orquestacion.md`. Buscar con `grep -rn "docs/" CLAUDE.md AGENTS.md README.md` que no quede otro path viejo.
- [ ] **Step 5:** Buscar referencias a los paths viejos en código y tests: `grep -rn "docs/0[12]-\|innovas-agents-kickoff\|llaves-de-clientes\|mcp-conexion" lib app agents tests scripts`. Si hay (por ejemplo un link en una pantalla), actualizarlas. Las referencias dentro de `docs/superpowers/` no se tocan.
- [ ] **Step 6:** Enlazar cada archivo movido desde `docs/README.md` en su sección.
- [ ] **Step 7:** `npm run typecheck && npm test`. Commit `docs: mover la documentación existente a la wiki`.

### Task 3: La guía de cómo documentar

**Files:**
- Create: `docs/guias/documentar.md`

- [ ] **Step 1:** Escribir la página con estas secciones: Dónde va cada cosa (tabla categoría → qué contiene → equivalente Diataxis, §5 fila `/document-generate`) · Frontmatter (§3.3, copiado) · Forma de una página de dominio (§3.4) · Links (relativos, nunca `[[wikilinks]]`, por qué) · Lo generado no se edita (`npm run docs:sync`) · El harness (qué verifica cada test, §4.3, en una tabla) · Exclusiones (`docs/_meta/cobertura.ts`, cuándo corresponde) · Specs y PR (`decisiones/README.md`, `decisiones/prs.md`, estados, qué exige cada estado) · Procedimiento al cerrar una etapa (los pasos del skill §4.5) · gstack (la tabla de §5, incluida la aclaración de que `/sync-gbrain` no es el brain del producto).
- [ ] **Step 2:** Enlazar desde `docs/README.md` en "Empezar acá".
- [ ] **Step 3:** Commit `docs: guía para mantener la wiki`.

---

## Fase 1 · Harness determinístico

### Task 4: Inventario de superficies

**Files:**
- Create: `scripts/docs/inventory.ts`
- Create: `tests/docs/inventory.test.ts`, `tests/fixtures/docs/repo-minimo/` (un repo de juguete: dos tools, un schedule, una migración con dos tablas, tres rutas, un `package.json`, un archivo con `process.env.FOO`, una spec)

**Interfaces:**
- `inventory(root: string): Promise<Inventory>` donde `Inventory = { tools: Surface[]; schedules: Surface[]; nodes: Surface[]; workflows: Surface[]; tables: Surface[]; migrations: Surface[]; routes: Surface[]; providers: Surface[]; scripts: Surface[]; envVars: Surface[]; evals: Surface[]; specs: Surface[] }` y `Surface = { key: string; path: string; meta?: Record<string, string> }`.
- `nodes`, `workflows` y `providers` salen de importar `@/lib/workflows/registry` y `@/lib/connectors/providers` (no de parsear). Para el fixture, esas tres listas se inyectan por parámetro opcional `deps`.

- [ ] **Step 1: Test que falla.** `tests/docs/inventory.test.ts` corre `inventory` contra el fixture y espera exactamente las claves de cada superficie, por ejemplo `tools` → `["demo/hello", "demo/bye"]`, `routes` → `["/", "/[tenant]/cosa", "/api/x"]`, `tables` → `["cosas", "otras"]`, `envVars` → `["FOO"]` (no `NODE_ENV`, que también está en el fixture).
- [ ] **Step 2:** Implementar. Reglas:
  - Rutas: `app/**/page.tsx` → path sin `page.tsx`; `route.ts` → path sin `route.ts`; grupos `(auth)` se quitan; `/.well-known/...` se conserva.
  - Tablas: regex `/create table (?:if not exists )?public\.([a-z_]+)/gi` sobre cada migración; clave única, `path` de la primera migración que la crea.
  - Env vars: regex `/process\.env\.([A-Z][A-Z0-9_]*)/g` sobre `lib`, `app`, `agents`, `scripts`, `proxy.ts`, saltando directorios `.eve`, `node_modules`, `.next`. Lista fija de exclusión exportada como `PLATFORM_ENV_VARS`: `NODE_ENV`, `VERCEL`, `VERCEL_*`, `XDG_*`, `PATH`, `PATHEXT`, `OSTYPE`, `APPDATA`, `LOCALAPPDATA`, `WINDIR`, `CI`, `HOME`. Revisar la salida real contra el repo: si aparece algo raro (como `process.env.S`), investigar de dónde sale antes de excluirlo.
  - Todo ordenado alfabéticamente por `key`.
- [ ] **Step 3:** Un segundo test corre `inventory(".")` contra el repo real y verifica cosas que sabemos ciertas hoy: `tools` incluye `outreach/send_email`, `tables` incluye `queue_items`, `routes` incluye `/[tenant]/cola`, `envVars` incluye `PLATFORM_OWNER_TENANT_SLUG` y no incluye `NODE_ENV`.
- [ ] **Step 4:** `npm run typecheck && npm test`. Commit `feat: inventario de superficies del repo para la wiki`.

### Task 5: Generación de `referencia/` y `docs:sync`

**Files:**
- Create: `scripts/docs/sync.ts`, `scripts/docs/sync.mts` (entry point: `node scripts/docs/sync.mts`, mismo estilo que `scripts/brain-import.mts`)
- Create: `tests/docs/sync.test.ts`
- Modify: `package.json` (scripts `docs:sync`, `docs:check`)

**Interfaces:**
- `renderReference(inv: Inventory, extras: { toolLabels: Record<string,string>; packageScripts: Record<string,string> }): Record<string, string>` → mapa `nombre-de-archivo.md → contenido`. Pura.
- `docs:sync` = escribe ese mapa en `docs/referencia/`. `docs:check` = `vitest run tests/docs`.

- [ ] **Step 1: Test que falla.** `renderReference` con el inventario del fixture produce `comandos.md`, `variables-de-entorno.md`, `tablas.md`, `migraciones.md`, `rutas.md`, `tools-del-agente.md`, `nodos-y-workflows.md`, `proveedores.md`, `schedules.md`, `evals.md`; cada uno arranca con frontmatter `generated: true`, `category: referencia`, y la línea `<!-- Generado por scripts/docs/sync.ts. No editar a mano: npm run docs:sync -->`. Determinismo: dos llamadas producen el mismo objeto.
- [ ] **Step 2:** Implementar. Cada página es una tabla markdown. Columnas:
  - `tools-del-agente.md`: tool · etiqueta (`TOOL_LABELS` o "sin etiqueta a propósito" si está en `TOOLS_SIN_ETIQUETA`) · archivo.
  - `nodos-y-workflows.md`: dos tablas. Nodos: clave · nivel de efecto · tier · modelo fijo. Workflows: nombre · reclama · produce · nodos · caps. Más la lista `SERVICES_EXCLUIDOS` con su motivo.
  - `tablas.md`: tabla · migración que la crea.
  - `rutas.md`: ruta · tipo (página / endpoint) · archivo.
  - `variables-de-entorno.md`: variable · archivos que la leen (hasta tres, luego "y N más").
  - `comandos.md`: script · comando.
  - `proveedores.md`: proveedor · capacidad · múltiple · kind · authKind.
  - `schedules.md`, `evals.md`, `migraciones.md`: nombre · archivo.
  - `updated` en el frontmatter de los generados **no se pone** (rompería el determinismo); en su lugar `generated: true` basta y el test de frontmatter lo contempla.
- [ ] **Step 3:** `package.json`: `"docs:sync": "node scripts/docs/sync.mts"`, `"docs:check": "vitest run tests/docs"`. Correr `npm run docs:sync`, mirar los diez archivos con ojo crítico (¿la tabla de rutas tiene sentido? ¿faltan env vars?), corregir el inventario si hace falta.
- [ ] **Step 4:** Enlazar las diez páginas desde `docs/README.md` en Referencia. Borrar `docs/referencia/.gitkeep`.
- [ ] **Step 5:** `npm run typecheck && npm test`. Commit `feat: docs:sync genera la referencia de la wiki desde el disco`.

### Task 6: Tests de forma de la wiki (frontmatter, links, índice, fuentes, frescura)

**Files:**
- Create: `scripts/docs/wiki.ts` (helpers puros: `listPages(root)`, `parseFrontmatter(text)`, `extractLinks(text)`, `reachableFrom(index)`), `scripts/docs/schema.ts` (zod del §3.3)
- Create: `tests/docs/wiki.test.ts`

- [ ] **Step 1: Tests que fallan** (uno por regla de la spec §4.3, puntos 1 a 5), cada uno con mensaje en castellano que diga qué archivo y qué arreglar:
  1. Frontmatter válido en toda página de `docs/**` salvo `docs/superpowers/**` y `docs/diagramas/**`. `generated: true` exime de `updated` y `sources`. `producto/` y `decisiones/` eximen de `sources`.
  2. Todo link markdown relativo (`](../x/y.md)` o `](y.md)`, con o sin `#ancla`) resuelve a un archivo. Links `http(s)://` y `mailto:` se ignoran. Links a `docs/superpowers/**`, a `lib/**` y a cualquier archivo del repo valen si existen.
  3. Toda página es alcanzable desde `docs/README.md` (BFS por links). Y el índice no enlaza páginas inexistentes (lo cubre el 2).
  4. Toda ruta de `sources` existe en el repo.
  5. `renderReference(await inventory("."))` coincide byte a byte con `docs/referencia/*.md`. Mensaje: `docs/referencia está desactualizada: npm run docs:sync`.
- [ ] **Step 2:** Implementar los helpers. `parseFrontmatter`: split por la primera y segunda línea `---`, `yaml.parse` del medio. Sin dependencia nueva.
- [ ] **Step 3:** Hacer pasar los tests contra el repo real: corregir frontmatters de la Task 2, links rotos, páginas no enlazadas.
- [ ] **Step 4:** Commit `feat: la wiki se verifica sola: frontmatter, links, índice, fuentes y referencia fresca`.

### Task 7: Tests de cobertura (superficies, specs, PR) y exclusiones

**Files:**
- Create: `docs/_meta/cobertura.ts`, `docs/_meta/prs.json` (lo llena la Task 11; acá un `[]`), `docs/decisiones/README.md`, `docs/decisiones/prs.md` (tablas vacías con encabezado), `scripts/docs/prs.ts` (helpers: `parsePrTable`, `parseSpecTable`)
- Create: `tests/docs/cobertura.test.ts`

**Interfaces:**
- `docs/_meta/cobertura.ts`: `export const SIN_DOCUMENTAR: Record<string, string>` con clave `"<superficie>:<key>"` (`"route:/sin-acceso"`, `"env:AI_GATEWAY_API_KEY"`) y motivo.
- `decisiones/README.md`: tabla `| fecha | etapa | spec | plan | estado | páginas |`. `spec` y `plan` son links relativos a `../superpowers/...`. `estado` ∈ `en curso` · `cerrada` · `descartada`. `páginas` es una lista de links separados por ` · `.
- `decisiones/prs.md`: tabla `| # | fecha | título | páginas o motivo |`. `#` es link a `https://github.com/innovasbuild/innovas-agents/pull/N` (confirmar el owner/repo con `gh repo view --json nameWithOwner`).

- [ ] **Step 1: Tests que fallan** (spec §4.3 puntos 6, 7 y 8, más los inversos):
  6. Toda spec de `docs/superpowers/specs/*.md` tiene fila. Toda fila `cerrada` tiene al menos una página y todas existen. Mensaje con el nombre de la spec que falta.
  7. Todo PR de `prs.json` tiene fila en `prs.md`. Toda fila de PR `feat:` tiene página que existe o motivo de diez caracteres o más. Filas de PR que no están en el snapshot se permiten (PR abierto).
  8. Toda superficie del inventario (tools, schedules, nodes, workflows, tables, routes, providers, envVars) aparece mencionada literalmente (por `key`, para rutas por el path, para tools por el nombre sin dominio: `send_email`) en el cuerpo de alguna página de `arquitectura/`, `dominios/` o `guias/`, o está en `SIN_DOCUMENTAR` con motivo. `scripts`, `migrations`, `evals` y `specs` no se exigen por mención (ya los cubre `referencia/` y la tabla de specs).
  9. Inverso: nada en `SIN_DOCUMENTAR` que no exista en el inventario.
- [ ] **Step 2:** Implementar los parsers de tabla (markdown simple: filas que empiezan con `|`, split por `|`, trim). Implementar los tests.
- [ ] **Step 3:** Correr. Van a fallar masivamente: todavía no hay páginas. **No agregar exclusiones para que pase.** Dejar la rama en rojo hasta la Fase 3 es esperado. Para que `npm test` siga siendo útil mientras tanto, los tests de cobertura se marcan `it.todo`... no: se dejan fallando y el commit lo dice. Mientras dure la Fase 3, correr `npm test -- --exclude tests/docs/cobertura.test.ts` para el resto.
- [ ] **Step 4:** Commit `feat: la wiki exige cobertura de superficies, specs y PR`.

---

## Fase 2 · Entrada al repo: README, hooks, skill, gstack, CI

### Task 8: README del proyecto

**Files:**
- Rewrite: `README.md`
- Create: `docs/guias/instalacion-local.md`

- [ ] **Step 1:** Antes de escribir, relevar lo que hace falta de verdad para levantar en local: leer `package.json`, `.env.eval.example`, `supabase/config.toml`, `lib/supabase/*` (qué variables lee el cliente), `proxy.ts`, `.nvmrc`, `.claude/hooks/check-gstack.sh`, y las memorias/planes que mencionan `vercel env pull`. Listar las variables de `.env.local` que el código lee (`inventory().envVars`) y para cada una decir de dónde sale (Vercel env pull, `npx supabase status -o env`, a mano).
- [ ] **Step 2:** `README.md` nuevo, corto (menos de 120 líneas): qué es (dos párrafos: plataforma multi-tenant de agentes que INNOV.AS opera para clientes; producto Central IA) · Requisitos (Node 24+, Docker, Supabase CLI vía `npx`, cuenta de Vercel con acceso al proyecto, `gh`, gstack instalado en `~/.claude/skills/gstack`) · Instalación paso a paso en bloques `bash` de un comando cada uno (`git clone`, `nvm use`, `npm ci`, `vercel link`, `vercel env pull .env.local`, `npm run db:start`, `npm run db:reset`, `npm run dev`) · Primer login en local (cómo entrar: qué usuario siembra `supabase/seed.sql`, o Google OAuth si aplica) · Comandos (tabla corta, link a `docs/referencia/comandos.md`) · Documentación: link a `docs/README.md` con una línea por categoría · Cómo se trabaja (una línea: etapas, specs, `/ship`; link a `docs/guias/documentar.md` y a `CLAUDE.md`).
- [ ] **Step 3:** `docs/guias/instalacion-local.md`: lo mismo con el detalle que el README no lleva: problemas conocidos (Docker apagado, puerto 54321 ocupado, `typecheck` que pide `next typegen`, `.env.local` sin `VERCEL_OIDC_TOKEN` vencido), cómo correr `db:test`, `evals` (`.env.eval`), `test:it`. `sources`: los archivos relevados en Step 1.
- [ ] **Step 4:** Enlazar ambos en `docs/README.md` ("Empezar acá"). Commit `docs: README con instalación y entrada a la wiki`.

### Task 9: Probar el README en una carpeta limpia

- [ ] **Step 1:** En el scratchpad de la sesión, `git clone <ruta local del repo> prueba-readme && cd prueba-readme && git checkout docs/etapa-25-wiki`. Seguir el README **literal**, comando por comando, sin saltar nada. `vercel link` y `vercel env pull` pueden pedir cuenta: si no se puede, copiar `.env.local` del repo original y anotar en el README que ese paso requiere acceso al proyecto de Vercel.
- [ ] **Step 2:** Cada traba se corrige en el README o en `instalacion-local.md`, no en la cabeza.
- [ ] **Step 3:** Registrar en este plan, debajo de esta tarea, qué trabó y qué se cambió. Borrar la carpeta de prueba. Commit `docs: README probado en limpio`.

**Resultado de la prueba (2026-10-13, Sonnet 5.5, Docker apagado en la máquina):**

- Probado en un clon limpio de la rama: `nvm use`, `npm ci`, `npm run typecheck`, `env -i ... npm test` (sin `.env.local`: pasa todo salvo los dos tests de cobertura que esperan la Fase 3) y `next dev` con el `.env.local` del README (la app levanta; `/login/demo` da 404 porque no hay base).
- **No probado: `db:start`, `db:reset`, el ingreso con código por Mailpit ni el `update tenants` por `docker exec`.** Docker estaba apagado. Hay que repetirlo con Docker abierto, idealmente con el programador nuevo el primer día, y corregir `README.md` o `instalacion-local.md` con lo que trabe.
- Hallazgo: el `.env.local` que baja `vercel env pull` apunta a la Supabase de la nube. El README ya pide bajarlo a `.env.vercel` y copiar solo la llave del modelo.
- El clon avisa `Ignoring unsupported directory "evals/"` al arrancar eve: es ruido conocido, no bloquea.

### Task 10: Hooks, CLAUDE.md, AGENTS.md

**Files:**
- Modify: `.claude/settings.json`, `.codex/hooks.json`, `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1:** En ambos archivos de hooks, al `Stop` agregar un segundo hook `{ "type": "command", "command": "npm run docs:check --silent" }` después del typecheck. `.codex/` está sin versionar: `git add .codex/hooks.json .codex/hooks/` solo si Mati confirma que va al repo; si no, dejarlo fuera y anotarlo en el reporte final. (Pregunta abierta en el reporte, no bloquea.)
- [ ] **Step 2:** `CLAUDE.md`, sección nueva `## Documentación` de cuatro líneas: la wiki vive en `docs/` y arranca en `docs/README.md` · `docs/referencia/` se regenera con `npm run docs:sync` y no se edita a mano · una etapa no se cierra sin `/docs-wiki` en verde (`npm run docs:check`) · cómo documentar está en `docs/guias/documentar.md`. Agregar `/docs-wiki` al "Skill routing" del final: `Cerrar etapa o documentar una rama → /docs-wiki`.
- [ ] **Step 3:** `AGENTS.md`: una línea debajo del bloque de Next.js: `Documentación del repo: docs/README.md. Cómo mantenerla: docs/guias/documentar.md.`
- [ ] **Step 4:** Commit `feat: el Stop hook corre docs:check y CLAUDE.md apunta a la wiki`.

### Task 11: Snapshot de PR y `docs:prs`

**Files:**
- Create: `scripts/docs/prs.mts`
- Modify: `package.json` (`"docs:prs": "node scripts/docs/prs.mts"`), `docs/_meta/prs.json`

- [ ] **Step 1:** `scripts/docs/prs.mts`: ejecuta `gh pr list --state merged --limit 500 --json number,title,mergedAt,headRefName,body,files` con `node:child_process` (`execFile`, no `exec`), ordena por `number` ascendente, reduce `files` a `path` solamente, y escribe `docs/_meta/prs.json` con `JSON.stringify(..., null, "\t")` y salto final. Si `gh` falla, imprime el error y sale con código 1 sin tocar el archivo.
- [ ] **Step 2:** Correr `npm run docs:prs`. Verificar que hay 91 PR (o más si se mergeó algo). Mirar el tamaño del archivo: si supera 1 MB por los cuerpos, dejar `body` igual (es la fuente) y anotarlo.
- [ ] **Step 3:** Commit `feat: docs:prs guarda el snapshot de PR mergeados`.

### Task 12: Skill de proyecto `/docs-wiki`, VERSION, CHANGELOG, CI

**Files:**
- Create: `.claude/skills/docs-wiki/SKILL.md`, `VERSION`, `CHANGELOG.md`, `.github/workflows/ci.yml`
- Modify: `docs/producto/roadmap.md` (checklist de cierre), `docs/README.md`

- [ ] **Step 1:** `SKILL.md` con frontmatter `name: docs-wiki`, `description: Documentar en la wiki lo que cambió en esta rama y cerrar los PR y specs sin fila. Usar al cerrar una etapa o cuando npm run docs:check está rojo.` Cuerpo: los pasos de la spec §4.5 (con el 2b de los PR), y la instrucción de leer `docs/guias/documentar.md` primero. Menos de 60 líneas. Termina con "Reportar: páginas creadas, actualizadas, exclusiones agregadas con motivo, filas de PR y specs, y lo que quedó `en curso`".
- [ ] **Step 2:** `VERSION` con `0.1.0` (igual que `package.json`). `CHANGELOG.md` en formato Keep a Changelog con `## [0.1.0] - 2026-10-13` y una entrada `### Added` que resume las etapas 0 a 21 en cinco líneas (link al roadmap). Verificar con `bun run ~/.claude/skills/gstack/bin/gstack-version-bump classify --base main` que el estado no es `DRIFT_*`; si lo es, leer la salida y corregir.
- [ ] **Step 3:** `.github/workflows/ci.yml`: en `pull_request` y `push` a `main`; `actions/checkout@v4`, `actions/setup-node@v4` con `node-version-file: .nvmrc` y `cache: npm`, `npm ci`, `npm run typecheck`, `npm test`. Sin Docker. Verificar que `npm test` corre sin `.env.local` en una terminal con `env -i PATH=$PATH HOME=$HOME npm test`; si algún test depende de variables, arreglar ese test o excluirlo con motivo en `vitest.config.ts`.
- [ ] **Step 4:** En `docs/producto/roadmap.md` §Cómo usar, paso 4 ("Al cerrar la sesión"): agregar `/docs-wiki` antes de `/context-save`. Enlazar `CHANGELOG.md` desde `docs/README.md` (Decisiones).
- [ ] **Step 5:** Commit `feat: skill /docs-wiki, VERSION, CHANGELOG y CI`.

---

## Fase 3 · Contenido

Cada página de esta fase sigue la forma de §3.4 y lleva `sources`. **Leer las fuentes y los PR asignados antes de escribir.** Para leer un PR: `node -e 'const p=require("./docs/_meta/prs.json").find(x=>x.number===N); console.log(p.title+"\n\n"+p.body)'`.

### Task 13: Mapa de specs y PR por dominio

**Files:**
- Modify: `docs/decisiones/README.md`, `docs/decisiones/prs.md`

- [ ] **Step 1:** Llenar la tabla de specs: las 29. Fecha y etapa salen del nombre y del encabezado de cada spec; el plan del mismo nombre en `plans/`; `estado` según `docs/producto/roadmap.md` (`[x]` → `cerrada`, `[~]` o `[ ]` con PR mergeado → `en curso`; las que el roadmap marca como no arrancadas y sin PR → `en curso`). La columna `páginas` queda vacía por ahora (se llena en las Tasks 14 a 21). Como una `cerrada` sin páginas hace fallar el test, hasta terminar la fase todas van `en curso`; la Task 22 las pasa a `cerrada`.
- [ ] **Step 2:** Llenar la tabla de PR: los 91, en orden. Título y fecha del snapshot. Columna final por ahora: para `fix:`, `chore:` y `docs:`, un motivo corto leyendo el cuerpo (`fix sin cambio de contrato`, `spike borrado en #21`, `solo docs/superpowers`); para `feat:`, la palabra `pendiente` (el test va a fallar hasta que las Tasks 14 a 21 pongan páginas). Si un `fix:` cambió un contrato (por ejemplo #80 memberships, #82 canal MCP, #6 fuga de credencial), ponerle página igual que a un feat.
- [ ] **Step 3:** Armar en este plan, debajo de esta tarea, la **asignación**: para cada página de las Tasks 14 a 21, la lista de números de PR y specs que la respaldan. Es el insumo de cada tarea siguiente; se escribe acá para que un subagente por tarea no tenga que releer los 91.
- [ ] **Step 4:** Commit `docs: tablas de specs y PR con asignación por dominio`.

### Task 14: Arquitectura: visión general, tenancy, datos

**Files:**
- Create: `docs/arquitectura/vision-general.md`, `docs/arquitectura/tenancy.md`, `docs/arquitectura/datos.md`

- [ ] **Step 1 `vision-general.md`:** el dibujo del kickoff §2 redibujado contra el código de hoy (eve 0.67, canal MCP, consola de plataforma, workflows, Connect), los principios (un agente N tenants, por capacidad nunca por cliente, append-only, nada de un tenant en código), y un mapa de carpetas de primer nivel con una línea por carpeta. `sources`: kickoff, spec arquitectura-plataforma, `package.json`, `app/`, `lib/`, `agents/`.
- [ ] **Step 2 `tenancy.md`:** tenants, memberships, roles, `platform_admin` y tenant dueño (`PLATFORM_OWNER_TENANT_SLUG`), slugs reservados, RLS por `tenant_id`, `tenant_agents`, bloqueos, qué pasa con una empresa sin agentes. `sources`: specs 01-multi-tenant, consola-plataforma, 21-4; migraciones de tenants y memberships; PR asignados.
- [ ] **Step 3 `datos.md`:** las 27 tablas agrupadas por dominio con una línea cada una (plataforma · brain · outreach · orquestación · auth), `events` append-only y sus familias de tipos, `work_items` como aristas, `runs` y `usage_entries`, Realtime en `queue_items` y `contacts`, convenciones de migraciones (`security definer`, `set search_path = ''`, grants a `service_role`, revokes a `anon`), y `npm run db:types`. `sources`: todas las migraciones, specs de orquestación y outreach.
- [ ] **Step 4:** Links desde `docs/README.md`. `npm run docs:check` para ver cuánto bajó la cobertura faltante. Commit.

### Task 15: Arquitectura: orquestación (revisión), identidad y acceso, entornos y deploy, modelos y costos

**Files:**
- Modify: `docs/arquitectura/orquestacion.md` (ya movido: revisar contra `lib/workflows/registry.ts` y los PR de la etapa 12/13; agregar `sources` y sección "Cómo se prueba")
- Create: `docs/arquitectura/identidad-y-acceso.md`, `docs/arquitectura/entornos-y-deploy.md`, `docs/arquitectura/modelos-y-costos.md`

- [ ] **Step 1 `identidad-y-acceso.md`:** Supabase Auth (Google, Microsoft, link mágico, código por correo), ingreso por dominio, métodos impuestos por empresa, `login-gate`, `join-on-login`, bloqueo por persona, Supabase como servidor OAuth 2.1 para el canal MCP (emisor, consentimiento, `oauth_client_role_hook`), `verify-caller`, qué hace `proxy.ts`. `sources`: `lib/auth/*`, `proxy.ts`, specs 20, ingreso-por-dominio, 11, 6; PR asignados.
- [ ] **Step 2 `entornos-y-deploy.md`:** Vercel (preview y producción), variables por entorno y de dónde salen, Supabase local vs producción, orden "migración antes que código" (`supabase migration list` y `db push`), `PLATFORM_OWNER_TENANT_SLUG` en Vercel, qué verifica un cierre en producción. `sources`: planes de registro 21.4b, memorias no (no están en el repo): usar los planes y specs que lo documentan, `vercel.json`, `next.config.ts`.
- [ ] **Step 3 `modelos-y-costos.md`:** AI Gateway, `lib/agents/model.ts`, tiers (`barato`/`medio`/`fuerte`) y modelo fijo por nodo (`typesafe-ai/jev`), `metered()` y `usage_entries`, presupuestos por tenant (`tenant_budgets`), caps por workflow. `sources`: `lib/agents/model.ts`, `lib/workflows/*`, migraciones de usage y budgets, spec orquestación §medición; PR #32, #41.
- [ ] **Step 4:** Links, `docs:check`, commit.

### Task 16: Dominio: agentes-eve y outreach

**Files:**
- Create: `docs/dominios/agentes-eve.md`, `docs/dominios/outreach.md`

- [ ] **Step 1 `agentes-eve.md`:** cómo está armado `agents/outreach/` (agent.ts, instructions por tenant, tools, connections, channels, schedules, hooks, skills, evals), `defineDynamic` y qué se resuelve en `session.started`, catálogo `lib/agents/catalog.ts`, sesiones y `session-store`, canal MCP del agente (`mcp-channel-auth`, `.well-known`), `running-tool` y `TOOL_LABELS`, aprobaciones (`approval` en tools de nivel 2 y 3), adjuntos, `input-requests`. Dónde leer eve: `node_modules/eve/docs/README.md`. Cómo se prueba: `tests/agents`, `tests/chat`, `npm run evals`. `sources`: `agents/outreach/**`, `lib/agents/*`, specs 03, 6, 14; PR asignados.
- [ ] **Step 2 `outreach.md`:** el proceso (canon, ICP, hooks, vectores), cola y piezas, pipeline y contactos, cuentas y fichas, focos y target-search, gate y guards, listen y follow-ups, CRM (HubSpot por Connect, `crm-record`, `crm-sync`), settings de outreach, `lib/outreach/services/*` como nodos. Cómo se prueba. `sources`: `lib/outreach/**`, specs 03, 4, 5, 13, 21-3, hubspot-crm-sync; PR asignados.
- [ ] **Step 3:** Links, `docs:check`, commit.

### Task 17: Dominio: brain y workflows

**Files:**
- Create: `docs/dominios/brain.md`, `docs/dominios/workflows.md`

- [ ] **Step 1 `brain.md`:** qué es, proveedor `wiki` (Supabase) y `mcp` (externo), páginas y revisiones, búsqueda, editor y editor visual, borrado con limpieza de links, permisos por carpeta y página (resumen de `lib/brain/README.md`, no copia), el brain servido por MCP a Claude/ChatGPT, import (`brain:import`), canon como fuente del ICP. Frontera `core`/`adapters` y el test de boundary. `sources`: `lib/brain/README.md`, `lib/brain/core/types.ts`, specs brain, 11, editor-brain, 17, 18, 21-3a; PR asignados.
- [ ] **Step 2 `workflows.md`:** cómo correr y escribir un workflow: `registry.ts`, `enqueue()`, ticks y dispatcher, `work_items` claims y produces, caps, piezas `pending`, política `auto`, `runs`, qué hace el schedule `dispatch`. Lo que ya está en `arquitectura/orquestacion.md` se enlaza, no se repite. `sources`: `lib/workflows/**`, `agents/outreach/schedules/dispatch.ts`, spec orquestación; PR #35, #37, #40, #45, #47.
- [ ] **Step 3:** Links, `docs:check`, commit.

### Task 18: Dominio: conectores, plataforma, invitaciones y usuarios, gmail

**Files:**
- Create: `docs/dominios/conectores.md`, `docs/dominios/plataforma.md`, `docs/dominios/invitaciones-y-usuarios.md`, `docs/dominios/gmail.md`

- [ ] **Step 1 `conectores.md`:** capacidades y `PROVIDERS`, Vercel Connect (api key y OAuth), `tenant_connections`, `connector_claims`, bindings y resolve, `executors`, `verify`, consola de conectores, página Conectar, qué ve el agente. `sources`: `lib/connectors/**`, `lib/connect/**`, specs 02, 19, 21-1, llaves-de-clientes; PR asignados.
- [ ] **Step 2 `plataforma.md`:** `/plataforma`, alta de empresas, landing por empresa, marca (`lib/brand`, bucket), settings del cliente, agentes por empresa, categorías del brain, `requirePlatformAdmin`. `sources`: `app/plataforma/**`, `lib/tenants/**`, specs consola-plataforma, alta-empresas-landing, 21-1, 21-2; PR asignados.
- [ ] **Step 3 `invitaciones-y-usuarios.md`:** invitaciones por dominio, roles, reenvío, bloqueo, `membership_blocks`, pantalla usuarios. `sources`: `lib/invitations/**`, `app/[tenant]/settings/usuarios`, specs 20-2, ingreso-por-dominio; PR #67, #68, #86, #80.
- [ ] **Step 4 `gmail.md`:** lectura y envío, MIME, firma del ejecutor, BCC a HubSpot, scopes, `send_email` y `read_replies`, por qué el token sale de Connect y no de Supabase. `sources`: `lib/gmail/**`, specs 00 y 02, PR #3, #20, #48, #50.
- [ ] **Step 5:** Links, `docs:check`, commit.

### Task 19: Guías de cómo hacer

**Files:**
- Create: `docs/guias/alta-de-tenant.md`, `docs/guias/migraciones-a-produccion.md`, `docs/guias/agregar-una-tool.md`, `docs/guias/agregar-un-nodo-o-workflow.md`, `docs/guias/agregar-un-conector.md`, `docs/guias/agregar-una-pantalla.md`, `docs/guias/correr-evals.md`
- Modify: `docs/guias/llaves-de-clientes.md`, `docs/guias/conectar-brain-por-mcp.md`, `docs/guias/conectar-agente-por-mcp.md` (frontmatter y `sources`, revisar vigencia contra el código)

- [ ] **Step 1:** Cada guía es una lista numerada de pasos con los comandos exactos y los archivos que se tocan, y termina con "Qué va a fallar si te olvidás de algo" (el test que lo detecta: `registry.test.ts`, `running-tool.test.ts`, `tests/docs`). `agregar-una-tool.md` incluye `TOOL_LABELS`, el `approval` por nivel, la etiqueta, y "documentar en `dominios/`". `agregar-un-nodo-o-workflow.md` sigue `arquitectura/orquestacion.md` y el registry. `agregar-un-conector.md` sigue `PROVIDERS` y `catalog`. `agregar-una-pantalla.md` cubre el guard por agente habilitado y el menú. `alta-de-tenant.md` resume el plan de la 21.4b en pasos repetibles sin nombrar al cliente.
- [ ] **Step 2:** Links, `docs:check`, commit.

### Task 20: Cobertura: cerrar lo que falta

- [ ] **Step 1:** `npm run docs:check`. Por cada superficie sin mención, decidir: va en una página existente (agregar la mención en el lugar que corresponde, no una lista al pie) o en `docs/_meta/cobertura.ts` con motivo (candidatos legítimos: rutas de `.well-known`, `/sin-acceso`, env vars de scripts de prueba como `EVE_EVAL_*`, variables leídas por `node_modules` que se colaron).
- [ ] **Step 2:** Llenar la columna `páginas` en `decisiones/README.md` y reemplazar todo `pendiente` en `decisiones/prs.md`.
- [ ] **Step 3:** `npm test` entero en verde. Commit `docs: cobertura completa de superficies, specs y PR`.

### Task 21: Diagramas

**Files:**
- Modify: `docs/arquitectura/vision-general.md`
- Modify o regenerate: `docs/diagramas/arquitectura.archify.json`, `docs/diagramas/arquitectura.html`

- [ ] **Step 1:** Abrir `arquitectura.archify.json` y compararlo con `vision-general.md`. Si quedó atrás (no tiene consola de plataforma, workflows, Connect), regenerarlo con el skill `archify` desde la descripción de `vision-general.md`. Si no se puede regenerar, dejar nota en `vision-general.md` de qué le falta.
- [ ] **Step 2:** En `vision-general.md`, sección "Diagrama": link al HTML, al JSON, y cómo regenerarlo. Commit.

### Task 22: Estados finales en decisiones

- [ ] **Step 1:** Pasar a `cerrada` cada spec cuya etapa el roadmap marca `[x]` y cuyas páginas ya existen. El test exige páginas: si falta alguna, es una página que hay que escribir, no una fila que hay que aflojar.
- [ ] **Step 2:** Agregar la fila de esta etapa (25) en `decisiones/README.md` como `en curso`, con spec y plan, y la sección `## Etapa 25 · Wiki de documentación y harness — [~]` en `docs/producto/roadmap.md` con el criterio de terminado de la spec §7.
- [ ] **Step 3:** Commit `docs: estados de las specs y etapa 25 en el roadmap`.

---

## Fase 4 · Verificación

### Task 23: Prueba del detector

- [ ] **Step 1:** En una rama descartable desde `docs/etapa-25-wiki` (`git checkout -b tmp/prueba-detector`): crear `agents/outreach/tools/dummy_tool.ts` (export vacío), `supabase/migrations/20991231000000_dummy.sql` con `create table public.dummy_things (id uuid primary key);`, y `app/[tenant]/dummy/page.tsx` (componente vacío). Correr `npm run docs:sync && npm run docs:check`.
- [ ] **Step 2:** Verificar que falla nombrando `dummy_tool`, `dummy_things` y `/[tenant]/dummy`, y que `running-tool.test.ts` también falla por la etiqueta. Copiar la salida (recortada) debajo de esta tarea en el plan, en la rama real.
- [ ] **Step 3:** Documentar las tres en una página, volver a correr, verificar verde. Borrar la rama: `git checkout docs/etapa-25-wiki && git branch -D tmp/prueba-detector`. Revertir cualquier archivo generado que haya quedado. Commit del plan con la evidencia.

### Task 24: Cierre con gstack

- [ ] **Step 1:** `npm run typecheck && npm test && npm run docs:check`. Todo verde.
- [ ] **Step 2:** `/docs-wiki` sobre esta misma rama: tiene que terminar sin nada que hacer, salvo la fila del PR de esta etapa (se deja con el número que asigne `gh pr create` en el paso siguiente).
- [ ] **Step 3:** `/ship`. Verificar en la salida: `VERSION` bumpeada (minor: `0.2.0`), entrada en `CHANGELOG.md`, `Documentation: updated` o `current`, PR creado. Si `/document-release` reporta `blocked`, leer el motivo y corregir en la wiki antes de reintentar; no shippear con riesgo de documentación.
- [ ] **Step 4:** Agregar la fila del PR a `decisiones/prs.md` y pushear al mismo PR.
- [ ] **Step 5:** Reporte final para Mati: páginas creadas, exclusiones con motivo, preguntas abiertas (`.codex/` al repo sí o no; CI con GitHub Actions habilitado en el repo), y lo que quedó `en curso`.

---

## Qué no hacer

- No borrar ni aflojar un test de `tests/docs` para que pase. Si una regla resulta demasiado estricta en la práctica, anotarlo en el reporte y que lo decida Mati.
- No inventar comportamiento: si no está en el código, en una spec o en un PR, no va a la wiki.
- No copiar specs enteras a páginas. La página explica lo vigente y enlaza la spec.
- No tocar `docs/superpowers/`.
