# Etapa 24.6 · Subir una skill desde un zip — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir un zip de skill en un paso a una carpeta de `skills/` (nueva o actualización), con vista previa, por la web y por MCP, y arrastrar archivos sueltos al panel de una skill.

**Architecture:** Un servicio puro en `lib/brain/core/skills/upload.ts` recibe las entradas ya descomprimidas del zip y el destino, y expone `previewSkillUpload` y `commitSkillUpload` (reusa `planImport` e `importSkillPackage`). La web lo llama desde una ruta nueva que recibe el zip en el pedido (≤ 4 MB); MCP lo llama desde dos tools que leen el zip de un objeto de preparación en Storage subido con un link firmado. Todo escribe el borrador; publicar sigue en la web.

**Tech Stack:** Next.js (App Router), TypeScript, Vitest, Supabase Storage (bucket `skill-packages`), MCP SDK (`registerTool` + zod), Biome.

**Spec:** `docs/superpowers/specs/2026-10-20-etapa-24-6-subir-skills-desde-zip-design.md` (leer entera antes de empezar; manda ante cualquier duda de este plan).

**Prerrequisito:** el PR [#122](https://github.com/innovasbuild/agents/pull/122) (`creatableSkillFolders`) mergeado en `main`. La Tarea 7 lo extiende. Trabajar en un worktree nuevo `feat/etapa-24-6-subir-skills` desde `main` actualizado (superpowers:using-git-worktrees). La spec, este plan y la fila 24.6 del roadmap están sin commitear en el checkout principal: la Tarea 0 los lleva.

## Global Constraints

- Topes: zip **4 MB** (`MAX_ZIP_BYTES = 4_194_304`); contenido sin cambios: 50 archivos, 4 MB por archivo, 20 MB descomprimido; `name` hasta 64 caracteres, `description` hasta 1024.
- **Todo va al borrador.** Nada de lo nuevo publica, retira ni crea versión publicada.
- Permiso: **crear** una skill nueva exige `administrador` sobre la carpeta destino (o la empresa); **reemplazar** una existente exige `editor` de esa skill. Quien no puede recibe `not_found` («No encontrado.»), igual que ante una carpeta inexistente.
- El destino lo elige la persona: del `SKILL.md` sale solo el `name`. La vista previa exige un `name` válido en los dos caminos (carpeta y panel de una skill).
- Español rioplatense en UI, mensajes y descripciones de tools; código e identificadores en inglés.
- `lib/brain/core/**` no importa `adapters`, `next/*` ni `@supabase/*` (lo vigila `tests/brain/boundary.test.ts`). `node:zlib` y Storage viven en `lib/brain/adapters/`.
- El tenant y la persona llegan del caller (nunca del cuerpo del pedido). `events` es append-only: solo insert.
- Sin migración. Límite del limitador por MCP: `skill_upload_link` y `skill_import` con `confirm` cuentan como `write`; `skill_import` sin `confirm`, como `read`.
- Verificar con `npm run typecheck`, `npm test -- <archivo>` y `npx biome check <archivos>`. **No** correr `npm run lint:fix` (reformatea archivos ajenos).
- Commits con prefijo `feat:` / `docs:` y la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Entradas que la spec implica y que ninguna tarea cubre por defecto; cada una tiene su test en la tarea que dice:

1. Un `name` de `SKILL.md` ausente, con mayúsculas, con `/`, `..` o de 65 caracteres: es un problema de la vista previa y no escribe nada (Tareas 1 y 3).
2. Avisar de un duplicado de nombre en otra carpeta **sin revelar** skills que la persona no ve (Tarea 3).
3. Un zip inválido no deja una página vacía (`save` no se llama), y una carrera que crea el mismo slug responde `conflict`, no 500 (Tarea 3).
4. `uploadId` ajeno, vencido, de un objeto que no existe, de más de 4 MB o que no es un zip: error claro y el objeto no se importa (Tarea 7).
5. Subir el mismo zip dos veces es un reemplazo idempotente: mismos archivos, sin duplicados (Tarea 3).

---

### Task 0: Rama y documentos

**Files:**
- Create (commit): `docs/superpowers/specs/2026-10-20-etapa-24-6-subir-skills-desde-zip-design.md`, este plan, y la fila 24.6 en `docs/producto/roadmap.md`.

- [ ] **Step 1:** Con #122 mergeado, crear el worktree `feat/etapa-24-6-subir-skills` desde `origin/main` y copiar ahí los tres archivos sin commitear del checkout principal (no `git stash` entre worktrees).
- [ ] **Step 2:** `git add` de esos tres archivos y commit `docs: diseño y plan de la etapa 24.6`.

---

### Task 1: Reglas del paquete — `name` obligatorio y tope del zip

**Files:**
- Modify: `lib/brain/core/skills/package.ts`, `lib/brain/core/skills/files.ts` (`ParsedSkillMd`, `parseSkillMd`, `planImport`), `lib/brain/core/skills/draft.ts` (`create` usa los helpers nuevos)
- Test: `tests/brain/skills-package.test.ts`, `tests/brain/skills-files.test.ts`, `tests/brain/skills-draft.test.ts`

**Interfaces:**
- Produces (package.ts):
  - `export const MAX_ZIP_BYTES: number` (= `MAX_FILE_BYTES`)
  - `export function isValidSkillName(name: string): boolean` — 1 a 64 caracteres, `/^[a-z0-9]+(-[a-z0-9]+)*$/`
  - `export function normalizeSkillFolder(raw: string | undefined): string` — recorta espacios y `/` de los extremos y descarta un `skills/` inicial; `""` es directo bajo `skills/`
  - `export function isValidSkillFolder(folder: string): boolean` — `""` o tramos de `isValidSkillName` separados por `/`
- Produces (files.ts): `ParsedSkillMd` suma `name: string` (`""` si falta). `planImport` suma los problemas `"SKILL.md no trae name."` y `"El name de SKILL.md no es válido: usá minúsculas, dígitos y guiones, hasta 64 caracteres."`, y **reúne todos los problemas de `SKILL.md` en vez de cortar en el primero**.

- [ ] **Step 1: Tests que fallan.** En `skills-package.test.ts`: `isValidSkillName` acepta `facturacion` y `a-1`, rechaza `""`, `Ventas`, `a b`, `a/b`, `..`, `-a`, `a--b` y 65 caracteres; `normalizeSkillFolder("/skills/ventas/")` → `"ventas"`, `("skills")` → `""`, `(undefined)` → `""`; `isValidSkillFolder("ventas/q1")` true, `("Ventas")` false. En `skills-files.test.ts`: `parseSkillMd(SKILL_MD).name === "facturacion"`; `planImport` de un `SKILL.md` sin `name` y sin `description` devuelve `ok:false` con **ambos** problemas; con `name: "Ventas Uno"` devuelve el problema de nombre inválido.
- [ ] **Step 2:** `npm test -- tests/brain/skills-package.test.ts tests/brain/skills-files.test.ts` → FAIL (funciones o campo inexistentes).
- [ ] **Step 3:** Implementar en `package.ts` y `files.ts`. En `draft.ts`, `create` reemplaza su normalización de carpeta y su chequeo de nombre por los helpers (misma conducta, sin cambiar mensajes).
- [ ] **Step 4:** `npm test -- tests/brain/skills-package.test.ts tests/brain/skills-files.test.ts tests/brain/skills-draft.test.ts tests/brain/skills-zip.test.ts` → PASS. Si algún test existente arma un `SKILL.md` sin `name`, agregarle `name`.
- [ ] **Step 5:** `npm run typecheck`, `npx biome check` de los archivos tocados, y commit `feat: name obligatorio al importar una skill y tope de 4 MB para el zip`.

---

### Task 2: Zip sin excepciones para el llamador

**Files:**
- Modify: `lib/brain/adapters/skill-zip.ts`
- Test: `tests/brain/skills-zip.test.ts`

**Interfaces:**
- Produces: `export function unzipOrProblem(zip: Uint8Array): PackageEntry[] | { error: string }` — llama a `unzipPackage`; si lanza `ZipRejected` devuelve `{ error: e.message }`; otro error se propaga.
- Además: `unzipPackage` rechaza (con `ZipRejected(TOO_BIG)`) un `zip.length > MAX_ZIP_BYTES` antes de leer nada.

- [ ] **Step 1: Tests que fallan.** `unzipOrProblem` de bytes basura devuelve `{ error: "El archivo no es un zip válido." }`; de un zip válido (armado con `zipPackage`) devuelve las entradas; de un `Uint8Array` de `MAX_ZIP_BYTES + 1` devuelve `{ error }` con el texto del tope y **no** intenta leer el directorio central.
- [ ] **Step 2:** `npm test -- tests/brain/skills-zip.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. El texto de `TOO_BIG` hoy habla de 50 archivos, 4 MB por archivo y 20 MB: sumar una constante `ZIP_TOO_BIG = "El zip supera los 4 MB."` para el caso del tamaño del zip.
- [ ] **Step 4:** el test completo del archivo pasa; typecheck; biome; commit `feat: unzipOrProblem y tope de 4 MB al leer un zip`.

---

### Task 3: Servicio de subida (vista previa y confirmación)

**Files:**
- Modify: `lib/brain/core/skills/files.ts` (extraer `skillAccess` de `context`, sin cambiar conducta)
- Create: `lib/brain/core/skills/upload.ts`
- Test: `tests/brain/skills-upload.test.ts` (reusar el armado `setup()` de `tests/brain/skills-files.test.ts`: copiarlo a un helper `tests/brain/skills-fixtures.ts` y que ambos lo importen)

**Interfaces:**
- Consumes: `planImport`, `importSkillPackage`, `PackageEntry`, `FilesDeps` (files.ts); `isValidSkillFolder`, `isSkillSlug`, `skillName`, `SKILLS_PREFIX`, `SKILL_CATEGORY` (package.ts); `MAX_SLUG_LENGTH` (types.ts).
- Produces (files.ts): `export async function skillAccess(tenantSlug: string, deps: FilesDeps): Promise<{ ok: true; actor: SkillActor; levelOf(path: string): Level | null } | SkillFailure>` — persona, proveedor `wiki`, reglas (un administrador de la empresa no carga reglas). `context` pasa a usarla.
- Produces (upload.ts):
  ```ts
  export type UploadTarget =
    | { kind: "folder"; folder: string }   // relativa a skills/, "" = directo bajo skills/
    | { kind: "skill"; slug: string };
  export interface UploadPreview {
    ok: true; mode: "crear" | "reemplazar"; slug: string; name: string;
    description: string; files: { path: string; size: number }[];
    totalBytes: number; warnings: string[];
  }
  export type UploadFailure = SkillFailure & { problems?: string[] };
  export interface UploadResult {
    ok: true; mode: "crear" | "reemplazar"; slug: string; name: string;
    files: number; revision: number;
  }
  // Vive en el núcleo porque lo usan la ruta web, el MCP y el adaptador del evento.
  export interface SkillImportRecord {
    tenantId: string; userId: string; channel: "web" | "mcp";
    slug: string; mode: "crear" | "reemplazar"; files: number;
  }
  export function previewSkillUpload(tenantSlug: string, target: UploadTarget, entries: PackageEntry[], deps: FilesDeps): Promise<UploadPreview | UploadFailure>;
  export function commitSkillUpload(tenantSlug: string, target: UploadTarget, entries: PackageEntry[], deps: FilesDeps): Promise<UploadResult | UploadFailure>;
  ```

- [ ] **Step 1: Tests que fallan** (`skills-upload.test.ts`; `deps` con reglas `members("skills/ventas","administrador")` salvo que se diga):
  - `preview a carpeta sin la skill → mode "crear", slug "skills/ventas/facturacion", name "facturacion", files sin SKILL.md, warnings []`.
  - `preview con la skill ya existente en esa ruta → mode "reemplazar"`.
  - `crear exige administrador`: con `members("skills/ventas","editor")` → `{ ok:false, code:"not_found" }`; sin reglas bajo `skills/` → `not_found`.
  - `reemplazar exige editor de la skill`: lector → `not_found`; editor → `ok`.
  - `target skill: name distinto del de la skill` → `ok` y `warnings` contiene un texto que nombra ambos y dice que no se renombra; el `slug` sigue siendo el del target.
  - `target skill inexistente` → `not_found`.
  - Review Focus 1: `name` ausente, `Ventas`, `a/b`, `../x`, 65 caracteres → `{ ok:false, code:"validation", problems:[…] }` y `save`/`putFile` **no** se llaman (también en `commit`).
  - Review Focus 2: skill del mismo nombre en `skills/rrhh` visible para la persona → warning que la nombra; invisible para la persona (`levelOf` null) → **sin** warning.
  - Review Focus 3: zip inválido en `commit` → `save` no llamado; `save` lanza `BrainConflict` → `{ ok:false, code:"conflict" }`; lanza `BrainForbidden` → `not_found`; lanza `BrainValidation` → `validation` con su mensaje.
  - Review Focus 5: `commit` dos veces con los mismos `entries` sobre una skill existente → segunda vez `mode:"reemplazar"`, `files` igual, sin `putFile` de más para rutas repetidas.
  - `commit crear`: orden de llamadas `["save", …put/remove del import]`; el `save` del alta lleva `category:"skill"`, `status:"activo"`, `title: name`, `frontmatter:{ description }`, `reason: "Alta por subida de paquete"`; el resultado trae `revision` del import.
  - `commit reemplazar`: no hay alta; solo el import.
  - Carpeta inválida (`"Ventas"`, `"a//b"`) → `validation`; slug de más de `MAX_SLUG_LENGTH` → `validation`.
- [ ] **Step 2:** `npm test -- tests/brain/skills-upload.test.ts tests/brain/skills-files.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `skillAccess` (refactor de `context`; `skills-files.test.ts` completo sigue verde) y `upload.ts`. Un único planificador interno resuelve acceso, `planImport`, slug, modo (existe o no en `store.overview`), permiso y avisos; `preview` lo devuelve formateado y `commit` lo reusa. Los avisos de duplicado solo miran filas con `levelOf(slug) !== null`.
- [ ] **Step 4:** `npm test -- tests/brain` (carpeta entera, incluye `boundary.test.ts`) → PASS; typecheck; biome; commit `feat: servicio de subida de skills (vista previa y confirmación)`.

---

### Task 4: Ruta web y evento

**Files:**
- Create: `app/[tenant]/brain/skills/upload/route.ts`, `lib/brain/adapters/skill-uploads.ts` (por ahora solo el evento)
- Modify: `app/[tenant]/brain/skills/files/route.ts` (se quita la rama `kind === "zip"` y los imports que queden sin uso)
- Test: `tests/brain/skills-upload-route.test.ts` (copiar el esqueleto de mocks de `tests/brain/skills-route.test.ts`), `tests/brain/skills-route.test.ts` (quitar el caso del zip)

**Interfaces:**
- Consumes: `previewSkillUpload`, `commitSkillUpload`, `SkillImportRecord` (Tarea 3); `unzipOrProblem` (Tarea 2); `filesDeps()` (`lib/brain/adapters/skills.ts`); `isSameOrigin` (`core/skills/http.ts`); `MAX_ZIP_BYTES`.
- Produces: `POST /{tenant}/brain/skills/upload`, multipart con `file` (zip), `action` (`"preview"` | `"confirm"`) y **uno** de `folder` (puede ser `""`) o `slug`. Respuestas JSON: `UploadPreview` | `UploadResult` | `{ ok:false, code, message, problems? }`, con el mismo mapa código→status que la ruta de archivos.
- Produces (skill-uploads.ts): `export function skillImportEvent(entry: SkillImportRecord): Record<string, unknown>` (`type: "brain.skill_imported"`, `summary: slug`, `payload: { mode, files }`, forma de `packageIssueEvent`), `export async function recordSkillImport(entry: SkillImportRecord): Promise<void>` (insert en `events`; tira solo el mensaje).

- [ ] **Step 1: Tests que fallan.** Misma batería de guardas que la ruta de archivos: tenant inválido → 404; origen distinto → 403; sin `Content-Length` → 411; `Content-Length` > `MAX_ZIP_BYTES + 65_536` → 413 **sin leer el cuerpo**; no miembro → 404 antes de leer `formData`. Y: `action` o destino ausentes o ambos presentes → 400; `preview` con zip basura → 422 con el mensaje de `unzipOrProblem` sin llamar al servicio; `preview` válido → 200 con el `UploadPreview` y **sin** llamar a `commitSkillUpload` ni a `recordSkillImport`; `confirm` válido → 200, `revalidatePath("/{tenant}/brain", "layout")` y `recordSkillImport` con `channel:"web"`; un fallo de `recordSkillImport` no cambia la respuesta (se loguea); error inesperado → 500 con texto en castellano sin internos. En `skillImportEvent`: forma exacta del objeto.
- [ ] **Step 2:** `npm test -- tests/brain/skills-upload-route.test.ts` → FAIL.
- [ ] **Step 3:** Implementar la ruta y el adaptador del evento; quitar la rama zip de `files/route.ts` y su test.
- [ ] **Step 4:** `npm test -- tests/brain/skills-upload-route.test.ts tests/brain/skills-route.test.ts` → PASS; typecheck; biome; commit `feat: ruta para subir una skill desde un zip`.

---

### Task 5: Diálogo "Subir skill", menú de carpeta y panel de la skill

**Files:**
- Create: `components/brain/skills/upload-dialog.tsx`
- Modify: `components/brain/tree-row-menu.tsx` (`FolderMenuItem` suma `"upload-skill"`, ítem y prop `onUploadSkill`), `components/brain/brain-tree.tsx` (estado del diálogo y montaje), `components/brain/skills/skill-panel.tsx` (reemplaza el bloque «Importar un paquete» y quita `importZip`, `zipInput` y el `window.confirm`)
- Test: `tests/brain/skills-components.test.ts`, `tests/brain/tree-row-menu.test.ts` (si no existe, crearlo con el estilo de los tests de `folderMenuItems` del repo)

**Interfaces:**
- Consumes: la ruta de la Tarea 4; `UploadPreview`, `UploadFailure` (tipos de la Tarea 3, solo `import type`).
- Produces: `export function UploadDialog(props: { tenantSlug: string; target: UploadTarget; onClose: () => void }): JSX.Element`. Estados: elegir zip → «Revisando…» → vista previa (nombre, descripción, `N archivos · X KB`, «Crea una skill nueva» / «Reemplaza el borrador de <slug>», avisos, y **todos** los problemas si los hay con el botón de confirmar deshabilitado) → «Subiendo…» → éxito con link a la skill (`pageHref`). Rechaza en el cliente un archivo de más de 4 MB sin hacer el pedido. Reemplazar muestra la advertencia de que cambia el texto y los archivos del borrador.
- Produces (tree-row-menu.tsx): `folderMenuItems(...)` devuelve `"upload-skill"` cuando `node.level === "administrador"`, `isFolderNode(node)` y `isSkillsFolder(node.path)`, **incluso si la carpeta es implícita** (`node.folder === null`: subir una skill crea una página, no una subcarpeta). Texto del ítem: «Subir skill…».

- [ ] **Step 1: Tests que fallan.** `folderMenuItems`: administrador de `skills` y de `skills/ventas` incluye `"upload-skill"`; editor de `skills/ventas`, administrador de `ventas` (fuera de skills) y la raíz **no**; una carpeta implícita bajo `skills/` sí. `UploadDialog` con `renderToStaticMarkup`: el estado inicial pide un `.zip` y menciona el tope de 4 MB. `SkillPanel`: ya no renderiza el campo «Zip del paquete» ni el texto «Importar zip»; sí un botón «Subir paquete (zip)…».
- [ ] **Step 2:** `npm test -- tests/brain/skills-components.test.ts tests/brain/tree-row-menu.test.ts` → FAIL.
- [ ] **Step 3:** Implementar el diálogo (un `fetch` por acción, sin `window.confirm`; el archivo se conserva en estado y se manda dos veces), el ítem de menú y el montaje en el árbol; en el panel, el botón abre el diálogo con `{ kind: "skill", slug }`.
- [ ] **Step 4:** tests del paso 2 en verde; typecheck; biome. **Verificación manual** (no usar `preview_start` para un worktree: levanta el checkout principal contra producción): `npm run db:start`, `npm run dev` con la base local, entrar como administrador de `skills/ventas`, subir un zip de 3 MB, ver la vista previa, confirmar, ver la skill en borrador; subir uno sin `name` y ver el problema. Anotar el resultado en el PR.
- [ ] **Step 5:** commit `feat: botón Subir skill en las carpetas de skills y vista previa`.

---

### Task 6: Arrastrar archivos sueltos al panel

**Files:**
- Create: `components/brain/skills/loose-files.ts`
- Modify: `components/brain/skills/skill-panel.tsx`
- Test: `tests/brain/skills-loose-files.test.ts`

**Interfaces:**
- Produces: `export function looseFilePath(file: { name: string; webkitRelativePath?: string }): string` — con `webkitRelativePath` quita el primer tramo (la carpeta arrastrada); sin él, el `name`.
- Produces: `export async function collectDropped(items: DataTransferItemList): Promise<{ file: File; path: string }[]>` — recorre carpetas con `webkitGetAsEntry`; las rutas salen sin la carpeta raíz.

- [ ] **Step 1: Tests que fallan.** `looseFilePath({ name: "a.py", webkitRelativePath: "mi-skill/scripts/a.py" })` → `"scripts/a.py"`; `({ name: "a.py" })` → `"a.py"`; `({ name: "a.py", webkitRelativePath: "" })` → `"a.py"`.
- [ ] **Step 2:** FAIL → implementar `loose-files.ts`.
- [ ] **Step 3:** En el panel, una zona «Arrastrá archivos o una carpeta» (más un `<input type="file" multiple webkitdirectory>` como alternativa) sube de a uno por la ruta `files` existente (`kind` ausente). Al terminar muestra «Subieron N de M» y, si hubo fallos, cada ruta con su motivo (el tope de 50 archivos llega como error del servidor, no se corta antes). `SKILL.md` suelto se omite con el aviso «SKILL.md se cambia desde el editor o con un zip». El campo «Ruta dentro del paquete» queda en un `<details>` «Cambiar la ruta».
- [ ] **Step 4:** test en verde; typecheck; biome; verificación manual en el navegador (arrastrar una carpeta con 3 archivos). Commit `feat: arrastrar archivos o una carpeta al panel de una skill`.

---

### Task 7: MCP — núcleo (`skill_upload_link` y `skill_import`)

**Files:**
- Modify: `lib/brain/core/skills/draft.ts` (`creatableSkillFolders` suma un tercer parámetro `min: Level = "editor"`), `lib/brain/core/mcp-server/server.ts`, `lib/brain/core/mcp-server/handler.ts`
- Create: `lib/brain/core/skills/upload-id.ts`, `lib/brain/core/skills/upload-mcp.ts`
- Test: `tests/brain/skills-upload-id.test.ts`, `tests/brain/skills-upload-mcp.test.ts`, `tests/brain/mcp-server/tools.test.ts`, `tests/brain/mcp-server/handler.test.ts`, `tests/brain/skills-draft.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 3; `SkillDrafts` y el helper `notFound` de `draft.ts` como modelo de errores (`BrainNotFound`, `BrainError("validation", …)`).
- Produces (upload-id.ts, puro): `UPLOAD_LINK_SECONDS = 600`; `makeUploadId(folder: string, nowMs: number, random: string): string`; `parseUploadId(id: string, nowMs: number): { folder: string } | "expired" | null`. El `id` lleva la hora de emisión, un valor aleatorio y la carpeta (formato libre mientras sea ida y vuelta y use solo `[A-Za-z0-9._~-]`).
- Produces (upload-mcp.ts):
  ```ts
  export interface UploadStaging {
    issue(i: { tenantId: string; userId: string; uploadId: string }): Promise<{ url: string; expiresIn: number }>;
    read(i: { tenantId: string; userId: string; uploadId: string }): Promise<Uint8Array | null>;
    remove(i: { tenantId: string; userId: string; uploadId: string }): Promise<void>;
  }
  export interface SkillUploadsDeps {
    tenantSlug: string; files: FilesDeps; levelOf(path: string): Level | null;
    uploadableFolders: string[]; staging: UploadStaging;
    unzip(bytes: Uint8Array): PackageEntry[] | { error: string };
    reviewUrl(slug: string): string;
    record(entry: SkillImportRecord): Promise<void>;
  }
  export interface SkillUploads {
    uploadableFolders: string[];
    link(i: { folder: string }): Promise<Record<string, unknown>>;
    import(i: { uploadId: string; confirm?: boolean }): Promise<Record<string, unknown>>;
  }
  export function createSkillUploads(deps: SkillUploadsDeps): SkillUploads;
  export function uploadableSkillFolders(rules: AccessRule[], principal: Principal): string[]; // = creatableSkillFolders(rules, principal, "administrador")
  ```
- Produces (server.ts): `SKILL_TOOL_NAMES` suma `uploadLink: "skill_upload_link"` e `import: "skill_import"`; `buildBrainMcpServer` acepta `skillUploads?: SkillUploads | null`. Con `null` no existen las tools. `skill_upload_link` recibe `{ folder: z.string().max(150) }` (relativa a `skills/`, `""` directo) y su descripción lista `uploadableFolders` (tope de 20 como `creatableNote`) y dice que sirve solo si el entorno puede ejecutar código y subir un archivo por HTTP. `skill_import` recibe `{ uploadId: z.string().min(1).max(300), confirm: z.boolean().optional() }`.
- Produces (handler.ts): `McpSkillsDeps.upload?: { staging: UploadStaging; unzip: SkillUploadsDeps["unzip"]; record: SkillUploadsDeps["record"] }`. El handler arma `skillUploads` dentro del mismo `if (canEditSkills(...))` que `skillDrafts` (extraer el objeto `files` a una constante compartida), solo si `editDeps` y `deps.skills.upload` existen y `uploadableFolders` no está vacío.

Conducta de `link`: carpeta normalizada con `normalizeSkillFolder` e inválida → `validation`; sin `administrador` sobre `skills/<carpeta>/x` → `BrainNotFound`; devuelve `{ ok:true, uploadId, url, method:"PUT", contentType:"application/zip", maxBytes, expiresIn, message }`. Conducta de `import`: `parseUploadId` null → `not_found`, `"expired"` → `validation` («El link venció, pedí otro con skill_upload_link.»); objeto ausente → `not_found`; más de `MAX_ZIP_BYTES` → `validation`; `unzip` con `{ error }` → `validation` con ese texto; sin `confirm` devuelve la vista previa más `confirmHint`; con `confirm: true` llama a `commitSkillUpload`, **borra el objeto** (un fallo de borrado solo se loguea), llama a `record` con `channel:"mcp"` (un fallo se loguea) y devuelve el resultado con `reviewUrl` y el aviso de borrador de `draft.ts`. Toda falla del servicio se traduce a `BrainError`.

- [ ] **Step 1: Tests que fallan.**
  - `upload-id`: ida y vuelta con carpeta raíz, `ventas` y `ventas/q1`; a los 599 s sigue vigente y a los 601 s da `"expired"`; basura, vacío y un id con caracteres fuera del alfabeto → `null`.
  - `creatableSkillFolders(rules, principal, "administrador")`: editor de `skills/ventas` → `[]`; administrador de `skills/ventas` → `["ventas"]`; administrador de `skills` → `[""]`; carpeta anidada dentro de otra ya incluida no suma.
  - `link`: administrador → trae `uploadId`, `url`, `maxBytes === MAX_ZIP_BYTES`; editor o carpeta inventada → `BrainNotFound`; carpeta `"Ventas"` → `validation`.
  - Review Focus 4: el staging se arma con (tenant, persona) del caller, así que un `uploadId` emitido a otra persona hace `read` → `null` → `not_found` (test con un fake que indexa por los tres campos); vencido; objeto de `MAX_ZIP_BYTES + 1`; bytes que no son zip; todos sin que `commit` ni `save` se llamen.
  - `import` sin `confirm` no escribe ni borra el objeto; con `confirm` escribe, borra y registra; si `staging.remove` o `record` lanzan, igual devuelve `ok`.
  - `tools.test.ts`: sin `skillUploads` las tools no existen; con él, ambas se listan; `link` y `import` con `confirm` golpean el limitador como `write`, `import` sin `confirm` como `read`.
  - `handler.test.ts`: administrador de una carpeta ve las tools; editor, lector y quien no tiene reglas bajo `skills/` no; categoría `skill` deshabilitada o `deps.skills.upload` ausente → no existen.
- [ ] **Step 2:** `npm test -- tests/brain/skills-upload-id.test.ts tests/brain/skills-upload-mcp.test.ts tests/brain/mcp-server tests/brain/skills-draft.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. El limitador se decide por `input.confirm` antes de llamar (`run(input.confirm ? "write" : "read", …)`).
- [ ] **Step 4:** `npm test -- tests/brain` → PASS (incluye `boundary.test.ts`); typecheck; biome; commit `feat: tools skill_upload_link y skill_import en el MCP del brain`.

---

### Task 8: MCP — Storage y cableado de producción

**Files:**
- Modify: `lib/brain/adapters/skill-uploads.ts` (suma el staging), `lib/brain/adapters/mcp-production.ts`
- Test: `tests/brain/skill-uploads-adapter.test.ts`, `tests/brain/mcp-server/production.test.ts`

**Interfaces:**
- Produces: `export function uploadStaging(): UploadStaging`. Bucket `skill-packages`, objeto `imports/<tenantId>/<userId>/<uploadId>.zip` (la ruta sale siempre de los argumentos, nunca del `uploadId` en crudo: rechazar un `uploadId` que no cumpla `^[A-Za-z0-9._~-]{1,300}$`). `issue` usa `createSignedUploadUrl(path, { upsert: true })`, devuelve `expiresIn: UPLOAD_LINK_SECONDS` (el vencimiento real lo impone `parseUploadId`; la URL de Supabase dura más) y, antes de emitir, borra de forma best-effort los objetos de esa persona con más de 24 h bajo su prefijo (un fallo de limpieza se loguea y no frena la emisión). `read` descarga; `remove` borra.
- Produces: `skillsDeps().upload = { staging: uploadStaging(), unzip: unzipOrProblem, record: recordSkillImport }` en `mcp-production.ts`.
- Constraint: el canal MCP de eve no puede cargar `next/*`; `skill-uploads.ts` solo importa `../../supabase/admin.ts`, el núcleo y `skill-zip.ts`.

- [ ] **Step 1: Tests que fallan** (con un cliente de Storage falso): `issue` firma exactamente `imports/t1/u1/<id>.zip`; rechaza un `uploadId` con `/` o `..`; borra solo objetos de `imports/t1/u1/` con más de 24 h y deja los recientes; sigue emitiendo aunque el listado falle; `read` devuelve `null` si el objeto no existe; `remove` borra la ruta exacta. En `production.test.ts`: `productionDeps()` expone `skills.upload`.
- [ ] **Step 2:** FAIL → implementar.
- [ ] **Step 3:** `npm test -- tests/brain` → PASS; typecheck; biome; **`eve build`** (el canal de eve no puede arrastrar `next/*`; los tests no lo ven) sin errores.
- [ ] **Step 4:** commit `feat: Storage de preparación y cableado de la subida por MCP`.

---

### Task 9: Documentación y cierre

**Files:**
- Modify: `docs/guias/conectar-brain-por-mcp.md` (las dos tools, cómo se usan con un cliente que ejecuta código y qué hacer en claude.ai/ChatGPT web), `docs/dominios/brain.md` (ruta, servicio, evento `brain.skill_imported`), `docs/_meta/cobertura.ts` solo si `docs:check` lo pide, `docs/producto/roadmap.md` (estado de la 24.6)

- [ ] **Step 1:** `npm run docs:sync` y `npm run docs:check`. Para cada rojo: página o fila en el dominio brain; no se debilita el test.
- [ ] **Step 2:** `npm run typecheck`, `npm test`, `npx biome check` de lo tocado.
- [ ] **Step 3:** correr `/docs-wiki` hasta que quede en verde.
- [ ] **Step 4:** abrir el PR (`/ship`: versión, changelog, PR). En la descripción: el resultado de la verificación manual de las Tareas 5 y 6, que **no** hubo migración, y que el cierre en producción es subir un zip de 3 MB con un administrador de una subcarpeta y una subida por Claude Code, según el criterio de cierre de la spec §1.
