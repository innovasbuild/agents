# Conectar el brain desde tus herramientas

Cada cliente tiene su brain en una URL propia:

    https://agents-six-iota.vercel.app/brain/<cliente>/mcp

Entrás con tu cuenta de la plataforma. Si sos administrador del cliente podés leer y escribir; si no, solo leer.

## Claude Code

    claude mcp add --transport http brain-<cliente> https://agents-six-iota.vercel.app/brain/<cliente>/mcp

Después, dentro de Claude Code, `/mcp`, elegí `brain-<cliente>` y autenticá. Se abre el navegador, entrás con tu cuenta y aprobás el acceso.

## claude.ai

Configuración → Conectores → Agregar conector personalizado. Pegá la URL del brain. Al conectar, se abre la misma pantalla de login y aprobación.

## Codex

Codex: no probado todavía.

## Qué podés hacer

- `brain_search`: buscar por texto, categoría o tag.
- `brain_read`: leer una página completa con su revisión.
- `brain_upsert` (solo administradores): crear o actualizar una página. Para actualizar, primero leela y pasá su revisión; si alguien la cambió en el medio, vas a recibir un conflicto y tenés que volver a leerla.

Hay un límite de 60 lecturas y 10 escrituras por minuto por persona. Si lo pasás, la respuesta dice cuántos segundos esperar.

## Si algo falla

- **403**: ese cliente no existe o tu cuenta no tiene acceso. Revisá el slug de la URL; si está bien, pedile a un administrador que te invite.
- **404**: el cliente no tiene brain configurado.
- **No se abre el login**: revisá que la URL termine en `/mcp` y que estés usando la de tu cliente.
