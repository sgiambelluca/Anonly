<!-- CONTEXT: scope=adr | dependencias=architecture/08_Security_Model.md,adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md,adr/ADR-100-El-Aislamiento-De-Origen-Cruzado-Condiciona-El-Hosting.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-132 — El shell tiene su propio modelo de seguridad

- **Estado**: Accepted — el spike verificó los cuatro puntos el 2026-09-04. Ver "Verificado en el spike".
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, junto con ADR-130 y ADR-131.
- **Relacionado con**: ADR-130 (el contenedor), ADR-131 (el actualizador), ADR-039 (`blob:` y wasm paths), ADR-100 (aislamiento de origen), `08_Security_Model.md` §3.2 y §11
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

`08_Security_Model.md` §3.2 define una CSP que el **hosting** entrega como response headers, y §11 la verifica con un gate E2E que lee esos headers. Todo ese capítulo asume un origen web servido por un servidor HTTP.

Un contenedor de escritorio tiene otra postura: no hay servidor, el origen es un esquema propio, existe acceso a filesystem, y el proceso principal tiene permisos que ninguna página web tiene. Adaptar el documento línea por línea produciría un texto que describe mal las dos cosas. **Se reescribe.**

## Decisión

### 1. La frontera es el proceso, y ahí está lo elegante

Electron corre dos mundos: el **main** (Node, permisos de sistema) y el **renderer** (Chromium, la UI). La regla es una sola:

> Todo lo que toca red o disco vive en el main. El renderer sigue tan encerrado como hoy en la web.

Consecuencias directas:

- **`connect-src 'self'` de §3.2 se mantiene sin excepciones.** El updater de ADR-131 hace su request desde el main, donde la CSP no aplica. El renderer no gana ni un destino nuevo.
- **El Core sigue sin filesystem.** Cuando el shell abra archivos del disco (mejora futura, no MVP), lee en el main y le pasa **bytes** al Core por la frontera que ya existe. R-10 y P-1..P-10 quedan intactos.

### 2. El renderer se sirve por `app://`, registrado como **standard + secure**

`file://` no sirve: los module workers (`worker: { format: "es" }` en `vite.config.ts`) fallan por CORS y `COOP`/`COEP` no aplican a ese esquema. El shell registra `app://` con los flags de esquema estándar y seguro, y le entrega:

- Los mismos dos headers de aislamiento de ADR-100, ahora bajo control propio en vez de del hosting.
- La CSP de §3.2, tal cual, incluidos `'wasm-unsafe-eval'` y los `blob:` que ADR-039 justificó.

### 3. `webPreferences` bloqueado, y superficie main↔renderer **cero**

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. Sin `@electron/remote`.

**No hay preload.** La primera versión de este ADR previó uno para el flag de §7; al resolverse §7 en el motor, ese flag desapareció y el preload se quedó sin nadie que lo consumiera. Un preload que expone un booleano que nadie lee no es superficie mínima: es superficie muerta que además miente sobre que el renderer se bifurca por plataforma.

El actualizador de ADR-131 probablemente introduzca el primer canal real —avisar al renderer que hay versión nueva—. Ese canal se diseña ahí, con su justificación, y no se retrofitea sobre un flag sobrante.

Además: navegación externa y `window.open` bloqueados por defecto — cualquier URL que no sea `app://` se rechaza o se delega al navegador del sistema, nunca se carga adentro de la app.

### 4. Chromium no habla con nadie

Chromium hace sus propias salidas de red (Safe Browsing, component updater, prefetch de DNS). En un producto que afirma no tocar internet, hay que apagarlas explícitamente y **poder demostrarlo**.

**Medido antes de tocar nada** (2026-09-04): durante un pipeline completo la app no emitió ninguna request a un host. Los 29 pedidos que registra la sesión son `file://` del propio handler de `app://` leyendo el disco. O sea que los switches no corrigen un problema observado — cierran caminos que Chromium puede abrir por su cuenta en otra versión, en otra plataforma o ante otra configuración. En un producto cuyo argumento es "esto no habla con internet", la diferencia entre *hoy no lo hace* y *no puede hacerlo* es la que importa.

