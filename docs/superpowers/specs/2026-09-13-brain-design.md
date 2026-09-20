---
title: Brain por tenant · capacidad con tools propias y wiki sobre Supabase
fecha: 2026-09-13
estado: implementada (ver §15)
fuente: docs/superpowers/specs/02-conexiones-innovas.md §2 D6, §6.2, §10 S5 y S6 (rama claude/jovial-gates-06e495, commits a5fd05b y 4fe6004) · docs/innovas-agents-kickoff.md §5 · repo ~/Sites/innovas/brains (commit ac62c39) · bóveda de Obsidian en el shared drive del brain de Innovas
reemplaza: el servicio innovas-brains-mcp en Railway como forma del brain
---

# Brain por tenant

## 1. Objetivo y criterio de cierre

Que cada tenant tenga un brain (su canon: ICP, mensajes, voz, hooks, cuentas curadas, producto) que el agente lee y propone actualizar con aprobación, y que el cliente pueda leer y editar. Dar de alta un brain tiene que ser configuración: ni código ni servidores por tenant. El brain de Innovas deja de vivir en la bóveda de Drive.

**Terminado cuando:**

1. Desde el chat en producción, en el tenant `innovas`, `brain_search` devuelve páginas migradas de la bóveda y `brain_read` devuelve su cuerpo.
2. `brain_upsert` pide aprobación siempre, solo la puede aprobar un `tenant_admin` o `platform_admin`, y deja revisión y evento.
3. Un tenant de prueba sin binding `brain` no expone ninguna tool `brain_*`.
4. El import de la bóveda de Innovas corre en dry-run sin errores bloqueantes, se aplica en producción, y una segunda corrida sin cambios no escribe nada.
5. `npm run db:test` en verde con los tests de aislamiento y append-only de §10.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| B1 | **El brain es una capacidad con tools propias del agente** (`brain_search`, `brain_read`, `brain_upsert`), no una conexión MCP | Mismo contrato en todos los tenants; la aprobación vive en código una sola vez y no depende del nombre de tool de cada proveedor; el proveedor propio no gasta token requests de Connect. Es el patrón de "tools contra la capacidad con adapters por proveedor" que la Etapa 2 ya prevé para CRM en la Etapa 3 |
| B2 | **Proveedores detrás de una interfaz**, elegidos por el binding de `tenant_connections`: `wiki` (se construye) y `mcp` (se diseña, no se construye) | Un wiki se da de alta con una fila. gbrain o un MCP a medida entran por configuración cuando un tenant lo pida |
| B3 | **El proveedor `wiki` guarda las páginas en Supabase**, con `tenant_id`, RLS y revisiones append-only | El cliente edita en la plataforma. Postgres ya está, con RLS probada. Sin Google OAuth ni verificación de scopes de Drive, sin schedules bloqueados por falta de usuario |
| B4 | **Railway y el repo `innovas/brains` salen del camino.** El repo se archiva sin desplegar | Nunca se desplegó. Mezclaba canon con primitivas de Google Workspace que la plataforma no usa (Gmail ya es `send_email`, D8 de la Etapa 2). Un segundo deploy y una llave propia no aportan nada frente a B1 y B3 |
| B5 | **Procedimientos del agente en skills estáticas; conocimiento del tenant en el brain** | Las skills van por función del agente (`agents/outreach/skills/`) y no necesitan sandbox. Lo propio de cada tenant es dato y lo edita el cliente. Se eliminan `sync-brain` y `tenants/<slug>/skills/` del kickoff. Las skills dinámicas de eve se descartan porque exigen sandbox |
| B6 | **Tags de canon fijos en el contrato**: `canon:icp`, `canon:mensajes`, `canon:voz`, `canon:hooks`, `canon:objeciones` | Una skill encuentra la página correcta con un filtro determinístico, sin depender del ranking de búsqueda. Son genéricos: no nombran a ningún tenant |
| B7 | **Sin memory slot** (se mantiene el motivo de D6 de la Etapa 2) | Un memory slot escribiría en el canon en cada turno sin aprobación |
| B8 | **Nunca se borran páginas: se archivan.** Ninguna tool ni pantalla borra | Regla vigente de la bóveda. La historia completa queda en `brain_revisions` |
| B9 | **Búsqueda full-text de Postgres.** La búsqueda híbrida con embeddings queda diseñada por tenant (§6.2) y no se construye | Alcanza para decenas de páginas. El problema de escala es de recall, no de velocidad, y se resuelve sin cambiar el contrato |
| B10 | **El editor del cliente va en la Etapa 4**, con el dashboard | La Etapa 2 cierra con tablas, tools e import. Mientras tanto Innovas edita con `brain_upsert` aprobado y re-importando desde la bóveda |

