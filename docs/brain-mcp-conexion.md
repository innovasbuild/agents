# Conectar el brain desde tus herramientas

Cada cliente tiene su brain en una URL propia:

    https://agentes.innov.as/brain/<cliente>/mcp

Entrás con tu cuenta de la plataforma. Qué podés leer y dónde podés escribir lo deciden los permisos del brain por carpeta y por página: los administradores del cliente pueden todo; el resto, lo que cada carpeta o página le dé.

Las instrucciones por cliente, con la URL de tu empresa ya puesta, están en la plataforma: menú **Conectar** (`/<cliente>/conectar`). Este archivo queda como referencia.

## Claude Code

    claude mcp add --transport http brain-<cliente> https://agentes.innov.as/brain/<cliente>/mcp

Después, dentro de Claude Code, `/mcp`, elegí `brain-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL del brain. Al conectar, se abre la misma pantalla de login y aprobación.

## Codex

Codex: no probado todavía.

## Qué podés hacer

- `brain_search`: buscar por texto, categoría o tag.
- `brain_read`: leer una página completa con su revisión.
- `brain_upsert`: crear o actualizar una página. Hace falta nivel editor sobre esa carpeta o página; sin eso responde que no tenés permiso. Para actualizar, primero leela y pasá su revisión; si alguien la cambió en el medio, vas a recibir un conflicto y tenés que volver a leerla.

Las tres tools aparecen siempre en la lista. Una página que no podés ver no aparece en la búsqueda y responde "no encontrada" al leerla.

Hay un límite de 60 lecturas y 10 escrituras por minuto por persona. Si lo pasás, la respuesta dice cuántos segundos esperar.

## Si algo falla

- **403**: ese cliente no existe o tu cuenta no tiene acceso. Revisá el slug de la URL; si está bien, pedile a un administrador que te invite.
- **404**: el cliente no tiene brain configurado.
- **No se abre el login**: revisá que la URL termine en `/mcp` y que estés usando la de tu cliente.
