# Central IA (INNOV.AS Agents Platform)

Plataforma multi-tenant de agentes durables que INNOV.AS opera para sus clientes. Cada cliente es un tenant con su brain, sus agentes, sus conexiones (CRM, mail, fuentes de datos) y su gente; `innovas` es el primer tenant y funciona igual que cualquier otro. El primer agente es el de outreach comercial.

El producto se llama **Central IA**: un brain por empresa con permisos granulares, agentes preparados para tareas concretas y las herramientas de la empresa conectadas, todo disponible en la plataforma y por MCP. Stack: Next.js 16, [eve](https://eve.dev/docs) (agentes de Vercel), Supabase (base, auth y RLS) y Vercel.

## Requisitos

- Node 24 o más (`.nvmrc`; `engine-strict` está prendido).
- Docker abierto: Supabase corre local en contenedores. La CLI de Supabase va por `npx`, no hace falta instalarla.
- `gh` autenticado, y una cuenta de Vercel con acceso al proyecto (solo para las llaves de los modelos).
- gstack en `~/.claude/skills/gstack` si vas a trabajar con Claude Code (un hook lo verifica al abrir la sesión).

## Instalación

Clonar e instalar dependencias:

```bash
git clone git@github.com:innovasbuild/agents.git && cd agents
```

```bash
nvm use && npm ci
```

Levantar la base local (primera vez: baja las imágenes) y aplicar migraciones y datos de prueba:

```bash
npm run db:start
```

```bash
npm run db:reset
```

Crear `.env.local` con las llaves de **la base local**. `npx supabase status -o env` las imprime:

```bash
npx supabase status -o env
```

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
PUBLIC_APP_URL=http://localhost:3000
PLATFORM_OWNER_TENANT_SLUG=innovas-seed
```

El chat y el agente llaman a modelos por el AI Gateway de Vercel. Para eso, `vercel link`, `vercel env pull .env.vercel` y copiar `VERCEL_OIDC_TOKEN` (o `AI_GATEWAY_API_KEY`) a `.env.local`. **No uses el `.env.local` que baja Vercel tal cual**: apunta a la Supabase de la nube. Sin esta llave todo funciona menos lo que gasta modelo.

Levantar la app:

```bash
npm run dev
```

## Primer ingreso en local

Se entra con un código de seis dígitos por mail; el mail local llega a Mailpit en <http://127.0.0.1:54324>. Los usuarios del seed (`admin-seed@innov.as`, `ana@demo.test`) no reciben código, así que se entra con un mail nuevo `@demo.test` por <http://localhost:3000/login/demo>, después de abrir esa empresa al ingreso por dominio:

```bash
docker exec supabase_db_agents psql -U postgres -c "update tenants set self_signup_by_domain = true where slug = 'demo'"
```

El detalle y los problemas conocidos están en [Instalación local](docs/guias/instalacion-local.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run typecheck` | Tipos (genera los de rutas primero) |
| `npm test` | Tests unitarios (no necesitan Docker) |
| `npm run lint:fix` | Biome, con arreglos |
| `npm run db:start` · `db:reset` · `db:test` · `db:types` | Base local (necesitan Docker) |
| `npm run docs:sync` · `docs:check` | Regenera la referencia de la wiki / la verifica |

La lista completa está en [docs/referencia/comandos.md](docs/referencia/comandos.md).

## Documentación

Todo arranca en el [índice de la documentación](docs/README.md):

- [Arquitectura](docs/arquitectura/orquestacion.md): cómo encaja todo.
- [Dominios](docs/README.md): un módulo por página (agentes, outreach, brain, workflows, conectores...).
- [Guías](docs/guias/documentar.md): cómo hacer cada cosa.
- [Referencia](docs/referencia/tablas.md): tablas generadas desde el código.
- [Decisiones](docs/decisiones/README.md): una fila por spec y por PR.

## Cómo se trabaja

Una sesión por etapa: spec, plan, código con tests, `/ship`. Las reglas del repo están en [CLAUDE.md](CLAUDE.md) y la forma de mantener la wiki en [docs/guias/documentar.md](docs/guias/documentar.md).
