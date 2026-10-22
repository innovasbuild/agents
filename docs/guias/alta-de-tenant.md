---
title: Alta de una empresa nueva
category: guias
status: activo
tags: [tenant, alta, consola, plataforma, onboarding]
updated: 2026-10-22
sources:
  - app/plataforma/nueva/page.tsx
  - app/plataforma/nueva/actions.ts
  - app/plataforma/nueva/create-form.tsx
  - app/plataforma/[slug]/page.tsx
  - app/plataforma/[slug]/console-actions.ts
  - lib/tenants/tenant-create.ts
  - lib/tenants/readiness.ts
  - lib/tenants/home.ts
  - lib/agents/catalog.ts
  - lib/outreach/canon-templates.ts
  - lib/outreach/canon-seed.ts
  - docs/superpowers/specs/2026-10-10-etapa-21-1-consola-conectores-design.md
  - docs/superpowers/specs/2026-10-11-etapa-21-4-segundo-tenant-design.md
  - docs/superpowers/plans/2026-10-11-etapa-21-4a-empresa-sin-agentes.md
---

# Alta de una empresa nueva

> **Esta guía es para las empresas Enterprise.** Desde la Etapa 27.1 una persona con correo de trabajo puede crear sola su empresa (plan Free) desde `/empezar`, sin pasar por plataforma: ver [alta self-serve y planes](../dominios/onboarding.md). El alta de plataforma sigue siendo el camino para Enterprise, es decir, empresas con acompañamiento, presupuesto fijado a mano, ingreso abierto por dominio o conectores propios.

Se hace entera desde el navegador, como administrador de plataforma (`platform_admin` del tenant dueño de la plataforma, `PLATFORM_OWNER_TENANT_SLUG`), sin terminal. La consola está en `/plataforma`; el alta, en `/plataforma/nueva`; el detalle de cada empresa, en `/plataforma/[slug]`. Qué hace cada rol y cómo se aíslan las empresas está en [plataforma](../dominios/plataforma.md), [tenancy](../arquitectura/tenancy.md) e [identidad y acceso](../arquitectura/identidad-y-acceso.md).

En los ejemplos la empresa es `acme`, con dominio `acme.test`. Reemplazalos por los datos reales.

## Antes de empezar

- Tenés que ser administrador de plataforma. Si no, `/plataforma` da 404.
- Tené a mano: el nombre de la empresa, el slug (minúsculas, números y guiones, empieza con letra; no puede ser una palabra reservada como `api`, `brain`, `login` o `plataforma`), los dominios de correo de la empresa, el correo de la primera persona administradora y los colores y el logo si los hay.
- Si la empresa va a tener conectores con llave (leads, por ejemplo), la llave se la pasa el cliente a INNOV.AS por un canal seguro y se carga en Vercel Connect antes del paso 4. Seguí [llaves de clientes](llaves-de-clientes.md): la consola nunca pide ni muestra una llave.

## Pasos

1. **Crear la empresa.** Entrá a `/plataforma/nueva` y completá: nombre, slug, dominios permitidos, métodos de ingreso (`email` = código por correo, `google`, `microsoft`), agentes (cero, uno o más del catálogo `lib/agents/catalog.ts`: `asistente` y `outreach`; vienen todos tildados, destildá los que la empresa no use. El Asistente necesita brain y no siembra canon: solo conversa con lo que la empresa escribe en el brain), colores primario y secundario como `#RRGGBB`, logo y el correo de la primera persona administradora. Si ese correo no es de los dominios permitidos, la consola lo rechaza salvo que marques "Permitir correo externo". Al guardar, una sola transacción crea la empresa, una fila de `tenant_agents` por agente elegido y el evento `tenant.created`. El logo y la invitación van aparte: si fallan, la empresa queda creada y la consola avisa con una advertencia, y no hay que volver a crearla.

2. **Entrar al detalle.** Abrí `/plataforma/acme`. Arriba está "Qué falta", que calcula `tenantReadiness`: sin agentes ni brain, sin brain, faltan conectores, conectores sin verificar, falta el ICP o los hooks en el brain. El objetivo es llegar a "Lista para trabajar". Una empresa que usa solo el brain (sin agentes) queda lista con el brain creado.

3. **Habilitar agentes.** En la sección Agentes, cada fila del catálogo tiene un interruptor y, si el agente declara acceso al brain, un selector (Sin acceso, Lectura, Lectura y escritura). Guardar llama a `platform_set_agent`. Un agente que requiere el brain (`requiresBrain`, hoy `asistente` y `outreach`) no se deja habilitar hasta que el brain exista: si la consola dice "Creá el brain primero", hacé el paso 4 y volvé.

4. **Crear el brain.** En la sección Brain, "Crear brain". Nace con las categorías `empresa`, `producto`, `comercial` y `operacion` y el proveedor `wiki`. Si la empresa ya tiene habilitado un agente que usa el canon, la consola también siembra las páginas `comercial/icp` y `comercial/hooks` como borrador. Si todavía no tiene agente, el brain nace vacío y esas páginas se siembran recién cuando se habilita el agente (nunca se pisa una página existente). Ajustá las categorías en el mismo bloque (entre 1 y 20; no se puede quitar una que tenga páginas); si el agente usa el canon, la categoría `comercial` tiene que estar. Quitar o recrear el brain no existe como botón.