## 3. Contrato de las tools

Descripciones en español, escritas para el modelo.

| Tool | Entrada | Salida | Approval |
|---|---|---|---|
| `brain_search` | `query` (string, puede ir vacío si hay `category` o `tag`), `category?`, `tag?`, `includeArchived?` (default `false`), `limit?` (1 a 20, default 8) | `{ ok: true, results: [{ slug, title, category, status, tags, snippet, updatedAt }] }` | ninguna |
| `brain_read` | `slug` | `{ ok: true, page: { slug, title, category, status, tags, frontmatter, body, revision, updatedAt } }` | ninguna |
| `brain_upsert` | `slug`, `title`, `category`, `status`, `tags`, `body`, `reason`, `baseRevision?` | `{ ok: true, slug, revision }` | `always()`, respuesta limitada por rol |

Los errores del brain no se lanzan al modelo: vuelven como `{ ok: false, error, message }` con `suggestions` (`not_found`), `currentRevision` (`conflict`) o `fields` (`validation`). Un error que no es del brain (base caída) sí se lanza.

**Semántica de `brain_upsert`:**

- Sin `baseRevision`: solo crea. Si el slug existe, rechaza con conflicto. Así el agente nunca pisa una página que no leyó.
- Con `baseRevision`: solo actualiza, y solo si coincide con la `revision` vigente.
- `reason` es obligatorio y queda en la revisión.
- Archivar es un upsert con `status: "archivado"`.

**Validaciones** (en `upsertPage`, no en la tool, para que el editor de la Etapa 4 las herede):

- `slug`: `^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$`, hasta 200 caracteres.
- `category`: incluida en `config.categories` del binding.
- `status`: `activo`, `borrador` o `archivado`.
- `frontmatter`: tiene cada clave de `config.requiredFrontmatter` que no sea columna.
- `body`: hasta 200 KB.

**Aprobación:** `approval.request` es `always()`. `approval.response` acepta solo si el principal que aprueba tiene rol `tenant_admin` o `platform_admin` en el tenant de la sesión; si no, `{ status: "rejected", reason }` y el pedido queda pendiente. La forma exacta se verifica contra `node_modules/eve/docs/tools/human-in-the-loop.md` y sus tipos antes de escribirla.

## 4. Resolución y proveedores

### 4.1 Resolver

`agents/outreach/tools/brain.ts`: un `defineDynamic` sobre `session.started` que devuelve un mapa `{ brain_search, brain_read, brain_upsert }` o `null`.

1. `tenantId` sale de `ctx.session.auth.initiator ?? ctx.session.auth.current`, igual que el resolver de conexiones.
2. Lee el binding `brain` habilitado del tenant con el lector de bindings de la Etapa 2 (`lib/connectors/bindings.ts`).
3. Sin binding, o con un `provider` que no esté construido: devuelve `null` (con `console.warn` en el segundo caso).
4. Con binding: devuelve las tres tools. El closure lleva solo valores serializables: `tenantId`, `bindingId`, `provider`, `connectorUid` y `config`.
5. Falla de la consulta: tira error y la sesión no arranca.

Cada `execute` obtiene el proveedor con `getBrainProvider(binding)` y delega.

### 4.2 Interfaz

`lib/brain/types.ts`:

