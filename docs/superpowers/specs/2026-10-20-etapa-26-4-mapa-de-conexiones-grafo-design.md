# Etapa 26.4 · Mapa de conexiones como grafo — diseño

**Fecha:** 2026-10-20
**Etapa:** 26, entrega 26.4 (la numeración es propuesta; al aprobar se agrega al roadmap). No depende de la 26.1b ni de la 26.3.
**Base:** `2026-09-27-editor-brain` (índice de links y mapa actual), `2026-10-05-etapa-17-permisos-brain-design.md` (permisos por carpeta) y `2026-10-14-etapa-26-carpetas-y-reglas-brain-design.md` (categoría = primer segmento de la ruta).
**Antecedente en código:** `app/[tenant]/brain/mapa/page.tsx` (listas por categoría, huérfanas y links rotos), `lib/brain/core/links.ts` (`LinkIndex`) y `lib/brain/adapters/editor.ts` (`loadBrainMeta`, `loadBrainLinkIndex`).

## 1. Objetivo y criterio de cierre

Hoy "Mapa de conexiones" es una lista: sirve para auditar, pero no deja ver cómo se conecta el conocimiento de una empresa. Pedido de Matías (2026-10-20): que el botón abra una vista de grafo a pantalla completa, estilo Obsidian, que aguante un brain que todavía no sabemos cuánto va a crecer, con filtros, colores y zoom; que el tamaño de cada nodo sea relativo a sus conexiones; y que un clic en un nodo muestre un popover con el título, la fecha de última edición y un botón para ir a la página. Nada más en el popover. La vista actual no se pierde: queda como segunda vista.

**Terminado cuando**, en producción:

1. "Mapa de conexiones" abre el grafo a pantalla completa con todas las páginas que la persona puede ver (hasta el tope de D8; por encima, con un aviso), y un selector lleva a la lista de hoy, sin cambios.
2. Una página con muchas conexiones se ve claramente más grande que una con una sola.
3. Un clic en un nodo abre un popover con título, fecha de última edición y "Ver página"; el botón navega a la página.
4. Filtrar por categoría, por "huérfanas" y por texto actualiza el grafo sin recargar.
5. Una persona sin acceso a una carpeta no ve esos nodos, y esas páginas tampoco viajan en la respuesta del servidor.
6. Un brain sintético de 10.000 páginas se puede recorrer con zoom y paneo sin trabarse (D8), y un brain de 1.001 páginas se ve completo (D9).
7. `npm run docs:check` en verde y la página del dominio brain actualizada.

**Anti-objetivos** (si pasa alguno, falló aunque funcione): que el grafo muestre algo que la persona no puede ver; que un brain grande cuelgue la pestaña; que se pierda la lista actual de huérfanas y links rotos.

