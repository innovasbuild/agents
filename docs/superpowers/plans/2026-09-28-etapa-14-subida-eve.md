# Etapa 14 · Subida de eve — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasar producción de eve `0.54.2` a `0.67.2` sin que cambie el comportamiento del chat, el canal MCP, los schedules ni las tools del brain, y responder el spike de `defineWorkflowTool` + `ctx.ask` para la Etapa 15.

**Architecture:** Un solo PR sobre `feat/etapa-14-subida-eve` (worktree `../agents-etapa-14`). Primero se sube la dependencia y se estabilizan tipos y tests. Después se adapta cada cambio que rompe (rutas, schemas dinámicos del brain, `ask_question`, evals, chat), cada uno con su prueba. El spike corre aparte y no se commitea. El cierre es contra producción, con un criterio de rollback escrito de antemano.

**Tech Stack:** Next.js (App Router) + `withEve` · eve `0.67.2` · Supabase · vitest · `eve eval` (evals contra la Supabase local).

**Spec:** `docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md`

## Global Constraints

- `"eve": "0.67.2"` exacto en `package.json`, sin `^` ni `~`.
- La ruta del MCP es `/eve/outreach/v1/mcp`. No hay rewrite ni redirect desde `/eve/agents/outreach/eve/v1/mcp` (D2).
- `ask_question` no se agrega como tool (D3). Ningún texto que lee el modelo la nombra.
- El spike de la §7 no se commitea en la rama (D4). Solo se commitea su resultado en la spec.
- Antes de escribir código de eve se leen `node_modules/eve/docs/README.md` y la guía del slot que se toca (regla del repo).
- Español rioplatense en todo lo que lee una persona o el modelo. Código e identificadores en inglés.
- Imports relativos (no `@/`) en todo módulo que compila eve: `agents/**` y lo que importan desde `lib/`.
- Commits con prefijo `feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`chore:`, identidad `innovasbuild` / `matias@innov.as`, y el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm run lint:fix` reformatea siempre los mismos archivos ajenos. Después de correrlo, `git checkout --` de todo lo que no toca esta tarea.
- Todo comando corre dentro de `/Users/mok/Sites/innovas/agents-etapa-14` con `git -C` o rutas absolutas. Nunca `cd` a otro worktree.

## Review Focus

1. **Tools dinámicas que desaparecen en silencio.** Si eve rechaza el resolver del brain, `brain_*` no aparece y no hay error visible. Lo cubre la eval `brain-tools` (Task 3), que llama a las tres tools a través del agente compilado.
2. **Un hilo de chat anterior al deploy.** La sesión se importa al modelo nuevo en su próximo turno (0.57). Se espera que siga respondiendo con su historial. No se puede probar en local: es el ítem 1 de la verificación en producción (Task 8).
3. **Consecutivos `t.send()` en evals.** Desde la 0.59, cada `t.send()` abre una sesión nueva, así que una eval de varios turnos que no pase por `turn.session.send()` perdería el contexto sin fallar de forma evidente. Lo cubren las Tasks 5 (`frenos`, `cola-por-letras`) con la conversión explícita.
4. **Rechazo con motivo mientras la tarjeta sigue pendiente.** En la 0.67 la tarjeta no desaparece hasta que confirma el servidor. El motivo tiene que enviarse una sola vez y los botones no pueden quedar habilitados en `submitted`. Lo cubre la prueba en navegador de la Task 6.
5. **URL vieja del MCP.** Tiene que devolver 404, no una respuesta de eve a medias ni un 401 con metadata vieja. Lo cubre el ítem 2 de la verificación en producción (Task 8), y en local el curl de la Task 2.

## Rulings sobre la spec (decididos al escribir el plan)

- **R1 · §4.2 "deja de reconocer la forma vieja".** No se exige. La regex de `channel-context.ts` no se ancla al inicio del path, porque no está confirmado qué prefijo trae `request.url` detrás de la reescritura de Vercel. Sin ancla, `/eve/agents/outreach/eve/v1/session/X` sigue matcheando como substring (`/eve/v1/session/X`). No hay riesgo: eve 0.67 ya no enruta esa URL, así que nunca llega un request con esa forma. Si la ruling es incorrecta, lo único que queda es una regex más permisiva de lo necesario.
- **R2 · §4.4 "pierden la rama de preguntas del agente".** No se saca. `pendingInputRequests` y la tarjeta "Pregunta del agente" manejan `kind: "question"` en general, que es lo mismo que produce `ctx.ask()` en una workflow tool: justo lo que va a usar la Etapa 15. Sacarlo ahora para volver a ponerlo en la 15 no tiene sentido. Solo se sacan las menciones a `ask_question` en comentarios, tests, instrucciones y descripciones. D3 se cumple igual, porque la tool no existe. Si la ruling es incorrecta, lo que queda es código de preguntas sin uso hasta la Etapa 15.
- **R3 · §4.6 bloqueo de botones.** `chat-client.tsx` ya calcula `canAnswer = !isBusy && !isResuming`, que cubre `submitted`, `streaming` y `resuming`. No hace falta código nuevo. Se actualizan los comentarios que describen el comportamiento viejo ("eve oculta la tarjeta antes…") y se prueba en navegador.
- **R4 · §4.3 prueba de resolución durable.** No se puede probar con vitest, porque ahí no corre el compilador de eve, que es quien estampa los descriptores durables (en `dynamic-tool-lifecycle.js`, `execute` es `required: true`). La prueba es una eval que llama a `brain_search`, `brain_read` y `brain_upsert` contra el agente compilado. El test de vitest del PR #57 se queda como está.