```ts
type BrainPageSummary = {
  slug: string; title: string; category: string; status: BrainStatus;
  tags: string[]; snippet: string; updatedAt: string;
};

type BrainPage = Omit<BrainPageSummary, "snippet"> & {
  frontmatter: Record<string, unknown>; body: string; revision: number;
};

type BrainWrite = {
  slug: string; title: string; category: string; status: BrainStatus;
  tags: string[]; frontmatter?: Record<string, unknown>; body: string;
  reason: string; baseRevision?: number;
};

type BrainAuthor =
  | { kind: "agent"; userId: string | null; sessionId: string }
  | { kind: "user"; userId: string }
  | { kind: "import"; userId: string | null; sourcePath: string; sourceHash: string };

interface BrainProvider {
  search(input: { query: string; category?: string; tag?: string; includeArchived?: boolean; limit?: number }): Promise<BrainPageSummary[]>;
  read(slug: string): Promise<BrainPage | null>;
  upsert(write: BrainWrite, author: BrainAuthor): Promise<{ slug: string; revision: number }>;
}
```

Errores tipados en `lib/brain/errors.ts`: `BrainNotFound` (con `suggestions`), `BrainConflict` (con `currentRevision`), `BrainValidation` (con `fields`), `BrainForbidden`.

### 4.3 Proveedor `wiki`

`lib/brain/wiki.ts`, con el cliente admin y siempre filtrando por `tenantId` del closure.

**Configuración del binding** (`tenant_connections.config`, sin secretos):

```json
{
  "categories": ["company", "producto", "comercial", "proyectos", "marketing", "operacion"],
  "requiredFrontmatter": ["title", "category", "status", "updated"],
  "search": "fts"
}
```

`search` admite solo `fts` hasta que exista §6.2. `updated` se completa solo con la fecha de escritura si no viene.

### 4.4 Proveedor `mcp` (diseñado, no se construye)

- Binding con `connector_uid` (conector `api-key` de Connect, D3 de la Etapa 2) y `config`:
  ```json
  {
    "url": "https://brain.cliente.test/mcp",
    "auth": { "scheme": "bearer" },
    "tools": { "search": "search", "read": "get_page", "upsert": "put" }
  }
  ```
- El adapter llama al MCP remoto con la llave de `lib/connectors/auth.ts` y traduce entradas y salidas al contrato de §3. La traducción es propia de cada servidor y se escribe cuando aparezca el primer tenant.
- La aprobación sigue siendo la de `brain_upsert`: el servidor remoto no la decide.
- Solo HTTP: eve y Connect no hablan con procesos stdio (lección de ColdIQ en la Etapa 2). gbrain tiene que estar publicado como MCP remoto.

## 5. Modelo de datos

Antes de escribir SQL: cargar `supabase-postgres-best-practices`. Helpers de RLS envueltos en `(select ...)`. Revocar explícito `from anon`.

### 5.1 `connector_capability`

Ya incluye `brain` (Etapa 2, §3.1). El catálogo suma el proveedor `wiki` con `kind: "tool"`, sin `build`: el resolver de conexiones lo ignora y lo consume el resolver de §4.1.

### 5.2 `brain_pages`

La versión vigente de cada página.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `tenant_id` | uuid not null → `tenants` on delete cascade | |
| `slug` | text not null | `check` con la expresión de §3 |
| `title` | text not null | |
| `category` | text not null | Validada en código contra el binding |
| `status` | `brain_page_status` not null default `'activo'` | Enum `activo`, `borrador`, `archivado` |
| `tags` | text[] not null default `'{}'` | |
| `frontmatter` | jsonb not null default `'{}'` | Claves no mapeadas a columnas |
| `body` | text not null | `check (octet_length(body) <= 204800)` |
| `revision` | integer not null default 1 | |
| `search` | tsvector generado | `setweight(to_tsvector('spanish', f_unaccent(title)), 'A') \|\| setweight(to_tsvector('spanish', f_unaccent(body)), 'B')` |
| `source_path` | text | Ruta de origen del import. Nula para páginas nacidas en la plataforma |
| `source_hash` | text | sha256 del archivo en el último import |
| `source_revision` | integer | `revision` que dejó el último import |
| `created_at`, `updated_at` | timestamptz not null default `now()` | |
| `updated_by` | uuid → `auth.users` on delete set null | |