**Fuera de alcance:** editar desde el grafo (crear links arrastrando), vista 3D, flechas de dirección, extractos o resúmenes en el popover, tiempo real, compartir un grafo, guardar posiciones entre visitas.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Una ruta, dos vistas.** `/brain/mapa` muestra el grafo por defecto en pantallas de escritorio y la lista por defecto en pantallas angostas (menos de `md`); `?vista=grafo\|lista` lo fija. El botón de `brain/page.tsx` sigue apuntando a `/brain/mapa`. **Cómo se decide el defecto:** el servidor no conoce el ancho, así que renderiza siempre la lista como base y el grafo es un componente solo de cliente que, sin `?vista`, se monta encima (D2) únicamente cuando `matchMedia("(min-width: 768px)")` da verdadero. En celular se ve la lista de entrada, sin salto | El botón no cambia; el grafo táctil en celular es incómodo y la lista sirve ahí. El grafo ya es solo de cliente (D3), así que no suma ningún parpadeo |
| D2 | **La vista Grafo ocupa toda la ventana** (`fixed inset-0`), con su propia barra superior (volver al Brain, selector Grafo/Lista, buscador, filtros) y sin el árbol lateral. La Lista sigue dentro del `BrainShell` como hoy | El layout de `/brain/*` envuelve toda pantalla con el árbol; es más simple cubrirlo que reorganizar las rutas. *Llamada mía; el constructor puede preferir un grupo de rutas si le sale más limpio* |
| D3 | **Librería: Sigma.js (v3, WebGL) + graphology + `graphology-layout-forceatlas2` en worker con Barnes-Hut.** Se carga con import dinámico y `ssr: false`, para que el resto del brain no pague el peso | Un canvas 2D (`react-force-graph-2d`) se arrastra con unos pocos miles de nodos y el cambio después es de librería, no de ajuste. Sigma aguanta decenas de miles. Versiones: verificar las vigentes al instalar |
| D4 | **Tamaño del nodo = cantidad de conexiones** (vecinos distintos, entrantes y salientes juntos, sin contar autoenlaces ni links rotos), con escala de raíz cuadrada entre un mínimo y un máximo, para que un hub no tape al resto. Se calcula en el cliente desde las aristas | Pedido de Matías, como Obsidian. Cambia lo que se había hablado antes (solo entrantes) |
| D5 | **Color por categoría** (primer segmento de la ruta, `ctx.categories`), con una paleta tomada de los tokens CSS del tema (`getComputedStyle`), que se vuelve a leer al cambiar entre claro y oscuro. Las archivadas se atenúan. La leyenda es clickeable y filtra | La marca es por tenant (memoria del repo: design system primero); un color fijo en el canvas no la respeta |
| D6 | **Popover al hacer clic: título, fecha de última edición (formato corto es-AR, ej. "20 oct 2026") y botón "Ver página"** hacia `pageHref(tenant, slug)`. No lee el cuerpo. Se cierra con Esc, con clic afuera o con clic en el fondo | Pedido de Matías. Los dos datos ya están en `BrainPageMeta` (`title`, `updatedAt`): no hace falta un endpoint de detalle |
| D7 | **Filtros:** categoría (varias), estado (las archivadas ocultas por defecto), tag, texto (resalta y centra la cámara), "Huérfanas" (misma definición que la lista: sin links entrantes, `LinkIndex.orphans`), "Links rotos" (nodos fantasma, apagado por defecto) y **vista local**: la página seleccionada y sus vecinos a 1, 2 o 3 saltos. Todos ocultan o atenúan con los reducers de Sigma, sin reconstruir el grafo. Pasar el mouse resalta al nodo y sus vecinos y atenúa el resto | Con volumen, el grafo global se vuelve una nube; la vista local es lo que más se usa. *La vista local se dispara desde la barra, sobre el nodo seleccionado, para que el popover siga con los tres elementos pedidos* |
| D8 | **Escala objetivo (llamada mía) con una vara medible.** El spike corre con un grafo sintético de 10.000 nodos y unas 30.000 aristas, en una notebook de gama media, **antes** de construir el resto. **Pasa** si: el zoom y el paneo se sostienen en 30 cuadros por segundo o más, los nodos aparecen en menos de 3 s desde que llega la respuesta, y la respuesta pesa menos de 2 MB comprimida. **Si no pasa a 10.000**, se frena y se vuelve a esta spec (se evalúa otra librería). A 50.000 es una meta, no una compuerta: si el spike muestra que no se sostiene, se fija un tope N medido y, por encima de N, el grafo muestra las N páginas más conectadas con un aviso ("Mostrando las N más conectadas de M") y la vista local sigue disponible para llegar al resto. **Resultado del spike (§2.1): pasa a 10.000; `GRAPH_MAX_NODES` = 20.000** | Da un pasa/no pasa para el spike y define qué ve una empresa más grande que lo probado, en lugar de dejarlo abierto |
| D9 | **Prerrequisito de volumen: paginar `listMeta` y `brain_page_links`.** Hoy `listMeta` hace un `select` sin paginar y `supabase/config.toml` fija `max_rows = 1000`: hasta donde se ve en el código, un brain de más de 1.000 páginas llega truncado al árbol, al índice y al mapa. Se pagina con `.order("slug").range()` (como ya hace `wiki-store.ts` en otro método): `slug` es único por tenant, así que el orden es estable. El bucle **avanza por lo que recibió y corta con una página vacía**, no por una página corta, para que siga bien si el `max_rows` de producción es menor a 1.000. El RPC `brain_page_links` recibe hoy solo `p_tenant_id`, sin offset ni límite: se pagina igual con `.rpc(...).order("slug").range()` desde el cliente, **sin migración**. Como cada página vuelve a ejecutar la extracción de links sobre todos los cuerpos, el spike mide ese costo a 10.000 páginas; si es caro, se agrega un parámetro de keyset (`p_after text, p_limit int`) con una migración, que se aplica **antes** del código. Hay que confirmar el `max_rows` de producción. **Medido (§2.1): 4,3 s a 10.000 páginas, debajo de la vara de 5 s, así que la 26.4a no lleva migración; el costo crece con el cuadrado de las páginas (15 s a 20.000)** | El pedido es volumen grande; sin esto el grafo mostraría solo las primeras 1.000 páginas y sería un bug silencioso. Además mejora el árbol y el índice de todos |
| D10 | **Los datos llegan por un route handler**, `GET /[tenant]/brain/mapa/datos`, no como props del server component. Formato compacto (arrays, no objetos con claves repetidas): tabla de categorías y tabla de tags aparte; nodos `[slug, título, índice de categoría, estado, updatedAt, índices de tags]`; aristas `[origen, destino]` por posición; y los destinos rotos aparte (D15). Mismo adaptador de permisos que el resto (`loadEditorContext` → proveedor filtrado); lo que no se ve responde 404, igual que `skills/package`. `cache-control: private, no-store` | Con miles de páginas el HTML no se infla; los permisos son por persona, así que no se cachea compartido. **Riesgo:** Vercel limita el cuerpo de respuesta de una función a 4,5 MB; el spike mide el tamaño real a 10.000 y 50.000 y, si se acerca, se pasa a respuesta en streaming |
| D11 | **Layout determinista:** posiciones iniciales sembradas desde el slug, para que el grafo se parezca entre visitas. No se guardan posiciones en esta entrega | Evita una tabla o un `localStorage` por una mejora que no se pidió |
| D12 | **Accesibilidad:** el canvas no se recorre con teclado; la Lista es la alternativa accesible y el buscador del grafo selecciona un nodo y abre su popover | Sin esto el grafo sería solo para quien usa mouse |
| D13 | **Sin tablas nuevas, y sin migración salvo que el spike lo pida** (D9: parámetro de keyset en `brain_page_links`). Dependencias nuevas: `sigma`, `graphology`, `graphology-layout-forceatlas2` | El índice de links y los permisos ya existen |
| D14 | **Qué cuenta como conexión.** Las aristas son los links salientes que apuntan a una página existente, sin autoenlaces ni rotos, y **incluyen a las archivadas**. El grado de cada nodo es la cantidad de vecinos distintos sobre esas aristas y **queda fijo**: no se recalcula al activar o apagar filtros, así el tamaño no salta. Con las archivadas ocultas (defecto) se ocultan también sus aristas. "Huérfanas" usa la definición de la lista (sin links *entrantes*, `LinkIndex.orphans`), así que una página con solo links salientes es huérfana y a la vez no es del tamaño mínimo: es correcto, huérfana quiere decir que nadie la enlaza | Un solo criterio para tamaño y aristas; coincide con lo que ya muestra la lista |
| D15 | **Links rotos como nodos fantasma.** Uno por cada destino distinto que no existe, de tamaño mínimo, con el color de destructivo del tema y las aristas desde las páginas que lo apuntan. Su popover muestra el nombre tal como está escrito y "Esta página no existe", **sin fecha y sin botón**. Apagados por defecto | Un nodo sin página no tiene fecha ni a dónde ir; esto evita inventar un comportamiento |
| D16 | **Estados de la pantalla.** Sin acceso o sin brain propio: el `BrainNotice` de hoy, antes de dividir en vistas. Brain sin páginas: aviso "Todavía no hay páginas" con el link de vuelta. Falla la carga de datos o el handler responde 404: mensaje con botón "Reintentar" | El componente de cliente necesita un contrato para los tres casos |

