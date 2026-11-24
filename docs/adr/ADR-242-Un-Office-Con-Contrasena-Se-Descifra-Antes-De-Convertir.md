<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Preproceso_Y_Cifrado_2026-11-24.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,adr/ADR-050-Password-Del-PDF-Protegido-Hasta-RenderEngine.md,core/Contracts.md,core/Convert_Engine.md,core/Orchestrator.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-242 — Un Office con contraseña se descifra antes de convertir

- **Estado**: Aceptado por el mantenedor el 2026-11-24, junto con ADR-240.
  Falta pasarlo a los contratos y los specs.
- **Fecha**: 2026-11-24.
- **Decidido por**: el planificador, sobre la decisión del mantenedor del
  2026-11-23: un Office con contraseña se trata como el PDF de hoy, la app
  la pide y lo abre (`Plan_1.2.md` §3).
- **Origen**: ADR-238 §7, que le dejó este punto al ADR del conversor, y el
  spike de preproceso y cifrado (`Plan_1.2.md` §8.7).

## Contexto

ADR-238 §2.2 reconoce un Office cifrado: es un contenedor OLE con
`EncryptionInfo` y `EncryptedPackage` (ECMA-376, parte 2). No se sabe si es
Word, Excel o PowerPoint hasta descifrarlo.

Lo que midió el spike (`formatos/Preproceso_Y_Cifrado_2026-11-24.md`):

- **El conversor de ADR-240 también descifra**, porque trae OpenSSL
  aunque no tenga NSS.
  - Con la contraseña abrió los cuatro Word cifrados del árbol de
    LibreOffice, entre 0,1 y 0,4 s.
  - Sin la contraseña, o con una equivocada, la excepción no la distingue
    de un archivo que no se puede abrir.
- **Un descifrador propio en JS** también abrió los cuatro:
  - un lector mínimo de OLE;
  - ECMA-376 Agile y Standard;
  - WebCrypto.
- **Con el descifrador propio, una contraseña equivocada se detecta
  siempre por el verificador del archivo, antes de descifrar.** No hubo
  ninguna apertura en 840 intentos.
- **Lo que cuesta**, dentro de un Worker de Electron:
  - derivar la clave de Office 2013 (100.000 SHA-512 con
    `crypto.subtle.digest`) tarda 0,37 s;
  - descifrar 250 MB en Agile tarda 0,8 s y suma 1,3 veces el archivo en
    memoria.
- **El modo ECB del cifrado Standard** (Office 2007) se emula sobre el
  AES-CBC de WebCrypto: anda a 400 MB/s o más, y suma hasta 2,3 veces el
  archivo en memoria.
- **Solo hay Word cifrados de prueba.** Excel y PowerPoint usan el mismo
  contenedor, pero no se probaron.

## Decisión

### 1. Descifra el Convert Engine, con código propio y WebCrypto

El Convert Engine gana un trabajo `decrypt-office`, en su pool `convert`,
que **no carga el conversor**.

- **Recibe** los bytes del contenedor OLE y la contraseña.
- **Devuelve** el paquete OOXML en claro.
- **Qué cubre**: el lector de OLE, el parseo de `EncryptionInfo`, la
  derivación de la clave, el verificador y el descifrado de
  `EncryptedPackage`. Es código propio y sin dependencias, con
  `crypto.subtle` para los hash y el AES.
  - **Agile**: AES-CBC por segmentos de 4096 B. Se verifica también el
    HMAC del paquete.
  - **Standard**: AES-ECB, emulado sobre AES-CBC.
  - No se escribe un AES ni un SHA propios.

**Por qué no descifra el conversor:**

- **El Word limpio necesita el paquete original en claro.** El conversor
  solo da su propia versión guardada de nuevo, con otro XML
  (`Plan_1.2.md` §6.2).
- **Una contraseña equivocada se distingue** de un archivo dañado, y se
  detecta en menos de medio segundo, sin cargar los 190 MB del conversor.
- **La contraseña nunca llega a LibreOffice.**

### 2. Qué tipos de cifrado entran

- **Entran Agile**, de Office 2010 en adelante, con SHA-1 o SHA-512 (los
  probados), y **Standard**, de Office 2007.
- **Agile con SHA-256 o SHA-384** entra, porque WebCrypto los tiene. No se
  probaron con un archivo real.
- **No entran** el cifrado Extensible, el RC4 de CryptoAPI ni los
  documentos con IRM. Se rechazan con `FORMAT_UNSUPPORTED` y un `reason`
  nuevo, `"office-encryption"`.
  - El texto de la interfaz dice que la app no abre ese tipo de
    protección, y que se guarde el archivo sin contraseña desde Office.