- Único `(tenant_id, slug)`.
- Índices: GIN sobre `search`; GIN sobre `tags`; `(tenant_id, category, status)`.
- `f_unaccent`: wrapper `immutable` de `unaccent` con el diccionario calificado, necesario para usarlo en una columna generada. Así "decision" encuentra "decisión".

### 5.3 `brain_revisions`

Historial append-only.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity pk | |
| `tenant_id` | uuid not null → `tenants` on delete cascade | |
| `page_id` | uuid not null → `brain_pages` on delete cascade | |
| `revision` | integer not null | Único `(page_id, revision)` |
| `title`, `category`, `status`, `tags`, `frontmatter`, `body` | copia de la página | |
| `author_kind` | `brain_author_kind` not null | Enum `user`, `agent`, `import` |
| `author_user_id` | uuid → `auth.users` on delete set null | En `agent`, el usuario que inició la sesión |
| `approved_by_user_id` | uuid → `auth.users` on delete set null | Quién aprobó el upsert del agente. **Queda nulo en esta versión:** en eve 0.54.2 el `responder` solo llega a la política `approval.response`, no a `execute`, y la política puede correr más de una vez, así que no es lugar para escribir. La columna queda para cuando eve lo exponga |
| `session_id` | text | Sesión de eve en `agent` |
| `reason` | text not null | |
| `created_at` | timestamptz not null default `now()` | |

- Índice `(tenant_id, page_id, revision desc)`.
- Append-only con el mismo mecanismo que `events`: `revoke insert, update, delete, truncate` a `authenticated` y `anon`, sin trigger, para que el borrado en cascada de un tenant siga funcionando. El único código que escribe es `brain_upsert_page` (§5.4), que solo inserta revisiones.

### 5.4 Escritura atómica

Una función `public.brain_upsert_page(...)` en SQL, con `execute` revocado a `anon` y `authenticated` y otorgado a `service_role`. En una transacción:

1. `select ... for update` de la página por `(tenant_id, slug)`.
2. Aplica la semántica de `baseRevision` de §3 y levanta `BRAIN_CONFLICT` con la revisión vigente.
3. Inserta o actualiza `brain_pages`, incrementando `revision`.
4. Inserta la fila de `brain_revisions`.
5. Inserta en `events` el tipo `brain.page_upserted` con `payload` `{ slug, revision, author_kind, binding_id, reason }` y `actor_user_id` del autor.

`lib/brain/wiki.ts#upsertPage` valida lo que depende del binding (categorías, frontmatter requerido), llama a la función y traduce los errores a los tipos de §4.2. Es el único camino de escritura: lo usan la tool, el import y el editor de la Etapa 4.

### 5.5 RLS y grants

- `brain_pages` y `brain_revisions`: `select` para `is_member_of(tenant_id)` o `is_platform_admin()`.
- Ninguna política de escritura. `revoke insert, update, delete` a `authenticated` y `anon`.
- `select` directo desde el cliente queda disponible para las pantallas de la Etapa 4. El agente y el import leen con el cliente admin filtrando por `tenant_id`.

## 6. Búsqueda

### 6.1 Full-text (se construye)

- `websearch_to_tsquery('spanish', f_unaccent(query))` contra `search`, filtrado por `tenant_id`, `category`, `tag` (`tags @> array[tag]`) y `status <> 'archivado'` salvo `includeArchived`.
- Orden por `ts_rank_cd`; `snippet` con `ts_headline` sobre `body`, 30 palabras como máximo.
- Si la consulta no produce términos (solo stopwords), ordena por `updated_at desc` dentro de los filtros.
- Consulta en una función SQL `public.brain_search_pages(...)` con los mismos grants que §5.4.

### 6.2 Híbrida por tenant (diseñada, no se construye)

- `brain_chunks`: fragmentos de cada página con `embedding vector(<dim>)`, `tenant_id` y RLS; índice HNSW, siempre filtrado por tenant.
- `upsertPage` encola el recálculo de los fragmentos de la página; embeddings por AI Gateway.
- `brain_search` fusiona el ranking full-text con el vectorial (reciprocal rank fusion), para no perder coincidencias exactas de nombres propios.
- Se activa por tenant con `config.search = "hybrid"` y `npm run brain:embed -- --tenant <slug>` para el backfill.
- Señales para activarla: búsquedas del agente que no encuentran páginas existentes, más de unas 150 páginas o páginas largas, vocabulario muy variable. Se decide con un eval de 20 a 30 consultas reales del tenant, midiendo si la página correcta aparece entre los primeros cinco resultados.