## 2.1 Resultados del spike (26.4a, 2026-10-20)

**Cómo se midió.** Página estática con build minificado (esbuild `--minify`) de `sigma` 4.0.3 (la vigente; D3 decía v3), `graphology` 0.26.0 y `graphology-layout-forceatlas2` 0.10.1 en worker con Barnes-Hut y `inferSettings`. Grafo sintético determinista: aristas ≈ 3× nodos, la mitad de los destinos con distribución Zipf (hubs: el nodo más conectado tiene 1.405 vecinos a 10.000 y 6.106 a 50.000; mediana 5), diez categorías con color, ~2 % de links rotos. Posición inicial sembrada desde el slug (D11), tamaño por raíz cuadrada del grado (D4), etiquetas por defecto de Sigma. Zoom y paneo por programa (8 s de zoom entre ratio 1 y 0,05 con la cámara en círculo, y 4 s de paneo a escala completa con todas las aristas en pantalla), cuadros contados con `requestAnimationFrame`; "mín." es el peor tramo de 500 ms. "Hasta ver nodos" va desde el payload ya parseado hasta el primer `afterRender`. El layout se da por asentado cuando el desplazamiento medio de los nodos baja de 0,5 % del diámetro del grafo por segundo. Dos corridas por tamaño, cada una en una pestaña nueva.