Se apagan por línea de comandos: `disable-background-networking` (el paraguas: variations, component updater, sincronización de tiempo), más `disable-component-update`, `disable-domain-reliability`, `disable-breakpad` y `no-pings`.

### 5. Gates nuevos en `08_Security_Model.md` §11

| Gate | Qué verifica |
|---|---|
| `shell-no-egress` | con el chequeo de actualizaciones desactivado, la app no emite **ninguna** request saliente |
| `updater-payload-clean` | la request del updater no lleva contenido, nombre ni metadato de documento — solo versión y plataforma |
| `csp-under-app-protocol` | la CSP de §3.2 llega efectivamente bajo `app://` |
| `cross-origin-isolated` | `crossOriginIsolated === true` en el renderer y en los workers de motor |
| `webprefs-locked` | `contextIsolation`/`sandbox` on, `nodeIntegration` off en toda `BrowserWindow` |
| `no-cache-storage-writes` | ningún intento de escribir en `Cache Storage` durante un pipeline completo (§7) |

**Implementados el 2026-09-04**, cinco como E2E contra el contenedor (`tests/e2e/security-gates.spec.ts`) y `updater-payload-clean` como unit del shell — en runtime haría falta un chequeo real contra un servidor, y lo que puede filtrar no es la red sino la función que arma el payload, así que se prueba ahí.

`csp-strict` y `no-third-party-connect` cambian de mecanismo (dejan de leer response headers de un server) pero no de intención; de hecho `shell-no-egress` **endurece**: no permite ningún host, no solo los ajenos. **`sri-present` queda sin objeto**: no hay `<script>` remoto que verificar, y la integridad de los assets ya la garantiza el sha256 de `assets.lock.json` en el build del instalador (ADR-018). Se retira del gate y se documenta el reemplazo, en vez de dejarlo verde por vacuidad.

### 6. La procedencia reemplaza a la firma como argumento de confianza

Sin certificado de Apple, el binario de macOS no está notarizado. Eso resuelve **fricción**, no confianza, y son cosas distintas. La confianza se construye por otra vía, y es gratis:

- Build en GitHub Actions, con logs públicos.
- `assets.lock.json` verifica sha256 de cada modelo y wasm que entra al instalador.
- sha256 de cada artefacto publicado en el release, más *attestations* de procedencia.

Cualquiera puede verificar que ese binario salió de ese commit y de esos modelos. Para la audiencia del producto eso vale más que un certificado comprado, y hay que decirlo en el README en vez de dejarlo implícito.

## Verificado en el spike (2026-09-04)

Electron 44.2.0, macOS, sobre el `dist` de `apps/react-client` servido por `app://` con los headers y la CSP de §2. **Los cuatro puntos dan verde.**

| # | Qué había que confirmar | Resultado |
|---|---|---|
| 1 | `crossOriginIsolated` en renderer **y** en los workers | `true` en ambos. `isSecureContext: true`, origen `app://local` |
| 2 | Module workers cargan bajo el esquema | Sí. Arrancan los de `pdf`, `ocr`, `ner` y `render`; `worker: { format: "es" }` intacto. **`export` no se ejercitó** — ver abajo |
| 3 | `onnxruntime-web` multihilo | Carga **`ort-wasm-simd-threaded.asyncify`** — el build threaded, no el de un hilo. `new SharedArrayBuffer(8)` funciona adentro del worker |
| 4 | La CSP de §3.2 no rompe nada | Cero `did-fail-load`, cero violaciones. Los `blob:` de ADR-039 se respetan |

Se ejercitó el pipeline completo con dos fixtures reales, no solo la carga de la app:

- `text-10p.pdf`: PDF → Regex → NER → Grouping → Render. Detectó Personas (3), Organizaciones (3), DNI, IBAN, Direcciones (2). Dos canvases (original + anonimizado).
**Lo que el spike NO cubrió**: la exportación. El flujo llegó hasta el render lado a lado, sin apretar «Exportar», así que el worker de `export-engine` y el camino de `pdf-lib` quedan sin verificar bajo `app://`. Nada hace sospechar que fallen —no cargan assets propios ni dependen del aislamiento—, pero está sin probar y no se cuenta como verde.