## 7. Canon en el agente

- Las skills estáticas de `agents/outreach/skills/` describen el procedimiento y dicen qué leer: "antes de redactar, `brain_search` con `tag: canon:icp` y `tag: canon:mensajes`, y `brain_read` de cada resultado".
- Si el agente no tiene tools `brain_*`, la skill indica avisar que falta el canon del tenant y no inventarlo.
- El canon de outreach de la bóveda (constitución, motor, canales, redacción, vectores, atribución) se importa entero como páginas. En la Etapa 3 lo genérico pasa a skills estáticas e instrucciones del agente; lo propio de Innovas queda en el brain con sus tags de canon.

## 8. Editor del cliente (Etapa 4)

Queda especificado acá para que la Etapa 4 no lo rediseñe.

- `/[tenant]/brain`: páginas por categoría, búsqueda con `brain_search_pages` llamada desde el servidor después de verificar membresía, filtro por estado y panel de wikilinks rotos.
- `/[tenant]/brain/[...slug]`: página renderizada con wikilinks navegables.
- `/[tenant]/brain/[...slug]/editar`: título, categoría, estado, tags y cuerpo en markdown con vista previa. Los campos extra del frontmatter se conservan.
- `/[tenant]/brain/[...slug]/historial`: revisiones con autor, motivo y diff; restaurar escribe una revisión nueva.
- Guardar llama a `upsertPage` con `baseRevision`. Ante conflicto se muestra el aviso y se conserva el texto del usuario.
- Leen todos los miembros; editan `tenant_admin` y `platform_admin`.
- shadcn con la marca del tenant.
- Diff contra la versión vigente dentro de la tarjeta de aprobación del chat: con la pantalla de aprobaciones de la Etapa 4.

## 9. Migración de la bóveda de Innovas

### 9.1 Script

`scripts/brain-import.mts --tenant <slug> --from <carpeta> [--apply]`. Genérico para cualquier tenant con una carpeta de markdown.

- Lee una carpeta local. Para Innovas, la bóveda de Obsidian sincronizada desde el shared drive. La plataforma no usa la API de Google.
- Por defecto hace dry-run y escribe un reporte; solo escribe en la base con `--apply`. Lo corre el usuario con la service role de su `.env.local`.
- Requiere un binding `brain` con `provider: "wiki"` para el tenant. Sin binding, se detiene.
- Escribe siempre por `upsertPage` con `author_kind: "import"`.

### 9.2 Manifiesto

`tenants/<slug>/brain-import.json`: globs de inclusión y exclusión, más tags de canon por ruta. Es dato del tenant, no código.

Para Innovas:

**Incluye:** `company/**`, `producto/**`, `proyectos/**`, `marketing/**` y `comercial/**` (páginas sueltas, `cuenta-*`, y de `comercial/outreach/` el `GUIA-EJECUTOR`, las páginas L1 a L3 y `voz/`).

**Excluye:**

| Ruta | Destino |
|---|---|
| `.obsidian/**`, `index.md`, `log.md`, `Sin título.base` | El índice y el log salen de consultas |
| `log/**` | Historia previa: queda en Drive como archivo |
| `AGENT.md`, `AGENTS.md`, `COLABORAR.md`, `INSTRUCCIONES-PROYECTO.md`, `operacion/roles-brain.md`, `operacion/identidad-verificada.md`, `operacion/mantenimiento-vault.md`, `operacion/setup-mcp-innov.md`, `operacion/plugin-outreach/**` | Contrato de operación de la bóveda y del plugin, reemplazado por la plataforma |
| `comercial/outreach/runs/**`, `comercial/outreach/colas/**` | Estado: tablas de la Etapa 3 |
| `comercial/outreach/scripts/**` | Código: Etapa 3 |
| Todo lo que no sea `.md` | Binarios y artefactos quedan en Drive; las páginas pueden enlazarlos |