**Equipo.** MacBook Air (Mac16,12), Apple M4 (10 núcleos: 4 de rendimiento y 6 de eficiencia), 16 GB, GPU integrada del M4 vía ANGLE/Metal; Chrome 155 en ventana visible de 1260×760 px CSS con densidad 2× (pantalla de 60 Hz, techo de 60 cuadros). Es más rápido que una notebook de gama media: por eso se corrió también 10.000 con la CPU frenada 2× y 4× (DevTools; la GPU no se frena).

**Payload (ruling R1, re-medir en la 26.4b con el real).** Forma usada: `{ categories: string[], tags: string[], nodes: [slug, título, índice de categoría, estado ("activo"/"archivado"), updatedAt (ISO de PostgREST, 32 caracteres), índices de tags][], edges: [origen, destino][] por posición, broken: { targets: string[], edges: [origen, índice de roto][] } }`. Slugs de ~40 caracteres y títulos de ~25: con títulos reales más largos el peso sube.

| | 1.000 | 10.000 | 50.000 |
|---|---|---|---|
| Aristas (+ rotas) | 2.896 (+50) | 29.310 (+614) | 146.367 (+3.013) |
| Zoom y paneo, fps prom. / mín. | 60 / 58 | 60 / 58 | 54,6 / 38 · 54,2 / 36 |
| Paneo a escala completa, fps prom. / mín. | 60 / 58 | 60 / 58 | 38,4 / 36 · 37,3 / 34 |
| Hasta ver nodos | 175–210 ms (1.214 ms la primera carga en frío, con compilación de shaders) | 343–352 ms | 1.232–1.456 ms |
| Layout asentado | 6 s | 20–21 s | 33 s |
| Cuadros mientras corre el layout, prom. / mín. | 60 / 58 | 60 / 50–58 | 47 / 30–34 |
| Payload sin comprimir / gzip | 156 KB / 44 KB | 1,64 MB / 451 KB | 8,57 MB / 2,33 MB |
| Heap JS después del primer render | 18–20 MB | 64–73 MB | 253–345 MB |
| CPU de Sigma por cuadro (mediana) | 0,8 ms | 1,0 ms | 1,0 ms |

Intermedios: a 20.000 (58.258 aristas), 60 / 58 fps en zoom y en paneo, 420 ms hasta ver nodos, 52 fps mínimo con el layout corriendo, 3,37 MB sin comprimir y 915 KB con gzip, 129 MB de heap. A 30.000 (87.405 aristas), 60 / 58 fps, 681 ms, 42 fps mínimo con layout, **5,10 MB sin comprimir** y 1,38 MB con gzip, 217 MB de heap. Con la CPU frenada a 10.000: 2× da 451 ms hasta ver nodos, 60 fps en zoom y paneo y 38 fps mínimo con layout; **4× da 897 ms y 60 fps en zoom y paneo con el layout quieto, pero 13 fps promedio (10 mínimo) mientras el layout corre**: el worker calcula, pero cada iteración vuelve al hilo principal a escribir las posiciones y Sigma reprocesa todo el grafo.

**RPC de links (D9).** Supabase local en la misma máquina, 10.000 páginas sembradas con cuerpo medio de 4,4 KB y 29.924 wikilinks (8.604 páginas con links). `listLinks` completo (nueve respuestas de 1.000 más la vacía): 4,25 s de mediana (4,14–4,46 s, cinco corridas); una sola llamada del RPC, 0,40 s; `listMeta` completo, 66 ms. A 20.000 páginas: 15,1 s y 0,77 s por llamada. Cada llamada vuelve a extraer los links de todos los cuerpos, así que el total crece con el cuadrado de las páginas.

**Decisiones.**