5. **Asociar los conectores.** En la sección Conectores, "Asociar conector": elegí el proveedor (`hubspot`, `coldiq`, `apollo`, `google-places`, `gmail`) y, si es de llave, pegá el identificador del conector creado en Vercel. `hubspot` y `gmail` no llevan identificador: cada persona autoriza su cuenta después, desde "Mis cuentas". En Vercel, la consola le pregunta a Vercel si el conector existe y está adjunto al proyecto antes de guardarlo; un identificador ya asociado a otra empresa se rechaza. Los conectores con llave quedan "Sin verificar" hasta apretar Verificar (en un deploy). Qué proveedores existen y cómo se agregan otros: [agregar un conector](agregar-un-conector.md).

6. **Fijar los presupuestos.** En Presupuestos, el límite diario de cada recurso medido. Sin fila el límite es cero y los workflows desatendidos de esa empresa no corren ([orquestación](../arquitectura/orquestacion.md)).

7. **Sembrar el canon (solo si hay agente de outreach).** Pedile a la persona administradora que complete en el brain las páginas `comercial/icp` y `comercial/hooks`: sacar el `# ` a las líneas de ejemplo de los bloques `icp`, `hooks` y `vectores`, poner las suyas y pasar la página a estado activo (lo explica la plantilla). Guardar la página de hooks actualiza `config_values` sola. Mientras falten, "Qué falta" muestra "falta el ICP en el brain" o "faltan hooks y vectores en el brain".

8. **Invitar a las personas.** La primera persona administradora ya recibió la invitación en el paso 1 (con destino `/acme`, que decide a dónde aterriza según los agentes). Las demás se invitan desde `/[tenant]/settings/usuarios`, o sea `/acme/settings/usuarios` (el enlace "Administrar" de la sección Usuarios del detalle): correo y rol (`tenant_admin` o `tenant_member`). Cada miembro nuevo nace lector de todo el brain; los permisos por carpeta y por página se ajustan en `/acme/brain` ([brain](../dominios/brain.md), [invitaciones y usuarios](../dominios/invitaciones-y-usuarios.md)). Si no querés que cualquiera con un correo del dominio entre solo, dejá el ingreso por dominio apagado: es lo que hace que el acceso sea solo por invitación.

9. **Que cada persona conecte sus herramientas.** Desde `/acme/conectar` obtiene la URL del brain y del agente con las instrucciones para su cliente MCP: [conectar el brain](conectar-brain-por-mcp.md) y [conectar el agente](conectar-agente-por-mcp.md).

10. **Configuración del cliente.** La persona administradora completa lo suyo en `/acme/settings` (ejecutores, aprobaciones de nivel 2, modelo, ingreso) y, con outreach, en `/acme/settings/outreach` (segmentos, idiomas, procesos automáticos).

11. **Comprobar.** Entrá con la persona administradora y verificá: aterriza donde corresponde (el chat con un agente de chat, `/acme/brain` solo con brain, `/acme/conectar` en otro caso), el menú muestra solo lo de sus agentes y las pantallas de un agente apagado dan 404. En `/plataforma` la empresa figura "Listo".

12. **Dominio propio (opcional).** Si el cliente quiere entrar por su dominio, seguí [dominio de un cliente](dominio-de-un-cliente.md).

## Qué va a fallar si te olvidás de algo

| Te olvidaste de | Qué pasa |
|---|---|
| Crear el brain antes de habilitar un agente que lo requiere | La consola rechaza el agente: "Este agente necesita el brain. Creá el brain primero." |
| La categoría `comercial` en el brain de una empresa con outreach | El brain queda creado pero la siembra falla; hay que agregar la categoría y crear a mano `comercial/icp` y `comercial/hooks` |
| Verificar los conectores con llave | "Qué falta" muestra "conectores sin verificar" |
| Un conector para una capacidad que el agente usa (`crm`, `leads`, `mail` en `outreach`) | "Qué falta" muestra "faltan conectores" |
| El presupuesto | Los workflows de esa empresa no corren: sin fila el límite es cero |
| Pasar a activo el ICP y los hooks | "Qué falta" muestra el ICP o los hooks |
| Que el correo de la persona administradora sea del dominio permitido | `/plataforma/nueva` no deja crear (o hay que marcar "Permitir correo externo") |

Los tests que cubren estos comportamientos: `tests/tenants/readiness.test.ts`, `tests/tenants/tenant-create.test.ts`, `tests/plataforma/` y, en la base, `supabase/tests/29_platform_console.test.sql` y `supabase/tests/33_agentless_tenant.test.sql`.

## Lo que no pude verificar

- La secuencia completa en un entorno real: se armó leyendo el código, la spec 21.1, la spec 21.4 y el plan 21.4a, no corriendo el alta (Docker apagado al escribir esta guía).
- El cierre de un alta en producción (cronometrar el alta, probar la conexión con el asistente de una persona de la empresa, comprobar que los correos de la plataforma no caen en cuarentena) está en la spec 21.4 §11. El plan 21.4b que lo ejecuta no está escrito en el repo, así que esta guía no lo repite.
- Qué ve exactamente una persona invitada cuyo link ya se gastó (el flujo de código por correo, spec 21.4 §5.4): la spec dice que se prueba en local, no hay resultado escrito.
- Que "cada miembro nuevo nace lector de todo el brain" siga siendo así: sale de la spec 21.4 (T10) y de las reglas de la etapa 17; no lo re-verifiqué en SQL.
