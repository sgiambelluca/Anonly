<!-- CONTEXT: scope=adr | dependencias=adr/ADR-018-First-Party-Assets.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,architecture/08_Security_Model.md,core/NER_Engine.md,core/OCR_Engine.md,roadmap/MVP.md | audiencia=humanos+IA | fase=11 -->

# ADR-187 — La integridad de los assets no se verifica en runtime

- **Estado**: Aceptado.
- **Fecha**: 2026-09-26.
- **Decidido por**: el humano, a propuesta del planificador.
- **Alcance**: retira el punto 3 de ADR-018 y el pendiente de Hito 11 que lo
  arrastraba. Solo documentación: sin cambio de código, contrato, error code
  ni gate.
- **Relacionado con**: ADR-018 (assets first-party), ADR-130 (contenedor de
  escritorio), ADR-132 (modelo de seguridad del shell), ADR-053 (única
  excepción de red del Core).

## Contexto

ADR-018 §3 pidió verificar la integridad de modelos y wasm **al cargarlos**:
`crypto.subtle.digest` contra el `sha256` de `assets.lock.json`, con un hash
distinto convertido en `OCR_MODEL_MISSING` / `NER_MODEL_LOAD_FAILED`. Se
difirió al Hito 11 y quedó arrastrado en `08_Security_Model.md` §8.2 con este
objetivo: cubrir «la manipulación del archivo **después** de instalado».

Se escribió cuando la app se servía desde un sitio web. Desde ADR-130 se
instala como aplicación de escritorio, y la auditoría previa a implementarlo
(2026-09-26) encontró que así no puede cumplir ese objetivo:

1. **El verificador vive al lado de lo que verifica.** `electron-builder.yml`
   deja el renderer entero fuera del `asar`, como archivos sueltos en
   `<resources>/renderer`: los modelos, los wasm y también el JavaScript de
   los motores que haría el chequeo, con los hashes esperados adentro. Quien
   pueda reemplazar un modelo en esa carpeta puede reemplazar, en el mismo
   lugar y con los mismos permisos, el código que lo verifica o el hash
   contra el que compara. El propio `electron-builder.yml` ya lo reconoce
   para otro caso: «una constante en JS vive adentro del asar, que cualquiera
   reemplaza», y el renderer ni siquiera está adentro del `asar`.
2. **Choca con el gate `no-network-from-core`.** Para hashear un modelo, el
   motor tiene que leer sus bytes él mismo, con un `fetch` dentro de
   `packages/`. Ese gate lo prohíbe y hoy solo admite la excepción de
   ADR-053 (CMaps y fuentes de pdf.js). Cumplir ADR-018 §3 exigiría abrir otra.
3. **Tiene costo en el recurso más caro.** `crypto.subtle.digest` no hashea
   en streaming: hay que tener el archivo entero en memoria. El modelo de NER
   pesa 178,5 MB y es el mayor consumidor de la app (~487 MB de WASM una vez
   cargado). El chequeo sumaría una copia transitoria de ese tamaño, y tiempo,
   en cada carga del modelo.

La manipulación posterior a la instalación sí tiene quién la cubra, y está
**fuera** de la app:

- **Antes de instalar**: `pnpm assets:mirror` descarga cada asset, lo compara
  contra el pin de `assets.lock.json` y no lo escribe si no coincide; corre en
  CI antes de empaquetar (`08_Security_Model.md` §8.2).
- **El instalador publicado**: `SHA256SUMS.txt` y la atestación de
  procedencia atan cada instalador a su commit y a su workflow (ADR-132 §6).
- **El sistema operativo**: la firma de código. Hoy es ad-hoc en macOS y falta
  SignPath en Windows (Hito 11.5); protegerla es trabajo de ese frente, no de
  un chequeo dentro de la app.

## Decisión

1. **Se retira ADR-018 §3.** Los motores no verifican en runtime el hash de
   modelos ni de wasm contra `assets.lock.json`.
2. **La integridad de los assets se garantiza en dos momentos**, y solo en
   esos: al construir (`pnpm assets:mirror` contra el pin) y al distribuir
   (procedencia del instalador y firma de código). `08_Security_Model.md`
   §8.2 y §8.3 se corrigen para decir exactamente eso.
3. **No cambia ningún contrato.** `OCR_MODEL_MISSING` y
   `NER_MODEL_LOAD_FAILED` conservan su significado actual: fallo de carga del
   modelo. Ya no se reservan para un hash distinto.
4. **Queda fuera de este ADR** un chequeo liviano contra **corrupción
   accidental** (disco dañado, antivirus que trunca un archivo, actualización a
   medias), que sí aportaría un error claro en vez de resultados raros. No se
   adopta acá: si se quiere, necesita su propia decisión, medición de costo y
   definición de qué comprueba (tamaño, hash cacheado u otro).

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Implementar ADR-018 §3 tal como está | No cubre la amenaza que promete (el verificador se reemplaza junto con el asset), exige una excepción nueva a `no-network-from-core` y suma ~178 MB transitorios en cada carga del NER. |
| Verificar en el proceso principal del shell, al servir cada archivo por `app://` | Solo protegería algo si el propio shell estuviera protegido: hoy no hay *fuses* de integridad del `asar`, la firma de macOS es ad-hoc y falta Authenticode en Windows. Es más trabajo y depende de frentes abiertos. |
| Mantener el requisito y redefinirlo como chequeo de corrupción | Es otra decisión, con otro costo y otra promesa. Se deja registrada en §4 en vez de heredar el nombre de este requisito. |

## Consecuencias

- El Hito 11 pierde el ítem «verificación de integridad en runtime» y su test
  («asset con hash alterado → error tipado»).
- `NER_Engine.md` §15, ítem 19, deja de pedir la validación del hash; conserva
  la configuración de Transformers.js contra el origen propio.
- La protección contra la manipulación después de instalar depende de la firma
  de código del instalador. En Windows eso vuelve más importante SignPath
  (Hito 11.5). En macOS no habrá firma Developer ID: queda como riesgo
  aceptado en `08_Security_Model.md` §2.3.