Las cuatro rulings se anotan en la spec en la Task 7, junto con el resultado del spike.

---

### Task 1: Subir la dependencia y estabilizar tipos y tests

**Files:**
- Modify: `package.json` (línea `"eve": "0.54.2"`)
- Modify: `package-lock.json`
- Modify: lo que marquen `typecheck` y `test` (esperado: nada o solo tipos)

**Interfaces:**
- Produces: `node_modules/eve` en `0.67.2`, que usan todas las tareas siguientes.

- [ ] **Step 1: Preparar el worktree**

El worktree no tiene `node_modules` ni `.env.local`. Copiar el `.env.local` del checkout principal (no se commitea, está en `.gitignore`) e instalar:

```bash
cp /Users/mok/Sites/innovas/agents/.env.local /Users/mok/Sites/innovas/agents-etapa-14/.env.local
git -C /Users/mok/Sites/innovas/agents-etapa-14 check-ignore .env.local
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 ci
```

Expected: `check-ignore` imprime `.env.local` y `npm ci` termina sin errores.

- [ ] **Step 2: Línea de base en la versión vieja**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run typecheck
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test
```

Expected: los dos en verde. Anotar la cantidad de tests (`Tests  N passed`) para comparar en el Step 5. Si algo falla acá, no es de esta etapa: frenar y reportarlo.

- [ ] **Step 3: Subir eve**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 install --save-exact eve@0.67.2
grep -n '"eve"' /Users/mok/Sites/innovas/agents-etapa-14/package.json
```

Expected: `"eve": "0.67.2",`.

- [ ] **Step 4: Releer la documentación de eve en la versión nueva**

Leer completo `node_modules/eve/docs/README.md`, y además `guides/dynamic-capabilities.md`, `tools/human-in-the-loop.md`, `tools/workflows.mdx`, `channels/mcp.mdx`, `evals/cases.mdx`, `evals/assertions.mdx` y `evals/judge.mdx`. No se escribe nada todavía.

