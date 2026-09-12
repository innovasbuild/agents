## gstack (REQUIRED)
test -d ~/.claude/skills/gstack/bin && echo GSTACK_OK || echo GSTACK_MISSING
Si falta: STOP y pedir instalación.

## Reglas del repo
- Etapas en docs/innovas-agents-kickoff.md. Una sesión por etapa; /context-save al cerrar.
- Antes de escribir código de eve, leer node_modules/eve/docs/README.md y la guía del slot que tocás.
- Antes de tocar SQL, cargar supabase-postgres-best-practices. Toda tabla lleva tenant_id y RLS.
- Toda tool con efecto externo lleva `approval` explícito.
- events es append-only. Nunca UPDATE/DELETE.
- Nada específico de un tenant en código. Va a tenants/<slug>/ o a la base.
- Español rioplatense en UI, instrucciones y skills. Código e identificadores en inglés.
- Comandos: npm run dev · npm run typecheck · npm test · npm run lint:fix
- Base: npm run db:start · npm run db:reset · npm run db:test · npm run db:types (necesitan Docker abierto)

## Skill routing
Diseño nuevo → superpowers:brainstorming · Bug → /investigate · Probar en navegador → /qa · PR → /ship