### 3. El flujo, como el del PDF

1. **Reconocer.** `source-format.ts` reconoce el contenedor cifrado
   (ADR-238 §2.2) y lo marca como cifrado. No es un `SourceFormat`: es un
   resultado interno del módulo.
2. **Primer intento, sin contraseña.** El Orchestrator despacha
   `decrypt-office` sin contraseña, todavía en `Importing`.
   - El motor lee `EncryptionInfo`. Si el tipo no entra, lanza
     `UnsupportedFormatError` con `"office-encryption"`.
   - Si entra, lanza `OfficePasswordRequiredError` (`code:
     OFFICE_PASSWORD_REQUIRED`, `details: { incorrect: false }`) y emite
     `OFFICE_PASSWORD_REQUIRED` en `EventChannel.Convert`, con
     `{ documentId, incorrect: false }`.
3. **Espera.** El Orchestrator deja el documento en `Importing`, esperando
   `retryWithPassword`, como hace con el PDF en `Extracting` (ADR-050).
   La interfaz se suscribe a ese evento igual que al del PDF.
4. **`retryWithPassword(documentId, password)`.** Es el mismo método del
   façade, sin cambio de firma. Vuelve a despachar `decrypt-office` con la
   contraseña.
   - **Contraseña equivocada**: el mismo error y el mismo evento, con
     `incorrect: true`. La interfaz dice que la contraseña no es correcta,
     y el usuario puede intentar de nuevo o cerrar.
   - **Contraseña correcta**: devuelve el paquete en claro.
5. **Con el paquete en claro.**
   - El Orchestrator corre `source-format.ts` sobre el paquete. Sale
     `docx`, `xlsx` o `pptx`, o un `UnsupportedFormatError`: por ejemplo,
     `office-variant` si es un `.docm`.
   - Sigue con `convert-office` (ADR-240), con ese `sourceFormat`.
6. **Qué se retiene.** El paquete en claro **reemplaza** a los bytes
   cifrados en lo que el Orchestrator retiene del documento, y de ahí sale
   el Word limpio.
   - **La contraseña no se retiene.** Es al revés que en el PDF, donde el
     Render Engine vuelve a abrir el archivo cifrado (ADR-050). Acá nada
     vuelve a abrirlo.
   - Los bytes cifrados se sueltan.
7. **Lo exportado nunca lleva contraseña**, como hoy con el PDF.

### 4. Plazos y reintentos

- `timeouts["decrypt-office"]`: **60000** ms.
- `maxRetries["decrypt-office"]`: **0**, porque descifrar es
  determinista.
- `OFFICE_PASSWORD_REQUIRED` no es reintentable por el pool, como
  `PDF_PASSWORD_REQUIRED` (ADR-049 §4).
- Si el contenedor está dañado (OLE ilegible, `EncryptionInfo` corrupto o
  el HMAC no coincide), sale `OFFICE_CONVERT_FAILED` (ADR-240 §8) con
  `details.phase: "decrypt"`. El HMAC solo existe en Agile.

### 5. Memoria

Descifrar suma de 1,0 a 2,3 veces el tamaño del archivo, y pasa antes de
convertir, con el pool `convert` todavía vivo. El Orchestrator termina el
pool al terminar la conversión (ADR-240 §2), así que no se suma al pico del
OCR ni del NER.

## Consecuencias

- **Contratos nuevos**, que se escriben al pasar a los specs:
  - `ErrorCode.OFFICE_PASSWORD_REQUIRED` y `OfficePasswordRequiredError`;
  - el evento `OFFICE_PASSWORD_REQUIRED`, con
    `OfficePasswordRequired { documentId; incorrect: boolean }`;
  - `UnsupportedFormatReason` gana `"office-encryption"`;
  - `WorkerJobType` gana `decrypt-office`, con su plazo y sus reintentos;
  - `OFFICE_CONVERT_FAILED.details.phase` gana `"decrypt"`;
  - el Convert Engine gana `decryptOffice` y su entrada.
- **`retryWithPassword` sirve para los dos formatos.** Su documentación en
  `Orchestrator.md` §6 nombra el caso de Office.
- **Se retira la regla de transición de ADR-238 §6 para un Office
  cifrado**, cuando se implemente este ADR.
- **Código propio que leer con cuidado.** Un error de descifrado no expone
  datos, porque el resultado es no poder abrir el archivo. Los tests usan
  los cuatro archivos cifrados del árbol de LibreOffice. Excel y
  PowerPoint cifrados quedan sin probar con un archivo de Office: van a la
  lista de lo no verificado del frente.
