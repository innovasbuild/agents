---
title: Agregar una tool al agente
category: guias
status: activo
tags: [tools, agente, eve, approval]
updated: 2026-10-13
sources:
  - agents/outreach/tools/send_email.ts
  - agents/outreach/tools/list_queue.ts
  - lib/agents/running-tool.ts
  - tests/agents/running-tool.test.ts
  - lib/workflows/registry.ts
  - docs/_meta/cobertura.ts
  - tests/docs/cobertura.test.ts
  - CLAUDE.md
---

# Agregar una tool al agente

Una tool es una puerta del chat: autentica, arma el caller y llama a un servicio. No lleva lógica de negocio ni llamadas al modelo (si las necesita, hay un nodo escondido: ver [agregar un nodo o workflow](agregar-un-nodo-o-workflow.md) y [orquestación](../arquitectura/orquestacion.md)). Esta guía cubre el agente `outreach`; el contexto de eve está en [agentes de eve](../dominios/agentes-eve.md).

Antes de escribir código de eve, leé `node_modules/eve/docs/README.md` y la guía de tools (`node_modules/eve/docs/tools/`), como pide `CLAUDE.md`.

## Pasos

1. Decidí el nivel de efecto de lo que hace la tool (escala de [orquestación](../arquitectura/orquestacion.md)): 0 solo toca la base de la plataforma, 1 gasta plata de terceros, 2 escribe en sistemas del tenant (por ejemplo el CRM), 3 le llega a una persona de afuera (por ejemplo un mail). Si el servicio que va a llamar la tool todavía no existe, creá primero el nodo.

2. Creá `agents/outreach/tools/<nombre>.ts`. El nombre del archivo es el nombre de la tool (en inglés, `snake_case`), y exporta por defecto un `defineTool`. Las rutas a `lib/` van relativas, no con `@/`: eve no resuelve los paths de `tsconfig` en los módulos que compila. Modelo mínimo (`list_queue.ts`, nivel 0):

   ```ts
   export default defineTool({
     description: "…qué hace y cuándo usarla, para el modelo…",
     inputSchema: z.object({}),
     async execute(_input, ctx) {
       return listQueue(
         { caller: callerFromSession(ctx.session) },
         { store: createSupabaseOutreachStore(createAdminClient()) },
       );
     },
   });
   ```

   El tenant sale siempre de `callerFromSession(ctx.session)`, nunca de un argumento que pueda poner el modelo.

3. Si el nivel es 2 o 3, agregá `approval` explícito con los helpers de `eve/tools/approval`. `send_email` usa `always()` y `crm_upsert_contact` usa `once()`:

   ```ts
   import { always } from "eve/tools/approval";
   // …
   approval: always(),
   ```

   En eve, omitir `approval` equivale a `never()`: la tool corre sin que nadie apruebe. Para una tool de nivel 0 o 1, dejá un comentario que diga por qué no lleva (como en `draft_message.ts` y `import_contacts.ts`). Ningún test mira esto: lo atrapa la revisión del PR.

4. Agregá su etiqueta en castellano en `TOOL_LABELS` de `lib/agents/running-tool.ts`, que es lo que muestra el indicador de actividad del chat (la clave es el nombre de la tool, el valor una frase corta como "Mirando la cola"). Si a propósito no se nombra en pantalla, va en cambio a `TOOLS_SIN_ETIQUETA` (hoy vacío).

5. Escribí el test de la tool o del servicio que llama. Los ejemplos están en `tests/tools/send-email.test.ts` y `tests/agents/outreach/tools/read-replies.test.ts` (este último comprueba la etiqueta y que no lleve `approval`).

6. Documentá la tool en [agentes de eve](../dominios/agentes-eve.md), con su nombre sin el prefijo del agente (por ejemplo `list_queue`), qué hace, su nivel y su aprobación. La cobertura de la wiki exige que cada tool figure en alguna página de `arquitectura/`, `dominios/` o `guias/`. Solo si a propósito no se documenta, va en `docs/_meta/cobertura.ts` con un motivo de al menos diez caracteres (`"tool:outreach/<nombre>": "motivo"`); la salida normal es escribirla en la página.

7. Si la tool es nueva para una skill o para las instrucciones del agente, sumala a `agents/outreach/instructions.md` o a la skill que corresponda, en castellano rioplatense. Las instrucciones del agente son la única forma en que el modelo sabe cuándo usarla.

8. Regenerá la referencia y corré todo:

   ```bash
   npm run docs:sync
   ```

   ```bash
   npm run typecheck
   ```

   ```bash
   npm test
   ```

   `docs:sync` actualiza `docs/referencia/tools-del-agente.md`, que avisa si a una tool le falta etiqueta.

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Falla | Dónde |
|---|---|---|
| La etiqueta en `TOOL_LABELS` (o de ponerla en `TOOLS_SIN_ETIQUETA`) | "todo tool de outreach tiene etiqueta, salvo los excluidos a propósito" | `tests/agents/running-tool.test.ts` |
| Regenerar la referencia | "docs/referencia coincide con lo que genera docs:sync" | `tests/docs/wiki.test.ts` |
| Documentar la tool | "toda superficie está mencionada en arquitectura/, dominios/ o guias/, o excluida con motivo" | `tests/docs/cobertura.test.ts` |
| Que la exclusión de `cobertura.ts` tenga motivo, o que el objeto ya no exista | "SIN_DOCUMENTAR no guarda nada que ya no exista y todo tiene motivo" | `tests/docs/cobertura.test.ts` |
| Importar `generateText` dentro de la tool sin `metered(` | "todo archivo que importa generateText o experimental_evaluate usa metered" | `tests/workflows/model-calls.test.ts` |
| El `approval` de una tool de nivel 2 o 3 | Nada falla solo. Si falta, la tool corre sin aprobación | revisión del PR |

No verificado: que una tool nueva aparezca en el agente ya desplegado (no hay un test ni un comando en el repo para eso). Después del deploy, comprobalo a mano pidiéndole al agente que liste sus tools en un hilo nuevo.