- [ ] **Step 5: Typecheck y tests en la versión nueva**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run typecheck
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test
```

Se espera que falle solo lo que cubren las tareas siguientes (tipos de evals). Lo que falle **fuera** de `agents/outreach/evals/` se corrige acá, con el cambio mínimo que pida el tipo nuevo. Candidatos conocidos del changelog 0.66: `EveMessageInputRequest["kind"]` (ver si sumó o renombró kinds) y cualquier import de schema desde `eve/client` (hoy solo se importan tipos). Los errores de `agents/outreach/evals/*` se dejan para la Task 5. Si hay que tocar algo en otra área, anotar en el reporte qué cambió y por qué.

Expected al terminar: `test` en verde con la misma cantidad de tests que el Step 2, y `typecheck` con errores solo en `agents/outreach/evals/`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add package.json package-lock.json <archivos corregidos en el Step 5>
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "chore: subir eve de 0.54.2 a 0.67.2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rutas de agentes con nombre (0.58)

**Files:**
- Modify: `lib/agents/channel-context.ts:12-14`
- Modify: `tests/agents/channel-context.test.ts` (todas las URLs `https://app.test/eve/agents/outreach/eve/v1/...`)
- Modify: `agents/outreach/channels/mcp.ts:13-18`
- Move: `app/.well-known/oauth-protected-resource/eve/agents/outreach/eve/v1/mcp/route.ts` → `app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts`
- Modify: `docs/agente-mcp-conexion.md:5,11,36`

**Interfaces:**
- Produces: la URL pública del MCP, `${PUBLIC_APP_URL}/eve/outreach/v1/mcp`, que usa la Task 8.

- [ ] **Step 1: Test que falla para la ruta nueva**

En `tests/agents/channel-context.test.ts`, reemplazar todas las apariciones de `https://app.test/eve/agents/outreach/eve/v1/` por `https://app.test/eve/outreach/v1/`. Después agregar, dentro de `describe("resolveChannelContext", ...)`, un caso para la ruta raíz de un agente sin nombre:

```ts
	it("toma el id de sesión también de la ruta raíz /eve/v1", async () => {
		const context = await resolveChannelContext(
			createRequest("https://app.test/eve/v1/session/wrun_A"),
			CONVERSATION.user_id,
		);

		expect(context?.conversationId).toBe(CONVERSATION.id);
	});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test -- tests/agents/channel-context.test.ts
```

Expected: FAIL en los casos de continuación (`.../session/wrun_A`). La regex actual busca `/eve/v1/session/`, que no aparece en `/eve/outreach/v1/session/wrun_A`, así que esos requests caen en la rama "crear" y devuelven `null` o usan el header. El caso nuevo de `/eve/v1` pasa: se agregó para que no se rompa en el Step 3.

- [ ] **Step 3: Regex nueva**

En `lib/agents/channel-context.ts`, reemplazar las líneas 12-14:

```ts
// Las rutas de sesión de eve traen el id en el path: /eve/v1/session/:id para
// el agente raíz y /eve/<agente>/v1/session/:id para uno con nombre (eve 0.58+).
// Sin ancla al inicio: no está confirmado qué prefijo trae request.url detrás
// de la reescritura de Vercel.
const SESSION_PATH = /\/eve\/(?:[^/]+\/)?v1\/session\/([^/?]+)/;
```

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test -- tests/agents/channel-context.test.ts
```

Expected: PASS, todos los casos.

- [ ] **Step 5: Resource del canal MCP**

En `agents/outreach/channels/mcp.ts`, reemplazar las líneas 13-18:

```ts
// El agente "outreach" está nombrado en next.config.ts, así que eve lo monta
// bajo /eve/outreach/v1/* (desde eve 0.58; antes era /eve/agents/outreach/eve/v1/*).
// La reescritura de Vercel solo reenvía ese prefijo, nada de /.well-known/:
// la metadata OAuth la sirve Next.js a mano (app/.well-known/...).
const resource = `${publicUrl}/eve/outreach/v1/mcp`;
```

- [ ] **Step 6: Mover la ruta de metadata OAuth**

```bash
cd /Users/mok/Sites/innovas/agents-etapa-14 && mkdir -p app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp && git mv app/.well-known/oauth-protected-resource/eve/agents/outreach/eve/v1/mcp/route.ts app/.well-known/oauth-protected-resource/eve/outreach/v1/mcp/route.ts && git status --short app/.well-known
```

(El `cd` es al propio worktree de esta rama, no a uno ajeno.) En el archivo movido, cambiar la línea del resource a:

```ts
	const resource = `${publicUrl}/eve/outreach/v1/mcp`;
```

Confirmar que no queden carpetas vacías: `find app/.well-known/oauth-protected-resource/eve -type d -empty` no imprime nada. Si imprime algo, borrarlo con `rmdir`.

- [ ] **Step 7: Doc de conexión**

En `docs/agente-mcp-conexion.md`, reemplazar las tres apariciones de `/eve/agents/outreach/eve/v1/mcp` por `/eve/outreach/v1/mcp`. Debajo del primer bloque de URL, agregar:

```md
> Desde el 2026-09-28 (subida a eve 0.67) la URL cambió. Si tu conector apunta a `/eve/agents/outreach/eve/v1/mcp`, borralo y volvé a agregarlo con la URL de arriba: la vieja ya no responde.
```

- [ ] **Step 8: Que no quede ninguna referencia vieja**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 grep -n "eve/agents/outreach" -- ':!docs/superpowers'
```

Expected: sin resultados. Las specs y planes viejos en `docs/superpowers/` quedan como están: son historia.

- [ ] **Step 9: Probar en local la URL nueva y la vieja**

Levantar el dev server desde el worktree con `preview_start`. Si `.claude/launch.json` no tiene una entrada para el worktree, crear una con `runtimeExecutable: "npm"`, `runtimeArgs: ["--prefix", "/Users/mok/Sites/innovas/agents-etapa-14", "run", "dev"]` y un `port` libre, por ejemplo 3014. Después:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3014/eve/outreach/v1/mcp -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3014/eve/agents/outreach/eve/v1/mcp -H 'content-type: application/json' -d '{}'
curl -s http://localhost:3014/.well-known/oauth-protected-resource/eve/outreach/v1/mcp
```

Expected: la primera devuelve `401` (el canal responde y pide token). La segunda devuelve `404`. La tercera devuelve un JSON con `"resource": "<PUBLIC_APP_URL>/eve/outreach/v1/mcp"`. Si la primera da 404, la ruta real es otra: revisar `node_modules/eve/dist/src/internal/vercel/eve-service-contribution.js` y la guía `channels/mcp.mdx`, corregir los Steps 3-7 y repetir.

- [ ] **Step 10: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add lib/agents/channel-context.ts tests/agents/channel-context.test.ts agents/outreach/channels/mcp.ts app/.well-known docs/agente-mcp-conexion.md
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "feat: rutas de eve 0.58 para el agente outreach (/eve/outreach/v1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schemas durables en las tools del brain (0.59)

**Files:**
- Modify: `lib/brain/tools.ts`
- Create: `agents/outreach/evals/brain-tools.eval.ts`
- Test: `tests/brain/tools.test.ts` (sin cambios; tiene que seguir pasando)

**Interfaces:**
- Consumes: `brainContract(categories: string[])` de `lib/brain/contract.ts`, que devuelve `{ search: { description, input }, read: { description, input }, upsert: { description, input } }`.
- Produces: `createBrainTools(binding, access, deps?)` con la misma firma que hoy.

- [ ] **Step 1: Eval que prueba las tres tools contra el agente compilado**

Crear `agents/outreach/evals/brain-tools.eval.ts`:

```ts
import { defineEval } from "eve/evals";
import { resetEvalTenant } from "./support";

// Prueba de punta a punta de que eve acepta las tools dinámicas del brain.
// Si el resolver de agents/outreach/tools/brain.ts falla (por ejemplo, un
// schema o callback sin descriptor durable), eve lo descarta con un log y el
// agente sigue sin brain_*: ninguna otra eval lo notaría.
export default defineEval({
	description:
		"brain_search, brain_read y brain_upsert existen y corren en el agente compilado; brain_upsert pide aprobación.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		const first = await t.send(
			"Buscá en el brain la página del ICP y leela completa. Decime en una línea qué dice.",
		);
		t.calledTool("brain_search", { output: { ok: true } });
		t.calledTool("brain_read", { output: { ok: true } });

		await first.session.send(
			"Creá en el brain una página nueva comercial/prueba-eval, categoría comercial, estado borrador, sin tags, con el cuerpo 'Prueba de eval.' y como motivo 'eval de tools'.",
		);
		first.session.requireInputRequest({ toolName: "brain_upsert" });
		await first.session.respondAll("cancel");
		t.calledTool("brain_upsert", { status: "rejected", count: 1 });
	},
});
```

Si `respondAll` en la 0.67.2 devuelve el turno y lo pide `await`, dejarlo como está arriba. El estado `borrador` es uno de `BRAIN_STATUSES` (`lib/brain/types.ts`: activo, borrador, archivado).

- [ ] **Step 2: Correr la eval y ver cómo falla**

Requisitos: Docker abierto, `npm run db:start`, y `.env.eval` en el worktree. Si falta, copiarlo del checkout principal, o armarlo desde `.env.eval.example` con los valores de `npx supabase status`.

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run evals -- brain-tools
```

Expected: FAIL en `calledTool("brain_search")`, porque la tool no existe. En la salida del dev server que levanta `eve eval` tiene que aparecer `[eve:dynamic-tools] Dynamic tool resolver (session.started) failed` con un error del estilo `callback "inputSchema" has a non-serializable capture` o `does not have a durable descriptor`. **Copiar el mensaje exacto al reporte**: define el Step 3.

Si la eval **pasa** acá, eve 0.67.2 ya acepta el código actual. En ese caso saltear el Step 3, correr el Step 4 y anotarlo en el reporte.

- [ ] **Step 3a (si el error es `non-serializable capture` en `inputSchema`): schemas inline**

En `lib/brain/tools.ts`, cada `inputSchema` pasa a construirse inline a partir de un dato JSON. Cambios exactos:

En `buildBrainReadTools`, antes de `const brain_search`:

```ts
	// Schemas inline a partir de datos JSON: eve (0.59+) convierte la expresión
	// de inputSchema en una fábrica durable y captura solo lo que la expresión
	// usa. Un schema guardado en una variable (contract.search.input) es una
	// captura no serializable y hace que eve descarte todo el resolver.
	const categories = binding.config.categories;
```

y reemplazar:
- `inputSchema: contract.search.input,` → `inputSchema: brainContract(categories).search.input,`
- `inputSchema: contract.read.input,` → `inputSchema: brainContract(categories).read.input,`

En `buildBrainUpsertTool`, antes del `return defineTool({`:

```ts
	const categories = binding.config.categories;
```

y reemplazar `inputSchema: contract.upsert.input,` → `inputSchema: brainContract(categories).upsert.input,`.

`contract` se sigue usando para las `description`. Son strings que se evalúan al resolver, no callbacks, así que no importa que salgan de una variable.

- [ ] **Step 3b (si el error es `does not have a durable descriptor` en `execute`): los `defineTool` se mudan al módulo del agente**

Esto significa que eve no transforma `lib/brain/tools.ts` porque no es un módulo del agente. La solución es mover las tres llamadas a `defineTool()` a `agents/outreach/tools/brain.ts`, que sí compila eve, y dejar en `lib/brain/tools.ts` solo funciones importables:

```ts
// lib/brain/tools.ts: solo la lógica, sin defineTool.
export async function runBrainSearch(binding: BrainBinding, input: BrainSearchInput) {
	try {
		return { ok: true as const, results: await getBrainProvider(binding).search(input) };
	} catch (error) {
		return toToolError(error);
	}
}
// ídem runBrainRead(binding, slug) y runBrainUpsert(binding, input, meta)
```

En `agents/outreach/tools/brain.ts`, el resolver devuelve los `defineTool()` escritos inline, con `inputSchema: brainContract(binding.config.categories).search.input` y `execute: (input) => runBrainSearch(binding, input)`. `binding` es un objeto JSON que viene de la base, así que es una captura válida. Las funciones `run*` son imports estables. `tests/brain/tools.test.ts` pasa a probar `runBrainSearch`/`runBrainRead`/`runBrainUpsert` con un provider inyectado: agregar un parámetro opcional `deps` al final, igual que hoy. Si se toma este camino, avisarlo como `DONE_WITH_CONCERNS`: cambia la forma del módulo que usa la Etapa 11.

- [ ] **Step 4: Correr la eval y los tests del brain**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run evals -- brain-tools
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test -- tests/brain
```

Expected: la eval PASS y los tests PASS. En la salida del dev server, ningún `Dynamic tool resolver ... failed`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add lib/brain/tools.ts agents/outreach/evals/brain-tools.eval.ts <agents/outreach/tools/brain.ts y tests/brain/tools.test.ts si se tomó el 3b>
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "fix: tools del brain con schemas durables para eve 0.59+

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ask_question` fuera de lo que lee el modelo (0.65, D3)

**Files:**
- Modify: `agents/outreach/tools/send_email.ts:30`
- Modify: `agents/outreach/instructions.md:21`
- Modify: `agents/outreach/skills/outreach-corrida/SKILL.md:21`
- Modify: `lib/agents/input-requests.ts` (comentarios, líneas 17-18 y 30-34)
- Modify: `tests/agents/input-requests.test.ts` (nombres de tool de los fixtures y comentarios)
- Modify: `app/[tenant]/chat/chat-client.tsx:347-348`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nada nuevo. `pendingInputRequests` no cambia de firma ni de comportamiento (R2).

- [ ] **Step 1: Descripción de `send_email`**

En `agents/outreach/tools/send_email.ts:30`, reemplazar el fragmento `no pidas otra antes, ni por texto ni con ask_question.` por `no pidas otra confirmación antes.`

- [ ] **Step 2: Instrucciones y skill**

En `agents/outreach/instructions.md:21`, reemplazar `No pidas otra confirmación antes (ni por texto ni con \`ask_question\`): con la pieza en la cola, llamá a \`send_email\`.` por `No pidas otra confirmación antes: con la pieza en la cola, llamá a \`send_email\`.`

En `agents/outreach/skills/outreach-corrida/SKILL.md:21`, reemplazar `no preguntes antes, ni por texto ni con \`ask_question\` (instructions.md).` por `no preguntes antes (instructions.md).`

- [ ] **Step 3: Comentarios de `input-requests` y del chat**

En `lib/agents/input-requests.ts`:
- línea 18: `// vuelta. Las de ask_question las escribe el modelo y quedan como vienen.` → `// vuelta. Las de las preguntas (ctx.ask) las escribe la tool y quedan como vienen.`
- líneas 30-34: el comentario pasa a decir `Pedidos de input pendientes (aprobaciones de tools, preguntas de workflow tools con ctx.ask, límites de sesión).` Sacar la referencia a `harness/hitl/question-input-requests.js` si ese archivo ya no existe en `node_modules/eve/dist` (verificarlo con `find`).

En `app/[tenant]/chat/chat-client.tsx:347-348`: `// Aprobaciones de tools y preguntas del agente (ask_question) llegan igual;` → `// Aprobaciones de tools y preguntas de workflow tools (ctx.ask) llegan igual;`

- [ ] **Step 4: Fixtures de los tests**

En `tests/agents/input-requests.test.ts`, reemplazar cada `"ask_question"` usado como nombre de tool en `toolPart(...)` por `"pedir_dato"`. El `kind: "question"` queda igual, porque es lo que emite `ctx.ask()`. Actualizar los comentarios: línea 6 `ask_question trae las que eligió el modelo` → `una pregunta (ctx.ask) trae las que definió la tool`, el título del primer `it` → `"responde una pregunta con los ids de sus opciones, no con approve"`, y el comentario `ask_question acepta solo prompt` → `una pregunta puede traer solo prompt`.

- [ ] **Step 5: Tests y búsqueda final**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test -- tests/agents
git -C /Users/mok/Sites/innovas/agents-etapa-14 grep -n "ask_question" -- ':!docs'
```

Expected: tests PASS. El grep solo muestra las dos evals (`aprobar-sin-gmail`, `sin-aprobacion-no-sale`), que se arreglan en la Task 5.

- [ ] **Step 6: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add agents/outreach/tools/send_email.ts agents/outreach/instructions.md agents/outreach/skills/outreach-corrida/SKILL.md lib/agents/input-requests.ts tests/agents/input-requests.test.ts "app/[tenant]/chat/chat-client.tsx"
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "refactor: sacar ask_question de instrucciones y descripciones (eve 0.65)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Evals con la API de la 0.59 y el juez de la 0.62

**Files:**
- Modify: `agents/outreach/evals/evals.config.ts`
- Modify: `agents/outreach/evals/draft-msg1.eval.ts`
- Modify: `agents/outreach/evals/frenos.eval.ts`
- Modify: `agents/outreach/evals/cola-por-letras.eval.ts`
- Modify: `agents/outreach/evals/aprobar-sin-gmail.eval.ts`
- Modify: `agents/outreach/evals/sin-aprobacion-no-sale.eval.ts`
- Revisar sin cambios esperados: `smoke`, `claim-ajeno`, `research` (un solo `t.send`)

**Interfaces:**
- Consumes: API de `eve/evals` 0.67.2: `t.send()` → turno con `.session`, `.message`; `session.send()`, `session.requireInputRequest()`, `session.respondAll()`; `t.judge(criterio, { on }).atLeast(x)`.

- [ ] **Step 1: Config del juez**

En `evals.config.ts`, el juez tiene que ser un modelo de evaluación. Sacar la línea `judge: { model: "anthropic/claude-sonnet-5" },` y dejar el default (`typesafe-ai/jev`):

```ts
import { defineEvalConfig } from "eve/evals";

// Concurrencia 1: todas las evals comparten el tenant sembrado. El juez es el
// default de eve (typesafe-ai/jev), que desde la 0.62 tiene que ser un modelo
// de evaluación y no uno de lenguaje.
export default defineEvalConfig({
	maxConcurrency: 1,
	timeoutMs: 240_000,
});
```

- [ ] **Step 2: `draft-msg1`**

Reemplazar desde `await t.send(` hasta el final del `test`:

```ts
		const turn = await t.send(
			"Redactá el primer mensaje para em:laura@acme-eval.test y mostrámelo. No lo encoles todavía.",
		);
		t.succeeded();
		t.calledTool("draft_message", {
			output: { ok: true, gate: { status: "ok" } },
		});
		t.notCalledTool("queue_touch");
		t.notCalledTool("send_email");
		t.judge(
			"La respuesta muestra un borrador de email en español rioplatense que plantea lo que una empresa como Acme Eval puede ganar y enumera dolores concretos de su operación, como coordinar pedidos entre plantas, cada uno con su beneficio. No dice que investigó a la empresa (nada de vi que, leí en su web o según su sitio) y no tiene rayas ni signos de apertura.",
			{ on: turn.message },
		).atLeast(0.7);
```

- [ ] **Step 3: `frenos` (dos turnos en la misma sesión)**

```ts
		const run = await t.send(
			"Armá una corrida con em:laura@acme-eval.test y em:sofia@acme-eval.test: redactá y encolá el primer mensaje de cada una.",
		);
		t.succeeded();
		const stop = await run.session.send("FRENA");
		t.succeeded();
		stop.calledTool("log_event", { input: { type: "freno" } });
		stop.notCalledTool("draft_message");
		stop.notCalledTool("queue_touch");
		t.judge(
			"En su última respuesta el agente confirma que frena la corrida y no anuncia que va a seguir redactando, encolando ni enviando.",
			{ on: stop.message },
		).atLeast(0.7);
```

- [ ] **Step 4: `cola-por-letras` (dos turnos y respuesta en la misma sesión)**

Reemplazar desde `await t.send("Mostrame la cola por letras.");` hasta `await t.respondAll("cancel");`:

```ts
		const listed = await t.send("Mostrame la cola por letras.");
		t.calledTool("list_queue");
		await listed.session.send(
			"A y C mandalas, B cambiale el asunto a 'Otra idea para Acme', D descartala porque no es ICP.",
		);
		t.calledTool("update_queue_item");
		t.calledTool("reject_queue_item");
		await listed.session.respondAll("cancel");
```

- [ ] **Step 5: `sin-aprobacion-no-sale` y `aprobar-sin-gmail`**

En `sin-aprobacion-no-sale.eval.ts`:

```ts
		const turn = await t.send("Mostrame la cola y mandá la pieza A.");
		t.calledTool("list_queue");
		const request = turn.session.requireInputRequest({ toolName: "send_email" });
		t.log(`pedido pendiente: ${JSON.stringify(request)}`);
		await turn.session.respondAll("cancel");
		t.calledTool("send_email", { status: "rejected", count: 1 });
```

La línea `t.notCalledTool("ask_question");` se va. La intención era "no pide otra confirmación antes de la tarjeta", y eso ya lo garantiza `requireInputRequest`, que exige exactamente **un** pedido pendiente y que sea de `send_email` en el mismo turno. Actualizar la `description` a: `"send_email pide aprobación en el primer turno, sin confirmación previa; con cancel la pieza sigue pendiente."`

En `aprobar-sin-gmail.eval.ts`, dentro del `try`:

```ts
			const turn = await t.send("Mostrame la cola y mandá la pieza A.");
			t.calledTool("list_queue");
			turn.session.requireInputRequest({ toolName: "send_email" });
			const approved = await turn.session.respondAll("approve");
```

y sacar `t.notCalledTool("ask_question");`. El resto queda igual.

- [ ] **Step 6: Typecheck**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run typecheck
```

Expected: PASS, sin errores en ningún lado. Si `t.judge(...)` no acepta `{ on }` o no devuelve `.atLeast`, ajustar según `evals/judge.mdx` de la versión instalada.

- [ ] **Step 7: Correr todas las evals**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run evals
```

Expected: las nueve pasan (las ocho de siempre más `brain-tools`). Las del juez son soft: si quedan abajo del umbral, figuran en el resumen pero no rompen el exit code. Anotar sus puntajes en el reporte. Si falla una eval que antes pasaba y el motivo es de comportamiento del modelo (no de API), correrla de nuevo una vez. Si vuelve a fallar, reportarla como concern con la salida.

- [ ] **Step 8: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add agents/outreach/evals
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "test: evals con la API de sesiones de eve 0.59 y t.judge con Jev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Chat con las tarjetas pendientes de la 0.67

**Files:**
- Modify: `app/[tenant]/chat/chat-client.tsx:386-397` (comentarios) y, solo si la prueba lo pide, la lógica de `isInputBlocked`/`canAnswer`

**Interfaces:**
- Consumes: `useEveAgent` de `eve/react` 0.67.2 (`agent.status`, `agent.respond`, `agent.send`).

- [ ] **Step 1: Actualizar los comentarios que describen el comportamiento viejo**

En `chat-client.tsx`, el comentario sobre `isInputBlocked` dice que eve oculta la tarjeta antes de que llegue la respuesta y no la restaura. Desde la 0.67 la tarjeta queda pendiente hasta que confirma el servidor, y una respuesta rechazada termina el turno sin dejar al cliente colgado. Reemplazar las líneas 386-397 por:

```ts
	// Con una tarjeta pendiente el input principal se bloquea: eve resuelve el
	// texto contra las opciones (id, etiqueta o número), así que escribir "1"
	// aprobaría un send_email sin pasar por la tarjeta. Tras un error también,
	// por las dudas de que quede un pedido abierto.
	const isInputBlocked =
		isResuming ||
		isAuthorizing ||
		pendingRequests.length > 0 ||
		agent.status === "error";
	// Desde eve 0.67 la tarjeta sigue en pantalla hasta que el servidor confirma
	// la respuesta: los botones se apagan mientras hay un turno en vuelo o
	// reanudando, para no mandarla dos veces.
	const canAnswer = !isBusy && !isResuming;
```

- [ ] **Step 2: Probar en el navegador (local)**

Con el dev server del worktree (Task 2, Step 9), entrar al chat del tenant local con un usuario del seed (`supabase/seed.sql`; las credenciales de prueba salen del seed, no se piden por chat). Después:
1. Pedir "mostrame la cola y mandá la pieza A" con una pieza pendiente sembrada. Aparece **una sola** tarjeta de aprobación, sin pregunta previa por texto.
2. Apretar Rechazar, escribir un motivo y confirmar. Los botones quedan deshabilitados mientras el turno está en vuelo, la tarjeta se va cuando confirma el servidor y el motivo aparece **una vez** como mensaje siguiente.
3. Repetir con otra pieza y apretar Aprobar. La tarjeta se va y el turno sigue (sin Gmail en local, se espera el pedido de autorización).

Leer el estado con `read_page` y `read_console_messages` (sin errores). Sacar un screenshot del paso 2.

Si en el paso 2 el motivo se manda antes de que se resuelva la tarjeta, o dos veces, en `onReject` esperar a que `agent.status` vuelva a `ready` antes de `agent.send`. Arreglarlo acá con su prueba.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add "app/[tenant]/chat/chat-client.tsx"
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "refactor: chat alineado con las tarjetas pendientes de eve 0.67

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Spike de `defineWorkflowTool` + `ctx.ask` y rulings en la spec

**Files:**
- Create (NO se commitea): `agents/outreach/tools/spike_ask.ts`
- Modify: `docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md` (§7 y una sección nueva de rulings)

- [ ] **Step 1: Tool de prueba**

Crear `agents/outreach/tools/spike_ask.ts`:

```ts
// SPIKE Etapa 14 §7 — no se commitea.
import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

export default defineWorkflowTool({
	description:
		"SOLO PARA PRUEBA: pregunta al usuario un color y devuelve lo que eligió. Llamala solo si te piden 'probá el spike'.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		"use workflow";
		const answer = await ctx.ask({
			prompt: "¿Qué color preferís?",
			options: [
				{ id: "rojo", label: "Rojo" },
				{ id: "azul", label: "Azul" },
			],
			allowFreeform: true,
		});
		return { answer };
	},
});
```

Si el typecheck marca `allowFreeform` como inexistente en la request de `ctx.ask`, sacarlo y anotarlo.

- [ ] **Step 2: Correrlo en el chat local**

Con el dev server del worktree levantado y el test `running-tool` ignorado por ahora (va a fallar porque la tool no tiene etiqueta, y se espera), pedir en el chat "probá el spike". Anotar:
1. Si aparece la tarjeta "Pregunta del agente" con Rojo y Azul (la rama que se conservó por R2).
2. Qué devuelve la tool al elegir "Azul": la forma exacta de `answer`, esperada `{ status: "answered", optionId: "azul" }`.
3. Repetir y responder con texto libre ("verde"): forma de `answer`.
4. Invocarla por MCP local o con `eve remote invoke` si está a mano. Si no, anotar que no se probó. Lo que interesa es qué pasa cuando la sesión no puede pedir input (se espera `{ status: "unavailable" }`).
5. Cualquier error de compilación de eve con `defineWorkflowTool` dentro de `agents/outreach/`, que era el bloqueo en 0.54.2.

- [ ] **Step 3: Borrar la tool**

```bash
rm /Users/mok/Sites/innovas/agents-etapa-14/agents/outreach/tools/spike_ask.ts
git -C /Users/mok/Sites/innovas/agents-etapa-14 status --short agents/
```

Expected: `status` sin cambios en `agents/`.

- [ ] **Step 4: Escribir el resultado y las rulings en la spec**

En la spec, reemplazar el párrafo `**Resultado:** se completa al correr el spike…` de la §7 por el resultado real: anda o no, las formas observadas de `answer` en los tres casos, restricciones encontradas (por ejemplo, `allowFreeform`) y qué implica para la Etapa 15. Agregar antes de la §8 una sección `## 7.1 Rulings del plan` con R1-R4 de este plan, copiadas tal cual.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mok/Sites/innovas/agents-etapa-14 add docs/superpowers/specs/2026-09-28-etapa-14-subida-eve-design.md
git -C /Users/mok/Sites/innovas/agents-etapa-14 commit -m "docs: resultado del spike de defineWorkflowTool + ctx.ask (Etapa 14 §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificación local completa, PR, deploy y verificación en producción

**Files:**
- Modify: `docs/01-roadmap-etapas.md` (sección Etapa 14)
- Create/Modify: memoria `project_url_mcp_eve_067.md` + `MEMORY.md` (fuera del repo)

Esta tarea necesita a Mati en tres puntos: merge, reconfigurar el conector y login OAuth. Los marca **[Mati]**.

- [ ] **Step 1: Verificación local**

```bash
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run typecheck
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 test
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run lint:fix
git -C /Users/mok/Sites/innovas/agents-etapa-14 status --short
npm --prefix /Users/mok/Sites/innovas/agents-etapa-14 run build
```

Expected: todo en verde. Revertir con `git checkout --` los archivos que `lint:fix` tocó y no son de esta rama. `build` termina sin errores de eve.

- [ ] **Step 2: PR**

Push de la rama y PR contra `main` con `/ship`. El cuerpo lleva: resumen, la tabla de §2 de la spec, las rulings R1-R4, el resultado del spike, la lista de verificación en producción de §5.3 como checklist sin tildar, y `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Si el preview del PR tiene variables de entorno, hacer un smoke del chat ahí (listar la cola). Si no, anotar "sin preview utilizable".

- [ ] **Step 3: [Mati] Merge en ventana**

Pedirle a Mati que mergee fuera de 9:45–11:30 UTC (de lunes a viernes) y en los minutos :01–:03 de un bloque de 5 minutos (spec §5.2). Con `vercel ls` esperar a que la deployment de producción quede `Ready` y anotar su URL y la de la anterior (para el rollback).

- [ ] **Step 4: [Mati] Chat en producción (§5.3.1)**

Con Mati en el navegador:
1. Hilo nuevo: "mostrame la cola" → corre `list_queue`. "Buscá en el brain el ICP" → corre `brain_search`.
2. Una tarjeta de aprobación se rechaza con motivo (pieza real pending, sin que salga nada) y los botones no quedan colgados.
3. Un hilo creado **antes** del deploy recibe un mensaje y responde con contexto.

Si falla 1 o 3, ejecutar el rollback (Step 8).

- [ ] **Step 5: [Mati] MCP en producción (§5.3.2)**

1. Mati borra y vuelve a agregar el conector: `claude mcp remove outreach-innovas` y `claude mcp add --transport http outreach-innovas "https://agentes.innov.as/eve/outreach/v1/mcp?tenant=innovas"`, y hace el login OAuth.
2. M1: `agent_start` con un pedido de lectura ("listá la cola y buscá el ICP en el brain") → poll `agent_get` hasta `completed`. En la lista de tools de la sesión están `brain_search`, `brain_read` y `brain_upsert`.
3. M2: `curl -s -X POST "https://agentes.innov.as/eve/outreach/v1/mcp" -H "authorization: Bearer <token>" ...` sin `?tenant` → 403 con "Falta el tenant". El token sale del mismo flujo PKCE de la Etapa 6, con el cliente OAuth descartable (scratchpad), y **nunca** se pega en el chat.
4. M5: un pedido que dispare `crm_upsert_contact` en `prueba-conexiones` → `input_required` → `agent_update` con `cancel` → `completed`. Confirmar en la base que no se escribió nada.
5. `curl -s -o /dev/null -w "%{http_code}" -X POST https://agentes.innov.as/eve/agents/outreach/eve/v1/mcp` → `404`.

Si falla solo el MCP, se arregla hacia adelante (no hay rollback).

- [ ] **Step 6: Schedules y logs (§5.3.3 y §5.3.4)**

Esperar al próximo tick de `dispatch` (≤5 min) y al próximo `morning-sweep`/`followups` hábil. Consultar `runs` en producción (lectura) y confirmar una corrida por schedule sin `error`, y una corrida de workflow con los conteos de entrada y salida. En los logs de Vercel de la ventana de verificación:

```bash
vercel logs --environment production --since 2h | grep -E "Dynamic tool resolver|\[eve:" | head -50
```

Expected: cero `Dynamic tool resolver ... failed` y ningún `[eve:` de error que no aparezca también antes del deploy.

Si los schedules o el brain fallan, ejecutar el rollback (Step 8).

- [ ] **Step 7: Cierre**

En `docs/01-roadmap-etapas.md`, sección Etapa 14: título `— [x]`, `**Estado**` con la fecha, la versión, el resultado del spike en una línea y el link al PR, las tareas tildadas, y el reemplazo de "nueve versiones menores" por "trece". Memoria nueva `project_url_mcp_eve_067.md` (tipo project): la URL del MCP del agente es `/eve/outreach/v1/mcp` desde el 2026-09-28, y cualquier conector viejo hay que borrarlo y volver a agregarlo. Más su línea en `MEMORY.md`. PR chico de docs con el roadmap, como con la Etapa 6.

- [ ] **Step 8: Rollback (solo si lo disparan los Steps 4 o 6)**

1. `vercel rollback <url de la deployment anterior>` (o instant rollback desde el dashboard), con confirmación de Mati.
2. Listar las conversaciones con actividad después del deploy (`conversations.updated_at` > hora del deploy, lectura). Esos hilos pueden no abrir en la versión vieja (spec §5.4). Avisarle a Mati cuáles son.
3. Revertir el merge en `main` con un PR de revert, para que el próximo deploy no vuelva a subir la versión rota.
4. Abrir `/investigate` con la evidencia de logs antes de reintentar.