**Página nueva:** las convenciones de contenido de `BRAIN.md` (sin em dash, sin signos de apertura, redacción en afirmativo) se importan como `marketing/reglas-de-escritura`, con tag `canon:voz`. El resto de `BRAIN.md` se reemplaza por la configuración del binding y este documento.

**Tags de canon iniciales:** los fija el manifiesto por ruta (por ejemplo `comercial/criterios-calificacion-en-paralelo` con `canon:icp`, `marketing/mensajes-*` con `canon:mensajes`, `comercial/outreach/voz/**` con `canon:voz`). La asignación exacta se revisa con el reporte del dry-run.

### 9.3 Transformaciones

- **Slug:** ruta relativa sin `.md`, en minúsculas, sin acentos, con espacios, guiones largos y signos convertidos a `-`, y guiones repetidos colapsados. `marketing/LinkedIn institucional — INNOV.AS.md` pasa a `marketing/linkedin-institucional-innov-as`. Dos archivos que colapsan al mismo slug son error bloqueante.
- **Frontmatter:** `title`, `category`, `status`, `tags` y `updated` pasan a columnas (con esas claves reales de la bóveda); el resto a `frontmatter`. Sin `title`, se usa el primer `#` del cuerpo. Sin `category`, se usa la carpeta de primer nivel. Una `category` que no coincide con la carpeta o no está en el binding es error bloqueante. Sin `status`, `activo`.
- **Wikilinks:** `[[nombre]]` y `[[ruta|alias]]` se resuelven contra los slugs importados (por slug completo o por último segmento si es único) y se reescriben como `[[slug-canónico|alias]]`, conservando el texto visible. Los que no resuelven se dejan como están y se listan en el reporte.
- **Cuerpo:** sin otros cambios.

### 9.4 Idempotencia

- Página nueva: se crea con `source_path`, `source_hash` y `source_revision`.
- Página existente con el mismo `source_hash`: no se escribe.
- Hash distinto y `revision = source_revision` (nadie la editó en la plataforma): se actualiza.
- Hash distinto y `revision <> source_revision`: se saltea y se reporta como editada en la plataforma. `--force <slug>` la pisa, dejando revisión.
- Una página que desaparece de la carpeta no se toca: B8.

### 9.5 Reporte

Por página: acción (`crear`, `actualizar`, `sin cambios`, `salteada`, `error`), slug, ruta de origen, tags de canon. Al final: wikilinks sin resolver, errores bloqueantes y excluidos. Con errores bloqueantes, `--apply` no escribe nada.

### 9.6 Corte

1. Binding `wiki` para `innovas` (§11).
2. Dry-run local contra la base local; revisar reporte y tags de canon.
3. `--apply` en producción (lo corre el usuario).
4. Verificar criterio de cierre 1 desde el chat.
5. Aviso al inicio de `BRAIN.md` en Drive: el canon vive en la plataforma. Lo escribe el usuario.
6. Hasta la Etapa 4, los cambios humanos se hacen en la bóveda y se re-importan; las páginas que el agente modificó se saltean (§9.4).
7. Drive queda como archivo. No se borra nada.

## 10. Tests

**pgTAP** (`supabase/tests/08_brain_tables.test.sql`, `09_brain_upsert.test.sql` y `10_brain_search.test.sql`, después del `06_tenant_connections` de la Etapa 2):
- Un miembro de A no ve páginas ni revisiones de B.
- `authenticated` y `anon` no pueden insertar, actualizar, borrar ni truncar en `brain_pages` ni `brain_revisions`, ni ejecutar `brain_upsert_page` ni `brain_search_pages` (42501).
- Actualizar una página deja intacta la fila de la revisión anterior.
- `brain_upsert_page`: crea con revisión 1, actualiza con `baseRevision` correcta, levanta conflicto con incorrecta o faltante sobre una página existente, deja revisión y evento.
- `brain_search_pages`: encuentra con y sin acentos, filtra por tag y categoría, excluye archivadas por defecto, nunca devuelve páginas de otro tenant.

