<!-- CONTEXT: scope=adr | dependencias=00_Project_Vision.md,adr/ADR-001-Framework.md,adr/ADR-002-No-Backend.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-100-El-Aislamiento-De-Origen-Cruzado-Condiciona-El-Hosting.md,roadmap/Version_2.0.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-130 — El contenedor de escritorio fija el motor

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, al definir la forma de distribución del 1.0.
- **Relacionado con**: ADR-001 (stack; ya anticipaba "Electron después"), ADR-002 (no-backend), ADR-018 (assets first-party), ADR-100 (aislamiento de origen y hosting), `roadmap/Version_2.0.md` §2.2
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

### 1. La promesa "100% local" es también perceptiva, y la web la debilita

`00_Project_Vision.md` §3 define el problema por oposición a los **servicios online que suben el documento a un servidor**. Anonly no lo hace —el gate `no-network-from-core` lo prueba en CI— pero el usuario al que apunta el producto no audita gates: ve una URL y asume que sus pericias viajan.

La audiencia real lo vuelve concreto. El uso inicial es una licenciatura de IA e innovación donde se enseña explícitamente a **no subir documentos sensibles a fuentes no confiables**. Presentar la herramienta como un sitio web arranca la conversación defendiéndose del prejuicio correcto. Un instalador que se baja una vez y después funciona con el WiFi apagado no necesita esa defensa.

### 2. En la web, el motor de render lo decide el usuario, y eso ya nos costó

`polyfills.ts` existe porque en Safari 17 `pdfjs` moría con `Promise.withResolvers is not a function` **adentro de los workers**, y la UI reportaba "El archivo no es un PDF válido" — un fallo del entorno disfrazado de fallo del documento. ADR-053 mostró lo sensible que es el render a los detalles del motor.

Para una herramienta cuyo output es un PDF que alguien presenta en un juzgado, que el resultado dependa del navegador instalado no es una molestia de compatibilidad: es una propiedad indeseable del producto.

### 3. El aislamiento de origen depende hoy de quién hostee

ADR-100 midió que sin `COOP`/`COEP` el navegador no expone `SharedArrayBuffer` y `onnxruntime-web` se autolimita a un hilo: **13 564 ms contra 6 287 ms** sobre el dataset de referencia. Esos headers los tiene que mandar el hosting, y el propio ADR-100 anota que GitHub Pages no puede.

O sea que la performance del NER —el doble o la mitad— es hoy una consecuencia de una decisión de infraestructura ajena al repo.

### 4. El peso ya está pago

`apps/react-client/public/` acumula **183 MB de modelos NER, 17 MB de wasm y 2,4 MB de pdfjs**: ~202 MB que hoy se descargan a demanda y se cachean. Cualquier razonamiento de tamaño de contenedor se compara contra eso, no contra cero.

## Decisión

### 1. El 1.0 se distribuye como aplicación de escritorio empaquetada con **Electron**

Nuevo paquete `apps/desktop-shell`, que **carga el mismo build de `apps/react-client`**. No hay fork de la UI ni una segunda base de código.

### 2. El escritorio **reemplaza** a la web como target del 1.0

No conviven. La web sale de alcance.

### 3. El renderer se sirve por un **protocolo propio**, no por `file://`

`apps/react-client/vite.config.ts` declara `worker: { format: "es" }`: la app usa **module workers**, que bajo `file://` fallan por CORS, y `COOP`/`COEP` no aplican a ese esquema. Un esquema propio registrado por el shell (`app://`) es el único que permite servir el `dist` con los headers de aislamiento. Los detalles son de ADR-132.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| **Tauri** | Usa el webview del sistema: en macOS eso es **WKWebView, o sea el motor de Safari**. Empaquetar con Tauri no le escapa al bug de §2 — lo institucionaliza en cada Mac, y con la versión del motor decidida por el SO del usuario. Su ventaja de tamaño (instaladores de MB contra ~150 MB de Chromium) se diluye contra los 202 MB de §4: la comparación real es ~210 MB contra ~360 MB. |
| **PWA instalable** | Costo cero y auto-update gratis, pero (a) necesita una URL, o sea no resuelve §1; (b) el motor lo sigue decidiendo el navegador desde el que se instala, no resuelve §2; (c) los 202 MB viven en Cache Storage, que el navegador **desaloja bajo presión de disco** — la app se rompe justo en el escenario offline que promete. Queda fuera de alcance junto con `Version_1.0.md` §2.7. |
| **ZIP del repo + `.exe` que lanza comandos** | Peor en todos los ejes: el `.exe` no firmado dispara SmartScreen **igual** que un instalador, y un ejecutable que abre una terminal es además el patrón que los antivirus marcan; requiere Node 22 y pnpm instalados en la máquina del usuario; arranca un dev server con el modo de falla de caché envenenado ya documentado en `vite.config.ts`. Y le pide a una audiencia entrenada para desconfiar de archivos opacos que ejecute exactamente eso. |
| **Seguir solo en web** | No resuelve §1 ni §2, y deja la performance del NER atada al hosting (§3). |

## Consecuencias

**A favor**

- **`SharedArrayBuffer` deja de ser una apuesta.** El shell sirve sus propios headers: el NER corre multihilo en toda instalación, siempre. El riesgo de ADR-100 desaparece del proyecto en vez de mitigarse.
- **Safari sale de la matriz de compatibilidad.** El bug que originó esta decisión deja de existir como categoría.
- **Se invierte ADR-018.** Los ~202 MB viajan dentro del paquete: cero descarga en primer uso, sin depender del caché de IndexedDB. `assets.lock.json` pasa de manifiesto de mirroring a insumo del build del instalador — y su verificación sha256 se vuelve un eslabón de la cadena de procedencia del binario.
- **Sin límites de pestaña**: ni techo de memoria por tab ni *throttling* en background mientras se procesa un documento largo.
- **Sin hosting.** No hay dominio ni servidor que pagar ni mantener: la distribución es por artefactos en GitHub Releases (ADR-131).

**En contra**

- **Dependencia externa nueva y grande** (Electron, `electron-builder`). Cae de lleno bajo R-12, y este ADR es su autorización.
- **El instalador pesa ~350 MB.** Aceptado: 202 MB ya eran nuestros.
- **Los E2E de Playwright hay que repensarlos.** Hoy corren contra navegadores; el target pasa a ser el shell. Es el único trabajo que esta decisión *agrega*, y hay que dimensionarlo antes de dar el 1.0 por cerrado.
- **`08_Security_Model.md` §3.2 queda escrito para un target que ya no existe.** No se adapta: se reescribe (ADR-132).
- **La distribución hereda un problema que no es técnico**: sin firma de Apple, macOS exige un trámite manual en la primera apertura. Se trata en ADR-131 §4.

**Lo que no toca**

- El Core, sus contratos y P-1..P-10. El shell es un cliente más: consume `@anonly/anonymization-core` por la misma frontera que hoy usa `apps/react-client`, y **no importa motores**.
- ADR-002: sigue sin haber backend. Un contenedor local no es un servidor.
- `polyfills.ts` queda sin razón de ser, pero **no se borra en este ADR** — sale cuando la web salga del repo, no antes.

## Residuo

`docs/roadmap/Version_2.0.md` §2.2 y §3 listan "Desktop Packaging" como ítem de v2.0, y `Version_1.0.md` §2.7 lista la PWA. Ambos quedan desactualizados por esta decisión y hay que corregirlos. No se hace acá para no mezclar el ADR con la edición del roadmap.