- `image-alpha-3p.pdf`: además el camino de OCR. Cargó `worker.min.js`, `tesseract-core-simd-lstm.wasm.js` y los tres `traineddata` (`spa`, `eng`, `osd`), y detectó Persona, Organización y DNI.

### El único hallazgo: `Cache` no acepta `app://`

`Failed to execute 'put' on 'Cache': Request scheme 'app' is unsupported`, repetido para los assets de ONNX y del NER.

**No es fatal** —la app lo advierte y sigue, y los dos pipelines completaron— pero ensucia la consola y deja una capa de código corriendo para nada.

**Se verificó que es del protocolo y no de Electron**: la misma prueba, mismo Electron, mismo `dist`, cambiando **solo** el esquema por `http://127.0.0.1`, no produce ese error. Las otras dos advertencias (`Setting up fake worker` de pdfjs, y `content-length`) **aparecen idénticas en los dos modos**: son preexistentes de la web y esta decisión no las causa ni las arregla.

### 7. La caché de `Cache Storage` se apaga en el motor, no con un flag del shell

**Corregido respecto de la primera redacción de este ADR**, que decía que la capa se desactivaba "cuando la app corre dentro del shell", vía un booleano expuesto por el preload. Al ir a implementarlo apareció dónde vive realmente la caché, y con eso el flag dejó de tener sentido.

Quien cachea es `@huggingface/transformers` (`env.useBrowserCache`, default `true` en browser), desde `ner-engine/src/worker/kernel.ts`. Y ese mismo archivo ya fija `allowRemoteModels = false` y `localModelPath = "/models/ner/"`: **el motor sirve sus modelos desde su propio origen, siempre, en los dos targets**. Guardar en `Cache Storage` una copia de un archivo que ya viene del origen propio no compra nada que el caché HTTP del navegador no dé — y en el escritorio son directamente archivos locales del instalador.

Entonces no es una diferencia entre web y shell: **es una capa que nunca aportó nada en esta aplicación**. Se apaga incondicionalmente en el kernel, y el shell no necesita anunciarse.

Eso evita dos cosas que la redacción original traía: un cambio de contrato del Core para pasarle un flag, y una bifurcación de comportamiento entre web y shell. Lo único que se pierde es que el renderer no sabe que está en el contenedor — y no lo necesita saber.

**La condición que revierte esta decisión**: que vuelva un cliente web o una PWA. Ahí la caché sí compraba algo —el origen propio era un servidor— y sin ella la web re-descarga ~180 MB en cada visita sin que nada avise. Queda anotado en los tres lugares donde alguien lo miraría: el comentario de `configureTransformersEnv()`, `core/NER_Engine.md` §12, y `roadmap/Version_1.0.md` §2.7, que es donde se decidiría reflotar la web.

## Consecuencias

**A favor**

- El renderer no se afloja en nada respecto de la web: misma CSP, mismo aislamiento, y encima garantizado por nosotros y no por el hosting.
- "No manda nada a internet" pasa de claim a gate.
- La postura queda escrita **antes** del código, que es lo que R-19 pide.

**En contra**

- **`08_Security_Model.md` se reescribe**, no se parchea. Es trabajo real y hay que hacerlo antes del 1.0.
- **Los E2E cambian de target.** Playwright contra navegador deja de ser el vehículo de `csp-strict` y `no-third-party-connect`.
- **§4 es una lista que hay que mantener**: las salidas de red de Chromium cambian entre versiones, y apagarlas es un compromiso permanente, no una tarea.
- **La app sin notarizar sigue mostrando el trámite de Gatekeeper.** Este ADR no lo arregla; lo compensa con §6.
- **§7 cambia el comportamiento del motor de NER, no solo el del shell.** Apagar `useBrowserCache` incondicionalmente vale para cualquier cliente que consuma el Core, no solo para el contenedor. Es correcto —el motor sirve sus modelos desde su propio origen en todos los casos— pero es un cambio en `packages/`, no en `apps/`, y hay que leerlo así.
