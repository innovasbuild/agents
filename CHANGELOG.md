# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Lo mantiene `/ship`: una entrada por PR. El detalle de cada etapa está en [docs/producto/roadmap.md](docs/producto/roadmap.md) y las decisiones en [docs/decisiones/prs.md](docs/decisiones/prs.md).

## [0.4.1] - 2026-10-19

### Added

- Chat nuevo. Al entrar al chat aparece "¿En qué trabajamos?" con un compositor donde elegís el agente (el Asistente u Outreach, si la empresa tiene los dos), el modelo y adjuntás un archivo con el botón **+**, y escribís el mensaje. El agente y el modelo se cambian ahí mismo, ya no en la barra lateral.

### Changed

- "Nuevo chat" pasó arriba de la lista de hilos y lleva a esa pantalla inicial. El hilo se crea recién cuando enviás el primer mensaje, y mientras estés en un chat nuevo el botón queda deshabilitado.
- En un hilo abierto, el agente y el modelo se ven en el compositor como datos fijos (eve los fija al abrir la sesión). Se sacó el aviso de arriba que lo explicaba.

### Fixed

- Tocar "Hilo nuevo" varias veces ya no deja una pila de hilos vacíos en la lista.

## [0.4.0] - 2026-10-15

### Added

- Dominio propio por empresa. Cada empresa puede servirse desde su propio dominio (por ejemplo `ai.tuempresa.com`) con un solo registro `CNAME`: la app, el login, el chat y las URLs para conectar el brain y el agente de outreach a Claude o ChatGPT (`/brain/mcp` y `/eve/outreach/v1/mcp`) salen con ese dominio y sin el nombre de la empresa en la dirección. Las direcciones viejas con el nombre siguen funcionando y redirigen a las limpias.
- Sección **Dominio** en la consola de plataforma (`/plataforma/<slug>`): agregar, verificar, elegir el principal y quitar un dominio, con las instrucciones de DNS para el cliente. Al activarlo, la plataforma lo da de alta en Vercel y en las Redirect URLs de Supabase Auth por API; un barrido cada 10 minutos lo activa solo cuando el DNS responde. El administrador de la empresa ve su dominio en `/<slug>/settings`.
- Los links de invitación salen con el dominio principal de la empresa.
- Guía para operarlo y texto para mandarle al cliente: `docs/guias/dominio-de-un-cliente.md`.

### Changed

- Las URLs de conexión, la metadata OAuth y la pantalla `/conectar` se arman según el dominio por el que se entra.
- Límite conocido: la pantalla de autorización que ve cada persona al conectar Claude o ChatGPT sigue siendo la de la plataforma (`agentes.innov.as`), porque Supabase tiene una sola Site URL por proyecto.
- Para operar dominios hacen falta cinco variables en Production (`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`) y la migración `20261024120000_tenant_domains` aplicada antes que el código.

## [0.3.0] - 2026-10-14

### Added

- Gasto de IA por empresa. El administrador de cada empresa ve cuánto gastó en modelos de IA en el mes en curso y en el anterior, por día y por origen (chat y cada proceso automático), en `/<slug>/settings/gasto`. INNOV.AS ve el gasto de todas las empresas (hoy, mes en curso y mes anterior) en `/plataforma/gasto`.
- Conciliación a pedido: INNOV.AS compara lo asentado en el libro de consumo contra lo que cobró el AI Gateway por empresa y marca las diferencias que superan el mayor entre US$ 1 y el 5 %, o un libro en cero con gasto en el gateway. Cada consulta al gateway tiene costo, por eso no corre sola.
- Toda llamada a un modelo sale etiquetada con la empresa (`tenant:<slug>`), también las del chat del agente de outreach y del Asistente, y un test falla si una puerta nueva no la manda. Así el AI Gateway puede agrupar el gasto por empresa sin una clave por cliente.

### Changed

- Los pasos del agente en el chat ahora se asientan en el libro de consumo, que hasta hoy solo veía las llamadas de las tools y de los procesos automáticos, y cuentan contra el mismo límite diario de gasto en modelos. El chat sigue sin cortarse por presupuesto: revisá el límite de cada empresa después de tres días de libro antes de confiar en él.

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
