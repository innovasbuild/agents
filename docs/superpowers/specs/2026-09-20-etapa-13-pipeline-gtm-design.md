---
title: Etapa 13 · Pipeline de GTM — target, calificación, enrichment y cola (spec)
fecha: 2026-09-20
estado: aprobada en brainstorming, pendiente de revisión escrita
modelo: Opus 5 (spec) · Sonnet 5 (implementación, sesión nueva)
etapa: 13 (nueva, ver §15)
fuente: docs/superpowers/specs/2026-09-20-orquestacion-plataforma-design.md (Etapa 12, spec y plan en `main` vía PR #29, sin implementar) · docs/superpowers/specs/03-agente-outreach-v1.md (D2, D4, D5, D13, §6.3, §6.4) · docs/superpowers/specs/02-conexiones-innovas.md (D2 catálogo por capacidad, §5.2) · docs/superpowers/specs/2026-09-12-arquitectura-plataforma-design.md (D2, D3) · docs/superpowers/specs/2026-09-19-etapa-5-escucha-followups-design.md (D1, D4) · docs.apollo.io · docs.typesafe.ai · vercel.com/docs/ai-gateway/sdks-and-apis/typesafe
---

# Etapa 13 · Pipeline de GTM

## 1. Qué problema resuelve

Hoy el embudo arranca con un CSV. Alguien consigue una lista por fuera de la plataforma, la carga, y recién ahí el agente investiga, redacta y encola. Todo lo de arriba —decidir a quién buscar, encontrarlo, decidir si vale la pena— pasa en la cabeza de una persona y en pestañas de Apollo.

Esta etapa mete esa parte adentro: una persona define **un foco** (a quién busca y hasta cuánto gastar), y el sistema descubre las empresas y las personas, las califica contra el ICP del cliente, revela el contacto solo de las que pasan, arma la pieza y la deja en la cola que ya existe. El humano sigue decidiendo lo mismo que hoy: qué sale.

Es la primera implementación real del modelo de orquestación de la Etapa 12. Si esa etapa puso los rieles, esta pone el primer tren largo encima.

## 2. Objetivo y criterio de cierre

**Terminado cuando**, contra el deploy de producción y con el tenant `innovas`:

1. Un foco creado desde la app descubre cuentas y contactos reales de Apollo, con su atribución (`vector`, `segment`, `hook`, `idioma`) estampada, y respeta sus topes.
2. Cada contacto descubierto queda calificado por Jev con sus juicios crudos guardados, y cae en uno de los tres carriles (§7.4).
3. **Ningún contacto descartado consume un crédito de revelado.** Verificable en `usage_entries`: los créditos de `leads/reveal-email` son tantos como contactos calificados, no como contactos descubiertos.
4. Un contacto calificado termina con email revelado, ficha de su cuenta y una pieza `pending` en `/cola`, sin intervención.
5. Esa pieza se aprueba y sale por el camino de siempre, con su atribución completa en HubSpot.
6. Un contacto ya trabajado por el otro ejecutor se saltea con `claim_ajeno` y no se le encola nada.
7. Con el presupuesto de `apollo_credits` en cero, el pipeline corta como `budget_exhausted` sin perder ítems.
8. La bandeja "para revisar" lista los de baja confianza y sus dos botones mueven el contacto.
9. `npm test`, `npm run typecheck` y `npm run db:test` en verde.

### 2.1 Entregas

| # | Entrega | Qué deja |
|---|---|---|
| E1 | **Descubrimiento** | `LeadsAdapter` + Apollo + `search_focuses` + workflow `target-search`. Cuentas y contactos en la base, sin calificar |
| E2 | **Calificación** | Workflow `icp-scoring` con Jev, los niveles en config del tenant, los tres carriles |
| E3 | **Enrichment y pieza** | Workflows `contact-enrichment` y `draft-queue`, con cupo diario del ejecutor |
| E4 | **Pantallas** | `/focos` con el embudo y la bandeja de revisión; columna de puntaje en `/contactos` |

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Calificar antes de enriquecer**, invirtiendo dos pasos del flujo original | La búsqueda en Apollo cuesta 1 crédito por página de 100; revelar un email cuesta 1 crédito **por cabeza**. Calificar con lo que la búsqueda ya devolvió gratis y enriquecer solo a los que pasan rinde tantas veces más como sea la tasa de descarte |
| D2 | **Cuatro workflows, no uno** (`target-search`, `icp-scoring`, `contact-enrichment`, `draft-queue`) | Distinto costo, distinta frontera de reintento y distinta razón para volver a correr. Cambiar el ICP re-califica sin re-buscar; un gate que falla tres veces no vuelve a revelar el email |
| D3 | **Ningún workflow de esta etapa pasa de nivel 1.** El último deja la pieza `pending` | Contrato del workflow de la Etapa 12 §5.2 punto 6. El nivel 3 sigue siendo el click humano en `/cola` |
| D4 | **Apollo entra por un `LeadsAdapter`**, no directo | Patrón ya probado con `CrmAdapter`/`createHubSpotAdapter` (spec 02 D2). Es lo que hace barato el segundo tenant y deja convivir a ColdIQ |
| D5 | **Las dos llaves de Apollo de `innovas` viven en `tenant_connections.config` y el adapter las prueba en orden** | Decisión del usuario: verificación por tenant, y con que una tenga crédito alcanza. `config` ya es jsonb: cero migración. El fallback vive en el adapter, no en los nodos |
| D6 | **Jev (`typesafe-ai/jev`) por el AI Gateway**, no por la API directa de TypeSafe | El Gateway lo expone como un modelo más, factura por el mismo lado y devuelve el costo en `providerMetadata.gateway.cost` — el mismo campo que la medición de la Etapa 12 ya lee. No hace falta ninguna credencial nueva |
| D7 | **Un nodo de evaluación fija su modelo; no declara tier** | Los tiers existen porque esos modelos son intercambiables. Jev no lo es: se llama con `evaluate()`, no con `generateText()`. Enmienda a la Etapa 12 (§15) |
| D8 | **`verify_fact` pasa a Jev** (pregunta `noul`), en vez del tier barato que preveía la Etapa 12 | Es exactamente una pregunta de sí/no con probabilidad calibrada, y a $0,04 por millón de tokens de entrada sale 25 veces menos que Haiku |
| D9 | **Los niveles del score se escriben una vez por tenant en `tenants/<slug>/outreach.json`** | La doc de TypeSafe es explícita: los niveles tienen que describir situaciones concretas y sostenerse solos. La página `canon:icp` en prosa no sirve como criterio y **no se toca**: sigue siendo el canon para redactar |
| D10 | **Los juicios crudos se guardan; la decisión es una función pura sobre ellos** | Recomendación de TypeSafe y del artículo de grafos: política explícita, juicios reusables. Cambiar un umbral re-decide sin volver a pagar un token. Por eso el `input_hash` cubre la evidencia y los niveles, **no** los umbrales |
| D11 | **Tres carriles por confianza antes que por puntaje**, con media y baja juntas en un solo carril humano | Con el volumen de `innovas` (decenas por día), separar media de baja es ceremonia sin beneficio |
| D12 | **El foco es la unidad de autorización del gasto.** Crearlo es la autorización; no hay segundo botón | La persona que llena el formulario ve el tope ahí mismo. El presupuesto diario del tenant sigue siendo la red de abajo |
| D13 | **El claim sale del foco:** todo contacto descubierto queda del ejecutor que lo creó | Es la regla de claim que ya rige, aplicada al origen nuevo. Un contacto ya trabajado por otro se saltea, nunca se reasigna |
| D14 | **La `contact_key` se promueve de `li:`/`h:` a `em:` al revelar el email**, y solo mientras el contacto nunca fue tocado | Al descubrir no hay email; la clave canónica del canon es `em:` (spec 03 D4). Sin promoción, el mismo humano cargado por CSV sería un duplicado |
| D15 | **LinkedIn queda fuera de esta etapa**, con el nodo previsto y apagado | Decisión del usuario. Sin API oficial, entra por un tercero (Unipile es el único con arquitectura de API real) y eso es una decisión de proveedor y de costo que no bloquea el resto |
| D16 | **`queue_items.channel` no se toca** | La "cola por canal" que la Etapa 12 anotaba para acá existía por LinkedIn. Con un solo canal, un selector de canal es un desplegable de una opción y una abstracción sin segundo caso que la valide. Cuando entre Unipile, son dos líneas de migración |

## 4. El embudo

```
persona define un foco  ──►  [target-search]  ──►  cuentas + contactos descubiertos
   (autoriza el gasto)          1 créd./100                (sin email)
                                                                │
                                                        [icp-scoring]  ← Jev, sobre datos gratis
                                                                │
                                      descartado ◄──────────────┼──────────────► calificado
                                      (0 créditos)              │
                                                  baja confianza │
                                                  → para revisar │
                                                                │
                                                    [contact-enrichment]
                                                     1 créd./email + research web
                                                                │
                                                        [draft-queue]  ← cupo diario del ejecutor
                                                                │
                                                     pieza `pending` en /cola
                                                                │
                                                    (humano aprueba)  ──►  envío, ya existe
```

### 4.1 Los cuatro workflows en el registry

Siguen el contrato de la Etapa 12 §5.2: el código itera, un ítem que falla no frena al resto, se cuenta lo que entró contra lo que salió.

| Workflow | `subjectType` | `claims` | `produces` | Nodos | Recursos |
|---|---|---|---|---|---|
| `target-search` | `search_focus` | `foco_activo` | `contacto_descubierto` | `leads/search-targets` | `apollo_credits` |
| `icp-scoring` | `contact` | `contacto_descubierto` | `contacto_calificado` | `outreach/icp-score` | `model_usd` |
| `contact-enrichment` | `contact` | `contacto_calificado` | `contacto_listo` | `leads/reveal-email`, `outreach/research` | `apollo_credits`, `model_usd` |
| `draft-queue` | `contact` | `contacto_listo` | — | `outreach/draft`, `outreach/verify-fact`, `outreach/queue` | `model_usd` |

`target-search` entra por `entry: "door"`: lo encola la puerta que crea el foco. Los otros tres encadenan por `produces`/`claims`, que es el mecanismo de `enqueue()` aguas abajo de la Etapa 12 §6.2.

**Una arista de esta etapa no es 1 a 1, y eso obliga a una enmienda.** El encadenamiento de la Etapa 12 asume que un ítem deja otro ítem sobre *el mismo sujeto* (`subjectId` se propaga tal cual). Acá el primer salto es 1 a N y además cambia de tipo: un `search_focus` deja N `contact`. La enmienda (§15, punto 6) es que `ItemOutcome` pueda devolver una lista:

```ts
{ ok: true, downstream: [{ subjectId, inputHash }, ...] }
```

El runner sigue siendo el único que crea aristas aguas abajo; lo que cambia es que puede crear varias. El nodo no llama a `enqueue()` por su cuenta.

**`input_hash` de cada uno:**

| Workflow | Huella |
|---|---|
| `target-search` | `<focoId>:<página>` — cada página de resultados es un ítem propio |
| `icp-scoring` | `<contactId>:<revisión de los niveles del tenant>` — cambiar los niveles re-califica a todos |
| `contact-enrichment` | `<contactId>` — revelar un email es irrepetible por definición |
| `draft-queue` | `<contactId>:<kind>` — una pieza viva por contacto ya lo garantiza el índice único que existe |

### 4.2 Nodo opcional previsto (apagado)

`outreach/account-score`, en `target-search`: califica la **empresa** con Jev antes de buscar personas adentro, y corta el gasto de la búsqueda de personas en las que no pasan. Es la válvula de nodos opcionales de la Etapa 12 §10.1: un tenant con presupuesto más ajustado lo prende, sin que sea otro workflow. Nace apagado porque suma una llamada por empresa y con el volumen de `innovas` no se paga sola todavía.

## 5. Nodos nuevos y el adapter de leads

### 5.1 `LeadsAdapter`

En `lib/connectors/leads/adapter.ts`, espejo de `lib/connectors/crm/adapter.ts`:

```ts
export interface LeadOrganization {
  externalId: string;
  name: string;
  domain: string | null;      // primary_domain de Apollo
  linkedinUrl: string | null;
  employees: number | null;
  industry: string | null;
  location: string | null;
  foundedYear: number | null;
}

export interface LeadPerson {
  externalId: string;
  name: string;
  title: string | null;
  linkedinSlug: string | null;
  organizationExternalId: string | null;
}

export interface LeadsAdapter {
  searchOrganizations(
    criteria: TargetCriteria,
    page: number,
  ): Promise<{ organizations: LeadOrganization[]; hasMore: boolean; creditsUsed: number }>;
  searchPeople(
    criteria: TargetCriteria,
    organizationExternalIds: string[],
    page: number,
  ): Promise<{ people: LeadPerson[]; hasMore: boolean; creditsUsed: number }>;
  revealEmail(
    personExternalId: string,
  ): Promise<{ email: string | null; creditsUsed: number }>;
}
```

`createApolloAdapter(keys: string[], fetchImpl = fetch)`, mismo patrón que `createHubSpotAdapter`: `AbortSignal.timeout`, error tipado `ApolloOutOfCreditsError` y `ApolloUnauthorizedError`, todo lo demás `Error` con el status y los primeros 300 caracteres del cuerpo.

**El fallback entre llaves vive acá:** ante `ApolloOutOfCreditsError`, pasa a la siguiente llave y reintenta una vez. Los nodos no se enteran.

`creditsUsed` se calcula con la regla documentada (1 por página, 1 por email revelado); Apollo no lo informa en la respuesta. Confirmarlo contra su endpoint de uso es el spike S3.

### 5.2 Nodos

| Nodo | Nivel | Modelo | Qué hace |
|---|---|---|---|
| `leads/search-targets` | 1 | — | Una página de empresas + las personas de esas empresas; crea `accounts` y `contacts` |
| `leads/reveal-email` | 1 | — | Revela un email y promueve la `contact_key` (§6.3) |
| `outreach/icp-score` | 1 | `typesafe-ai/jev` | Las tres preguntas de §7 en una request |
| `outreach/verify-fact` | 1 | `typesafe-ai/jev` | Una pregunta `noul`: ¿el texto de la fuente respalda el hecho? |
| `outreach/account-score` | 1 | `typesafe-ai/jev` | Opcional, apagado (§4.2) |

Los nodos que ya existen (`outreach/research`, `outreach/draft`, `outreach/queue`) se reusan sin cambios de contrato.

`verify-fact` se corre sobre el hecho que `draft_message` eligió como ancla, no sobre la ficha entera: verificar lo que nunca sale es pagar de más. Si el hecho no sobrevive, la pieza no se encola y el contacto vuelve con `ancla_no_verificada`.

## 6. El foco de búsqueda

### 6.1 Qué guarda

Un foco es la forma operativa de un vector del canon. `innovas` ya tiene ocho, cada uno con su `default_hook`.

| Campo | Notas |
|---|---|
| `criteria` jsonb | Filtros de Apollo: rangos de empleados, ubicaciones, palabras de rubro, cargos |
| `vector`, `segment`, `hook`, `idioma` | Atribución estampada en cada contacto que salga. Validada contra `config_values` |
| `max_accounts`, `max_contacts` | Techo de esta búsqueda |
| `created_by` | Ejecutor dueño: define el claim |
| `status` | `activo` → `agotado` / `cancelado` |
| `accounts_found`, `contacts_found` | Contadores, para el embudo |

### 6.2 Autorización y claim

Crear el foco **es** la autorización del gasto (D12): el tope está en el formulario. El presupuesto diario de `apollo_credits` del tenant es la red de abajo y corta aunque haya diez focos activos.

Todo contacto descubierto nace con `owner_user_id` = `created_by` del foco. Antes de crearlo corre el guard de claim que ya existe: si esa persona ya es contacto de otro ejecutor, o tiene autoría reciente en el CRM, se saltea con `claim_ajeno`. Nunca se reasigna.

### 6.3 La promoción de la clave

Al descubrir no hay email, así que la `contact_key` nace `li:<slug>` (Apollo devuelve el LinkedIn) o `h:<sha1(nombre|empresa)>`. La clave canónica del canon es `em:<email>` (spec 03 D4).

**Regla:** al revelar el email, `leads/reveal-email` promueve la clave con un `UPDATE` guardado por el índice único `(tenant_id, contact_key)`.

- Si el `UPDATE` pasa: el contacto sigue, ahora con clave canónica.
- Si choca con `23505`: esa persona ya existía en la base. El descubrimiento se marca `duplicado` y se descarta. **No se fusiona nada**, que sería un subsistema entero.

**Invariante que lo hace seguro:** la clave solo se promueve mientras el contacto no tiene eventos ni piezas. El enrichment pasa siempre antes del primer toque, así que para cuando la atribución llega a HubSpot la clave ya está congelada. `leads/reveal-email` lo chequea y refusa `contacto_ya_tocado` si no se cumple.

## 7. Calificación con Jev

### 7.1 La llamada

`evaluate()` (`experimental_evaluate` de `ai`) con `model: "typesafe-ai/jev"`, una request por contacto con las tres preguntas juntas: preguntas independientes sobre el mismo estado corren en paralelo y no se ven entre sí.

**Estado:** la persona (nombre, cargo) y la empresa (dominio, empleados, rubro, ubicación, año fundación) — todo lo que la búsqueda ya devolvió gratis. Sin email, sin research web.

| Pregunta | Tipo | Qué decide |
|---|---|---|
| `encaje_empresa` | `score` | Qué tan bien la empresa entra en el ICP |
| `rol_decisor` | `score` | Si la persona está parada donde se decide esto |
| `excluir` | `noul` | Descalificadores duros: competidor, ya cliente, proveedor |

El estado se arma con campos JSON nombrados, como pide la doc de TypeSafe, y se envía con `providerOptions: { gateway: { zeroDataRetention: true } }`: son datos personales de terceros pasando por un modelo.

### 7.2 Los niveles, en config del tenant

En `tenants/<slug>/outreach.json`, al lado de los vectores y hooks que ya están ahí, cargados por el mismo `npm run outreach:config`:

```json
"icp": {
  "revision": "2026-09-20",
  "encaje_empresa": [
    "No es del universo: rubro ajeno, tamaño fuera de rango, o sin operación propia",
    "Podría ser: entra en tamaño y geografía pero no se ve el problema que resolvemos",
    "Encaja: tamaño, rubro y señales de operación creciendo más rápido que su método"
  ],
  "rol_decisor": [
    "Sin relación con esta decisión: otra área, o rol sin injerencia en cómo opera la empresa",
    "Influye: sufre el problema o lo reporta, pero no aprueba el gasto",
    "Decide: dueño, dirección o gerencia con control sobre el presupuesto de operación"
  ],
  "excluir": "La empresa es competidora, ya es cliente, o es proveedora nuestra"
}
```

`revision` entra en el `input_hash` del scoring: tocar los niveles re-califica a todos, sin tocar nada aguas arriba.

La página `canon:icp` en prosa no se toca y sigue siendo lo que lee `draft_message`.

### 7.3 La política vive en código

Se guardan los juicios crudos en `contacts.icp`: los tres puntajes, sus probabilidades, sus confianzas, el modelo y la fecha. La **decisión** es una función pura en `lib/outreach/icp.ts` que los lee, con umbrales de `tenant_agents.config`.

Consecuencia: cambiar un umbral re-decide a todos sin volver a llamar a Jev. Por eso el `input_hash` cubre evidencia y niveles, no umbrales.

### 7.4 Los tres carriles

| Resultado | Carril | Qué pasa |
|---|---|---|
| Confianza ≥ umbral y puntaje ≥ umbral, `excluir` bajo | `calificado` | Sigue solo al enrichment |
| Confianza ≥ umbral y puntaje < umbral, o `excluir` alto | `descartado` | Cero créditos. Queda la razón |
| Confianza < umbral | `para_revisar` | No gasta ni descarta. Espera a una persona |

**Cuál confianza**, porque son tres preguntas: la **mínima entre las confianzas de las preguntas que la decisión efectivamente usó**. Si `excluir` viene con probabilidad baja, su confianza no entra en la cuenta; si es la que dispara el descarte, sí.

Umbrales de arranque, conservadores y en config: con tres niveles el puntaje va de 0 a 2, así que `encaje_empresa ≥ 1.5` (claramente inclinado al nivel alto), `rol_decisor ≥ 1.0`, `confidence ≥ 0.7`, `excluir ≤ 0.2`.

### 7.5 El ancla

Un modelo que califica no puede ser juzgado por sus propios números (Etapa 12 §8.2). Los anclajes existen desde el día uno sin construir nada: `contacts.icp` guarda lo que Jev dijo, y `events` ya registra qué se aprobó, qué se editó y quién respondió. El contraste "lo que Jev puntuó alto" contra "lo que el humano aprobó y el mercado contestó" es una query.

**Los umbrales no se aflojan hasta tener ese contraste con datos reales.** Es regla congelada: ningún nodo los escribe (Etapa 12 §8.3).

## 8. Modelo de datos

Todo con `tenant_id`, RLS de lectura por `is_member_of` o `is_platform_admin`, escritura revocada a `authenticated` y `anon`. Antes de escribir SQL, cargar `supabase-postgres-best-practices`.

### 8.1 `search_focuses` (nueva)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | FK `tenants`, cascade |
| `created_by` | uuid | FK compuesta `(tenant_id, created_by)` → `executors`, como hace `contacts.owner_user_id` |
| `name` | text | |
| `criteria` | jsonb | |
| `vector`, `segment`, `hook`, `idioma` | text | Validados contra `config_values` por la puerta |
| `max_accounts`, `max_contacts` | integer | `> 0` |
| `status` | enum `search_focus_status` | `activo`, `agotado`, `cancelado` |
| `accounts_found`, `contacts_found` | integer | default 0 |
| `created_at`, `updated_at` | timestamptz | |

Índice `(tenant_id, status)` para el sembrador del workflow.

### 8.2 `accounts` (alter)

`+ firmographics jsonb default '{}'` (lo que devolvió Apollo) y `+ external_ids jsonb default '{}'` (`{"apollo": "..."}`). `ficha` sigue siendo la salida del research web, sin tocar.

Una empresa sin `primary_domain` se descarta con `sin_dominio`: `accounts` es única por `(tenant_id, domain)` y sin dominio no hay research ni ancla posible.

### 8.3 `contacts` (alter)

| Columna nueva | Notas |
|---|---|
| `title` | El cargo. Hoy no existe, y lo necesitan el scoring y la redacción |
| `search_focus_id` | FK `search_focuses`, nullable |
| `icp` | jsonb default `{}`: juicios crudos, modelo, fecha, revisión de los niveles |
| `external_ids` | jsonb default `{}` |

`source` extiende su check a `('csv', 'chat', 'apollo')`.

### 8.4 `tenant_budgets`

Entra `apollo_credits` como recurso, al lado de `model_usd`. Sin fila, el límite es cero: nada desatendido gasta créditos sin presupuesto explícito (Etapa 12 §10.2).

### 8.5 `tenant_connections`

Sin cambio de esquema. El binding `leads`/`apollo` de `innovas` guarda las dos llaves en `config`:

```json
{ "connectorUids": ["innovas-apollo-mati", "innovas-apollo-marcos"] }
```

El builder del catálogo arma el adapter con esa lista, en orden.

## 9. Cola y pantallas

### 9.1 La cola no se toca

D16. `queue_items.channel` queda con su check en `'email'`. Cuando entre LinkedIn, esa migración son dos líneas y recién ahí un selector de canal tiene dos opciones que mostrar.

### 9.2 `/focos` (nueva)

Tres cosas y nada más:

1. **Crear un foco:** filtros, atribución (vector con su hook por default), topes.
2. **Lista de focos** con sus contadores y su estado.
3. **El embudo de cada foco**, leído de `contacts` y `work_items`:

```
descubiertos 210 ─► calificados 38 ─► enriquecidos 38 ─► encolados 12 ─► enviados 9
                 ├─ descartados 141
                 └─ para revisar 31
```

**La bandeja "para revisar" es la única superficie interactiva nueva:** cada fila con su puntaje, su confianza y sus razones, y dos botones (calificar / descartar). Es nivel 0: un click humano sobre datos ya pagos. Calificar encola el enrichment por `enqueue()`; descartar cierra el contacto con su razón.

### 9.3 `/contactos` (crece)

Suma la columna de puntaje ICP y su filtro. Nada más: `/metricas` ya existe y la observabilidad fina es la Etapa 9.

## 10. Manejo de errores

| Caso | Qué pasa |
|---|---|
| Apollo sin crédito en la primera llave | El adapter pasa a la segunda y reintenta una vez |
| Apollo sin crédito en ninguna | `ApolloOutOfCreditsError` → el ítem vuelve a `pending` con espera; el presupuesto del tenant probablemente ya cortó antes |
| Apollo 429 (rate limit ~50/min) | Excepción → reintento con espera creciente del runner. El tope de ítems por tick mantiene el ritmo lejos del límite |
| Empresa sin dominio | `refused: sin_dominio`. No se crea `accounts` |
| Persona ya contacto de otro ejecutor | `refused: claim_ajeno` |
| `em:<email>` ya existe al promover la clave | `refused: duplicado`. No se fusiona |
| Contacto ya tocado al querer promover | `refused: contacto_ya_tocado` |
| Jev con confianza baja | Carril `para_revisar`. No es error |
| Jev devuelve una forma inesperada | Excepción → reintento; al tercero, `failed` visible |
| Ancla que no sobrevive a `verify-fact` | `refused: ancla_no_verificada`. No se encola |
| Cupo diario del ejecutor agotado | `draft-queue` corta para ese ejecutor y sigue mañana. Los ítems quedan `pending` |
| Foco que llega a su tope | `status = agotado`. Los ítems restantes no se reclaman |

## 11. Testing

- **`createApolloAdapter`** con `fetch` inyectado y fixtures de respuestas reales anonimizadas, igual que `hubspot-adapter`: paginación, sin dominio, sin crédito (fallback a la segunda llave), 429, 401.
- **`lib/outreach/icp.ts`** (la política) con TDD: los tres carriles, `excluir` que gana sobre un puntaje alto, confianza al borde del umbral, forma inesperada.
- **La promoción de clave**, con un fake store: promueve, choca con `23505` → duplicado, refusa si el contacto ya fue tocado.
- **Los cuatro workflows** con `LeadsAdapter` falso y el `store` falso de la Etapa 12: la cuenta cierra, un ítem que explota no corta el loop, ningún workflow invoca un nodo de nivel 3, el cupo corta.
- **`supabase/tests/`**: RLS de `search_focuses` (fuga entre tenants, `authenticated` no escribe), y que las columnas nuevas de `contacts` y `accounts` respeten las policies que ya existen.
- **Evals** del scoring con casos etiquetados a mano: 20 contactos reales con su veredicto humano, para medir a Jev antes de confiar en los umbrales.

## 12. Spikes

| # | Pregunta | Bloquea a | Si da que no |
|---|---|---|---|
| S1 | ¿`evaluate()` devuelve `confidence` en `providerMetadata.typesafe` o dentro de cada answer? La doc de Vercel y la de TypeSafe difieren | `icp-scoring` | Leer defensivo de los dos lugares, con test que fije la forma observada |
| S2 | ¿`evaluate()` devuelve `usage` y `providerMetadata.gateway.cost` con la misma forma que `generateText`? | La medición de esta etapa | Parser propio para la respuesta de evaluación, y `MODEL_PRICES` con `typesafe-ai/jev` como respaldo |
| S3 | ¿Apollo informa créditos consumidos por llamada, o hay que calcularlos por la regla documentada? | `usage_entries` de `apollo_credits` | Se calcula por regla (1/página, 1/email) y se concilia contra el endpoint de uso una vez por día |
| S4 | ¿Qué devuelve Apollo exactamente cuando se queda sin créditos (status y cuerpo)? | El fallback entre llaves | Se trata cualquier 4xx no-401 con "credit" en el cuerpo como agotamiento, y se ajusta con el caso real |
| S5 | ¿Cuántos contactos por empresa devuelve la búsqueda de personas con los filtros de cargo del canon, y cuántas páginas hacen falta? | Los topes del foco | Se arranca con topes chicos (5 empresas, 20 contactos) y se sube con datos |

S1 y S2 son la primera tarea de E2; S3, S4 y S5 son de E1.

## 13. Fuera de alcance

- **LinkedIn** (pedido de conexión, espera de aceptación, DM) y la elección de proveedor (D15).
- **Cola por canal y aprobación por lote** (D16): vuelven con LinkedIn.
- WhatsApp y otros canales: Etapa 8 y 10.
- **Fusión de contactos duplicados**: se detecta y se descarta, no se fusiona (D14).
- Que el agente del chat dispare una búsqueda conversando. El foco se crea por pantalla en esta etapa; exponerlo como tool del chat es una línea más adelante, cuando la forma esté asentada.
- ColdIQ y Google Places como fuentes del pipeline: el `LeadsAdapter` deja el lugar, pero la única implementación de esta etapa es Apollo.
- Reporting por foco más allá del embudo: Etapa 9.
- `outreach/account-score` prendido (§4.2).

## 14. Riesgos

- **Calidad del ICP scoring sin calibrar.** Jev puede estar sistemáticamente corrido para este dominio y nadie se entera hasta descartar a alguien bueno. Mitigación: los descartados **quedan en la base con su razón** (no se borran), las evals con veredicto humano de §11, y umbrales conservadores hasta tener el contraste de §7.5.
- **Créditos de Apollo en cuenta de prueba (~100/mes).** Una búsqueda mal acotada consume el mes. Mitigación: topes del foco, presupuesto de `apollo_credits`, y D1 —que es justamente lo que hace que 100 créditos rindan.
- **Rate limit de Apollo (~50 req/min, tope diario por plan).** Mitigación: ítems por tick chicos, espera creciente, y el reloj de pasada del runner.
- **Calidad de los datos de Apollo.** Cargos desactualizados, gente que ya no trabaja ahí, dominios genéricos. Mitigación: el research web de la cuenta corre igual antes de redactar, y `verify-fact` protege el ancla.
- **Datos personales de terceros pasando por un modelo.** Mitigación: `zeroDataRetention` en las llamadas a Jev, RLS por tenant, y nada de PII en logs.
- **Volumen que tapa la cola.** 200 descubiertos pueden volverse 40 piezas y desbordar el cupo diario. Mitigación: `draft-queue` respeta `executors.daily_quota` y encola de a poco; el resto espera como `contacto_listo`.
- **La reputación de la casilla** con volumen nuevo de gente fría. Mitigación: el cupo diario y el gate de estilo que ya existen; no se toca nada de eso acá.
- **Dependencia de la Etapa 12 sin implementar.** Su spec y su plan están en `main` (PR #29), pero los rieles (`work_items`, runner, dispatcher, `usage_entries`) todavía no existen como código. Esta etapa no arranca hasta que estén.

## 15. Enmiendas

### A la spec de la Etapa 12 (`2026-09-20-orquestacion-plataforma-design.md`)

1. **§9.1, `NodeInfo`:** suma `model?: string` para nodos que fijan un modelo de evaluación. `tier` queda `null` en esos casos (D7).
2. **§8.1, `verify_fact`:** pasa de tier barato a `typesafe-ai/jev` con una pregunta `noul` (D8).
3. **§9.3, test de llamadas al modelo:** la regla que exige `metered()` en todo archivo que importa `generateText` tiene que cubrir también `evaluate`/`experimental_evaluate`.
4. **§7.2, `MODEL_PRICES`:** suma `"typesafe-ai/jev": { input: 0.04, output: 0 }` como respaldo del costo informado por el Gateway.
5. **§14.1, Etapa 13:** "cola por pieza y por lote, con cambio de canal" sale del alcance y vuelve con LinkedIn (D15, D16).
6. **§9.2 y el tipo `ItemOutcome`:** un ítem puede dejar **varios** ítems aguas abajo, y de otro `subjectType`. `{ ok: true, downstreamHash?: string }` pasa a admitir `{ ok: true, downstream?: Array<{ subjectId: string; inputHash: string }> }`. El runner sigue siendo el único que crea aristas; ahora puede crear más de una (§4.1).

### Al roadmap (`docs/01-roadmap-etapas.md`)

La Etapa 13 se agrega con las cuatro entregas de §2.1, después de la 12 y antes de la 7, con el orden ya acordado: **5 → 12 → 13 → 7**. **Aplicado el 2026-09-20**, junto con las enmiendas al kickoff de abajo, en un PR propio posterior al #30 que trajo esta spec.

### Al kickoff (`docs/innovas-agents-kickoff.md`)

- **§1, fila "Prospectos":** el orden pasa a ser lista propia (CSV) + **Apollo** + ColdIQ + Google Places. Apollo es la fuente del pipeline; las otras quedan disponibles por el mismo adapter.
- **§10, "LinkedIn automático":** sigue fuera, ahora con el motivo registrado (proveedor tercero sin decidir) y el lugar donde entra (D15).

## 16. Referencias

- Apollo: [organization search](https://docs.apollo.io/reference/organization-search) (`POST /api/v1/mixed_companies/search`, `x-api-key`, 1 crédito por página de 100, tope 50.000 registros), [people search](https://docs.apollo.io/reference/people-api-search) (no devuelve emails), enrichment (1 crédito por email, 5 por teléfono), [uso y rate limits](https://docs.apollo.io/reference/view-api-usage-stats).
- TypeSafe: [System One](https://docs.typesafe.ai/concepts/system-one.md), [primitivo Score](https://docs.typesafe.ai/primitives/score.md), [confidence](https://docs.typesafe.ai/confidence.md).
- Vercel: [TypeSafe con AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe), [Jev y el AI SDK](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), [modelo `typesafe-ai/jev`](https://vercel.com/ai-gateway/models/jev).
- LinkedIn (diferido): Unipile es el único de los tres evaluados con arquitectura de API para integrar desde un backend propio; PhantomBuster y HeyReach son herramientas de campaña operadas por una persona. Límite seguro de la industria en 2026: 20-40 pedidos de conexión por día.