**vitest, sin red:**
- Resolver: sin `tenantId` devuelve `null`; sin binding devuelve `null`; proveedor no construido devuelve `null` con aviso; con binding `wiki` devuelve las tres tools; error de consulta propaga.
- `upsertPage`: rechaza categoría fuera del binding, frontmatter incompleto, slug inválido y cuerpo excedido; traduce los errores de la función SQL.
- Approval de `brain_upsert`: pide aprobación siempre; la respuesta de un `tenant_member` se rechaza y la de un `tenant_admin` se acepta.
- `brain_read` de un slug inexistente devuelve sugerencias.
- Import con una bóveda de fixture en `tests/fixtures/brain-vault/`: slugs y colisiones, frontmatter y categoría por carpeta, reescritura de wikilinks y no resueltos, exclusiones y tags del manifiesto, las cuatro ramas de §9.4, y que con error bloqueante `--apply` no escribe.

## 11. Operación

**Alta de un wiki para un tenant:**

```bash
npm run connections:bind -- --tenant <slug> --capability brain --provider wiki --config @tenants/<slug>/brain.json
```

`tenants/<slug>/brain.json` lleva la configuración de §4.3. `scripts/connections-bind.mts` suma el soporte de `--config` y valida la forma de la configuración de cada proveedor contra el catálogo. Sin `connector_uid`: el proveedor `wiki` no usa llave.

**Import:**

```bash
npm run brain:import -- --tenant <slug> --from "<carpeta>"
```

```bash
npm run brain:import -- --tenant <slug> --from "<carpeta>" --apply
```

## 12. Enmiendas

### 12.1 Spec de la Etapa 2 (`docs/superpowers/specs/02-conexiones-innovas.md`)

Se aplican en la rama que tiene el resultado del spike (`claude/jovial-gates-06e495`), no en esta.

- **D6** pasa a: "**Brain como capacidad con tools propias**, sin memory slot. Un memory slot escribiría en el canon del cliente en cada turno sin aprobación. Diseño en `2026-09-13-brain-design.md`".
- **§1 criterio 1:** `brain__brain_search` pasa a `brain_search`.
- **§3.2:** el ejemplo de proveedores cambia `innovas-brains` por `wiki`.
- **§6.2** se reemplaza completa por: "`brain` · `wiki`. Entrada de catálogo `kind: "tool"`, sin `build` ni `connector_uid`. Las tools `brain_search`, `brain_read` y `brain_upsert` (esta última con `always()`) las resuelve `agents/outreach/tools/brain.ts` según el binding. Contrato, datos, import y tests en `2026-09-13-brain-design.md`". Se quita el aviso "En suspenso".
- **§9.1:** el ejemplo de alta de `api-key` pasa a usar ColdIQ; el brain se da de alta como en §11 de este documento.
- **§10 S5 y S6:** S5 queda cerrada por la prueba con ColdIQ y deja de depender del brain. S6 queda cerrada con el procedimiento del dashboard.

### 12.2 Plan de la Etapa 2 (`docs/superpowers/plans/02-conexiones-innovas.md`)

- **Task 5B** se reescribe como "Brain `wiki`": catálogo, migración y pgTAP de §5, funciones de §5.4 y §6.1, `lib/brain/*`, resolver y tools de §4.1, soporte de `--config` en `connections-bind`, y tests de §10. Se puede partir en varias tasks.
- Se suma una task "Import de la bóveda": script, manifiesto de Innovas y fixture de §9 y §10.
- Criterio de cierre 1 del plan, igual que §12.1.

### 12.3 Kickoff y roadmap

- Kickoff §2 (fila Brain): pasa a "capacidad `brain` con proveedor `wiki` sobre Supabase; `mcp` para gbrain u otros".
- Kickoff §5 punto 5: se reemplaza por B5. Se eliminan `scripts/sync-brain`, `tenants/<slug>/skills/` y `sync-brain` en CI (roadmap Etapa 5).
- Kickoff estructura del repo: `connections/brain.ts` pasa a `tools/brain.ts`; `skills/` del tenant se elimina.
- Roadmap Etapa 2: "`connections/brain.ts` con la key del tenant" pasa a "brain `wiki` (spec 2026-09-13)".
- Roadmap Etapa 3: "`tenants/innovas/skills/` vía `sync-brain`" pasa a "skills estáticas de outreach en `agents/outreach/skills/` y tags de canon en el brain de Innovas".
- Roadmap Etapa 4: suma el editor de §8.
- Kickoff activos existentes: `~/Sites/innovas/brains` pasa a archivado, no se despliega.

