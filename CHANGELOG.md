# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Lo mantiene `/ship`: una entrada por PR. El detalle de cada etapa está en [docs/producto/roadmap.md](docs/producto/roadmap.md) y las decisiones en [docs/decisiones/prs.md](docs/decisiones/prs.md).

## [0.2.0] - 2026-10-14

### Added

- El chat de cada empresa (`/<slug>/chat`) ahora sirve para cualquier agente de chat: cada hilo pertenece a un agente y, si la empresa tiene más de uno, un selector deja elegir con cuál abrir el hilo nuevo. La lista de hilos y el encabezado muestran de qué agente es cada uno (etapa 22.1).
- Agente Asistente: conversa solo con el brain de la empresa. Busca, lee y propone páginas, que siguen pasando por la aprobación de un administrador. Cuando le piden algo que hace otro agente, lo nombra y sugiere abrir un hilo nuevo con él.
- Una empresa que solo tiene brain ya puede usar el chat: entra directo a conversar con el Asistente, sin selector y sin nada de outreach a la vista.
- Evals del Asistente y `npm run evals -- --agent <agente>` para elegir de qué agente se corren.

### Changed

- El canal del chat rechaza una conversación que entra por la ruta de otro agente.
- Configuración muestra Ejecutores y Aprobaciones solo cuando el agente de outreach está habilitado.
- Conectar lista únicamente los agentes que tienen canal MCP.
- El alta de una empresa ya no siembra las páginas de canon de outreach si el agente que se habilita no las usa.

## [0.1.0] - 2026-10-13

### Added

- Base multi-tenant sobre Supabase: empresas, membresías, tres roles, invitaciones y RLS en toda tabla (etapas 0 y 1).
- Agente de outreach sobre eve: cola de aprobación, pipeline, escucha de respuestas y seguimientos, sincronización con HubSpot y canal MCP (etapas 3 a 6).
- Brain por empresa con permisos por carpeta y página, editor visual, historial, borrado y conector MCP (etapas 11, 17 y 18).
- Modelo de orquestación (nodos, workflows, `work_items`) con el pipeline de búsqueda, calificación, enriquecimiento y redacción (etapas 12 y 13).
- Ingreso por código o dominio, pantalla Conectar, consola de plataforma y de conectores, settings del cliente y segundo tenant (etapas 19 a 21).
- Wiki de documentación en `docs/`: arquitectura, dominios, guías de cómo hacer, referencia generada desde el código, y una tabla por spec y por PR. Un programador nuevo puede entender la plataforma sin abrir las 28 specs (etapa 25).
- `npm run docs:sync` regenera `docs/referencia/`, `npm run docs:check` hace fallar el repo cuando una tool, nodo, workflow, tabla, ruta, proveedor, variable de entorno, spec o PR mergeado no tiene página o una exclusión con motivo, y `npm run docs:prs` guarda el listado de PR mergeados.
- Skill de proyecto `/docs-wiki` para cerrar lo que `docs:check` marca, y el Stop hook de Claude Code lo corre al terminar cada turno.

### Changed

- El `README.md` ahora explica qué es la plataforma, cómo levantarla en local y dónde sigue la documentación.
- Los documentos de `docs/` se movieron a la wiki con `git mv` (conservan su historia) y `CLAUDE.md` apunta a las rutas nuevas.
