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

### 3. `webPreferences` bloqueado

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. La única superficie main↔renderer es un preload con un canal IPC explícito y de superficie mínima. Sin `@electron/remote`.

Además: navegación externa y `window.open` bloqueados por defecto — cualquier URL que no sea `app://` se rechaza o se delega al navegador del sistema, nunca se carga adentro de la app.

### 4. Chromium no habla con nadie

Chromium hace sus propias salidas de red (Safe Browsing, component updater, prefetch de DNS). En un producto que afirma no tocar internet, hay que apagarlas explícitamente y **poder demostrarlo**. Deja de ser una afirmación del README y pasa a ser una propiedad verificada.

### 5. Gates nuevos en `08_Security_Model.md` §11

| Gate | Qué verifica |
|---|---|
| `shell-no-egress` | con el chequeo de actualizaciones desactivado, la app no emite **ninguna** request saliente |
| `updater-payload-clean` | la request del updater no lleva contenido, nombre ni metadato de documento — solo versión y plataforma |
| `csp-under-app-protocol` | la CSP de §3.2 llega efectivamente bajo `app://` |
| `cross-origin-isolated` | `crossOriginIsolated === true` en el renderer y en los workers de motor |
| `webprefs-locked` | `contextIsolation`/`sandbox` on, `nodeIntegration` off en toda `BrowserWindow` |

`csp-strict` y `no-third-party-connect` cambian de mecanismo (dejan de leer response headers de un server) pero no de intención. **`sri-present` queda sin objeto**: no hay `<script>` remoto que verificar, y la integridad de los assets ya la garantiza el sha256 de `assets.lock.json` en el build del instalador (ADR-018). Se retira del gate y se documenta el reemplazo, en vez de dejarlo verde por vacuidad.

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

### 7. La caché de assets se apaga en el shell

Cachear en `Cache Storage` assets que ya son archivos locales del instalador no aporta nada: ADR-130 los mete adentro del paquete. La capa se desactiva cuando la app corre dentro del shell, en vez de dejarla fallando en silencio. Eso implica que el renderer tiene que **saber** que está en el contenedor — un flag booleano expuesto por el preload, sin datos y sin capacidades: es la superficie mínima que resuelve el caso y no abre nada (§3).

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
- **§7 mete una diferencia de comportamiento entre web y shell**, y por lo tanto un camino de código que la web no ejercita. Es aceptable porque la web sale de alcance (ADR-130 §2), pero mientras convivan es una bifurcación real.