- **(a) Sigma pasa la compuerta de D8 a 10.000:** 60 fps en zoom y paneo (58 en el peor tramo, también con la CPU frenada 4× una vez quieto el layout), nodos en 0,35 s (0,9 s con CPU 4×; la primera carga en frío suma ~1 s de compilación de shaders) y 451 KB con gzip, todo bajo la vara. Condición para la 26.4b: el layout no puede quedar corriendo mientras la persona navega en un equipo lento (con CPU 4× baja a 13 fps); se acota en tiempo y se pausa al interactuar.
- **(b) `GRAPH_MAX_NODES` = 20.000.** A 50.000 no se sostiene: en el M4 el paneo cae a 37–38 fps con el límite en la GPU (Sigma gasta 1 ms de CPU por cuadro), así que en una GPU de gama media, más lenta, queda debajo de 30; además pesa 2,33 MB con gzip (vara: 2 MB) y 8,57 MB sin comprimir, por encima de los 4,5 MB de Vercel (D10). 30.000 va a 60 fps en el M4 pero ya pesa 5,10 MB sin comprimir. 20.000 es el tamaño medido más grande con 60 fps en el M4 (margen de ~2× para una GPU más lenta) y 3,37 MB sin comprimir. Si en la 26.4b el payload real a 20.000 supera 4 MB, se baja N o se pasa a streaming.
- **(c) Sin migración en la 26.4a.** `listLinks` a 10.000 páginas tarda 4,25 s, debajo de la vara de 5 s. Riesgo abierto: el margen es chico, la base de producción no es un M4 y el costo es cuadrático (15 s a 20.000, el tope de N); antes de abrir el grafo a brains de más de 10.000 páginas hace falta la migración con keyset (`p_after text, p_limit int`), migración antes que el código.

## 3. Cómo funciona

- **Servidor.** Un servicio puro en `lib/brain/core/` (por ejemplo `graph.ts`) recibe las páginas visibles y el `LinkIndex` y arma el payload compacto: categorías, nodos, aristas y rotos. El route handler solo resuelve el tenant y la persona, llama al servicio y responde. Las páginas archivadas viajan marcadas, no omitidas; el filtro de estado se resuelve en el cliente.
- **Cliente.** Un componente cliente (cargado con `next/dynamic`) pide el payload, arma el `Graph` de graphology, calcula el grado de cada nodo (D4), corre ForceAtlas2 en un worker y dibuja con Sigma. Los filtros y el hover viven en reducers. El popover se ancla al nodo con `graph2ViewportCoords` y sale de los componentes de `components/ui`.
- **Lista.** Es la página actual, sin cambios, detrás del selector.

## 4. Permisos

No se agrega nada al modelo. El proveedor ya filtra páginas y links por `ctx.access`; el route handler no hace un segundo filtrado propio. Quien no ve una carpeta no recibe esas páginas ni las aristas que las tocan (el índice se arma sobre lo visible). Test obligatorio: con una persona sin acceso a una carpeta, ningún slug de esa carpeta aparece en la respuesta.

## 5. Entregas y pruebas

Tres PRs, en este orden:

1. **26.4a · Volumen.** Paginación de `listMeta` y del RPC de links (D9) con test de 1.001 y 2.500 páginas contra un store falso, y el spike de rendimiento con grafo sintético (D8, tamaño del payload incluido). El spike es descartable y no entra a `main`.
2. **26.4b · Grafo.** Servicio `graph.ts`, route handler, componente con Sigma, color y tamaño, popover, selector Grafo/Lista y pantalla completa.
3. **26.4c · Filtros y cierre.** Filtros, vista local, buscador, QA en navegador (escritorio y 375 px, claro y oscuro), página en la wiki y `/docs-wiki` en verde.

Tests automáticos para lo puro: armado del payload, grado y escala de tamaño, predicados de filtro, vecindario a N saltos, y el test de permisos de §4. El componente con WebGL no se prueba con unitarios: se verifica en el navegador con el brain real de `innovas`.

## 5.1 Documentación

Una ruta nueva hace fallar `npm run docs:check` hasta que tenga página o una exclusión con motivo en `docs/_meta/cobertura.ts`. Se actualiza `docs/dominios/brain.md` con el mapa como grafo, la paginación y el límite de 1.000 filas. No se debilita el test.

## 6. Llamadas del diseño, para revisar

Lo que resolví yo y no vino de Matías: D1 (el defecto por ancho se decide en el cliente), D2 (cubrir el layout con `fixed inset-0`), D8 (la vara de 10.000 y el tope N por encima), D9 (paginar el RPC desde el cliente y migración solo si el spike la pide), D10 (route handler, formato compacto y tags por tabla de índices), D11 (sin guardar posiciones), D14 (grado fijo, aristas con archivadas), D15 (nodos fantasma sin fecha ni botón), D16 (estados de error y vacío), el nombre y número de la entrega (26.4) y que la vista local se dispare desde la barra.

El caso que más cambia lo que ve alguien es D8: una empresa más grande que lo que prueba el spike ve las N páginas más conectadas, con aviso, en lugar de todas.