## 13. Fuera de alcance

- Proveedor `mcp` construido. Planificado en la Etapa 11 del roadmap, junto con servir este brain como MCP a las herramientas del cliente.
- Búsqueda híbrida y `brain_chunks`. Anotada en la Etapa 11 como "cuando haga falta", con la señal para prenderla.
- Editor del cliente (Etapa 4).
- Adjuntos y binarios en el brain.
- Borrado de páginas.
- Reglas por carpeta en cascada de la bóveda (`00-REGLAS.md`): el frontmatter requerido es uno por tenant.
- Sincronización continua con Drive: el import es manual y temporal.
- Primitivas de Google Workspace (`drive_*`, `gmail_search`, `gmail_draft`, `calendar_events`).

## 14. Riesgos y verificaciones

- **API de eve:** verificado en eve 0.54.2 que `approval` acepta `{ request, response }` y que `response` recibe `responder` con los `attributes` del canal (`tenantId`, `role`). `execute` no recibe quién aprobó: `approved_by_user_id` queda nulo (§5.3). Cualquier otro desvío que aparezca al implementar se anota acá.
- **`unaccent` en columna generada:** requiere el wrapper `immutable` con el diccionario calificado. Si Supabase no permite la extensión en el esquema elegido, se busca sin quitar acentos y se anota.
- **Tags de canon mal asignados:** la skill no encuentra el ICP. Se mitiga revisando el dry-run y con un test manual por tag desde el chat.
- **Re-import durante la transición:** una página editada por el agente y luego en Drive queda salteada. El reporte lo muestra y se resuelve con `--force` o a mano.
- **Sesiones largas con canon viejo:** una sesión que ya leyó una página no ve cambios posteriores hasta volver a leerla. Aceptable para canon.

## 15. Resultado de la verificación

**Implementada y en producción.** El plan `docs/superpowers/plans/2026-09-13-brain.md` se ejecutó en la rama de la Etapa 2 y entró a `main` por el PR #2 (`worktree-brain-por-tenant`). Están las tres migraciones (`brain_tables`, `brain_upsert_page`, `brain_search_pages`), sus tests pgTAP, `lib/brain/`, las tools en `agents/outreach/tools/brain.ts`, el script de import y la configuración de Innovas en `tenants/innovas/`.

**Verificado el 2026-09-14** contra el deploy de producción, dentro de la verificación de cierre de la Etapa 2 (`docs/01-roadmap-etapas.md`, Etapa 2):

- `brain_search` respondió con el ICP de Innovas desde el chat, así que la bóveda quedó importada (criterio 1 de §1).
- Un tenant de prueba sin bindings no expuso ninguna tool (criterio 3 de §1).

**Uso posterior:** la Etapa 3 lee del brain el canon, la voz y los vetos del tenant en `lib/outreach/canon.ts` y las reglas del gate de estilo.

**Desvío registrado:** `approved_by_user_id` queda nulo (§5.3 y §14). En eve 0.54.2 el `responder` solo llega a la política `approval.response`, no a `execute`.

**Falta completar acá**, con una consulta a producción, el detalle del import: páginas por categoría, tags de canon asignados y wikilinks sin resolver que quedaron.

```sql
select category, status, count(*) from public.brain_pages
where tenant_id = (select id from public.tenants where slug = 'innovas')
group by category, status order by category;

select tag, count(*) from public.brain_pages, unnest(tags) as tag
where tenant_id = (select id from public.tenants where slug = 'innovas')
  and tag like 'canon:%'
group by tag order by tag;
```

**Pendientes de la spec, planificados:** el editor del cliente (§8) en la Etapa 4; el proveedor `mcp` (§4.4) y servir este brain como MCP a las herramientas del cliente, en la Etapa 11; la búsqueda híbrida (§6.2), anotada en la Etapa 11 como "cuando haga falta".
