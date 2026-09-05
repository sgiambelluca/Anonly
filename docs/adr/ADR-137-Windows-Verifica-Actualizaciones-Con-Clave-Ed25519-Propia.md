<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-136-Windows-Actualiza-Sin-Verificar-Hasta-Que-Haya-Certificado.md,architecture/08_Security_Model.md,roadmap/MVP.md | audiencia=humanos+IA | fase=11.6 -->

# ADR-137 — Windows verifica actualizaciones con una clave Ed25519 propia

- **Estado**: Accepted
- **Fecha**: 2026-09-05
- **Decidido por**: El humano, al abrir el Hito 11.6.
- **Relacionado con**: ADR-131 §4, ADR-136, `08_Security_Model.md` §2.1
- **Parte de**: Hito 11.6 — Verificación propia de actualizaciones en Windows

## Contexto

El instalador NSIS de Windows sale sin Authenticode hasta que el proyecto pueda
integrar SignPath Foundation. Eso deja dos momentos distintos:

1. En la **primera instalación** todavía no existe una copia confiable de
   Anonly que pueda verificar nada. Solo Authenticode puede darle a Windows una
   identidad de editor y evitar la advertencia de SmartScreen.
2. En una **actualización**, la app ya instalada sí puede traer una clave
   pública propia y rechazar cualquier binario que no corresponda a ella.

ADR-136 aceptó temporalmente que `electron-updater` aplicara actualizaciones
con HTTPS como única protección. El Hito 11.6 existe para retirar esa excepción
antes de publicar el instalador de Windows. No reemplaza Authenticode: agrega la
capa que sí puede existir aun sin certificado.

La versión fijada, `electron-updater@6.8.9`, expone un único callback:

```ts
type VerifyUpdateCodeSignature = (
  publisherNames: string[],
  path: string,
) => Promise<string | null>;
```

`null` significa aceptar; un texto significa rechazar. Pero `NsisUpdater` solo
invoca el callback cuando `publisherName` existe en el `app-update.yml` de la
app instalada. Sin esa entrada retorna `null` antes y no verifica nada. Instalar
un callback sin resolver esa condición dejaría el hueco abierto en silencio.

También hay que impedir el *replay*. Firmar únicamente los bytes del `.exe`
permitiría publicar un instalador viejo y legítimamente firmado bajo un número
de versión inventado. La firma tiene que atar los bytes a la versión y al nombre
del artefacto que el manifiesto anuncia.

## Decisión

### 1. Una clave propia, con responsabilidades separadas

- Algoritmo: **Ed25519**.
- La privada se guarda como PEM PKCS#8 en el secret de Actions
  `WINDOWS_UPDATE_PRIVATE_KEY`. Nunca entra al repositorio, a un artefacto, a
  una línea de comandos ni a un log.
- La pública se guarda como DER SPKI codificado en base64 y queda horneada en el
  proceso main del shell. La clave pública no es secreta.
- La privada necesita un backup fuera de GitHub. Si se pierde, las instalaciones
  existentes no pueden recibir una nueva clave por un canal confiable. Si se
  filtra, la rotación exige publicar primero una versión —todavía firmada por la
  clave anterior— que confíe también en la nueva.

El límite es el mismo que en macOS: quien pueda ejecutar un workflow con acceso
al secret puede firmar. La clave cubre modificaciones posteriores al build y a
quien pueda adjuntar un artefacto sin ejecutar el workflow; no cubre el control
total del repositorio y de Actions.

### 2. La firma viaja dentro de `latest.yml`

No se publica un segundo recurso que el verificador tenga que descubrir y
descargar. El job de Windows agrega al manifiesto generado por
`electron-builder`:

```yaml
anonlyEd25519:
  schema: 1
  keyId: "<huella de la pública>"
  file: "<nombre exacto del exe>"
  sha512: "<digest base64 de los bytes finales>"
  signature: "<firma Ed25519 base64>"
```

`electron-updater` parsea el YAML sin descartar claves desconocidas y entrega
el mismo objeto en `update-available`. El shell valida y conserva solo esos
cinco campos para el archivo `.exe` seleccionado.

La firma no cubre texto YAML ni depende de su formato. Cubre la representación
canónica producida por una única función compartida entre el firmador y el
verificador:

```text
["anonly-windows-update-v1", version, file, sha512]
```

Es JSON UTF-8 de un array con posiciones fijas. El prefijo separa este uso de
cualquier otra firma hecha con la misma clave. Incluir versión, nombre y hash
impide cambiar el manifiesto o presentar un instalador firmado viejo como una
versión nueva.

El firmador corre **después** de que `electron-builder` haya producido los
bytes finales y antes de subir artefactos. Recalcula SHA-512 desde el `.exe`,
firma el sobre y agrega la metadata. Tanto un release por tag como una ejecución
manual de validación fallan si falta la clave, si no hay exactamente un
instalador Windows o si la clave no corresponde a la pública horneada. La
ejecución manual no publica: permite probar el secret real antes de crear el
tag.

### 3. Verificación obligatoria y *fail closed*

Antes de aceptar el instalador descargado, el shell comprueba, en este orden:

1. La metadata existe y su schema, algoritmo implícito y tipos son exactos.
2. `keyId` corresponde a la clave pública horneada.
3. Versión, nombre de archivo y SHA-512 coinciden con el archivo que
   `electron-updater` seleccionó en `latest.yml`.
4. El SHA-512 calculado sobre el `.exe` descargado coincide con el firmado.
5. La firma Ed25519 del sobre canónico es válida.

Cualquier ausencia, formato inválido, diferencia o error de lectura devuelve
un texto al callback. `electron-updater` borra la descarga y emite
`ERR_UPDATER_INVALID_SIGNATURE`; el renderer recibe únicamente su evento
sanitizado `error`, nunca rutas ni detalles internos.

No hay un estado persistente de “actualizaciones bloqueadas”. Si GitHub o
`latest.yml` no están disponibles, el chequeo normal falla y puede reintentarse
en el próximo arranque o con el botón manual. Si el manifiesto llega sin firma,
esa versión se rechaza siempre: tratar una firma ausente como un problema de red
convertiría el *fail closed* en un bypass.

### 4. `publisherName` fuerza el callback sin fingir Authenticode

Mientras no exista certificado, `electron-builder.yml` declara un valor
reservado y explícito en `win.signtoolOptions.publisherName`:

```yaml
win:
  signtoolOptions:
    publisherName: "__ANONLY_ED25519_ONLY__"
```

No afirma que el binario tenga ese editor. Su única función es evitar el retorno
temprano de `NsisUpdater.verifySignature()` y hacer que se invoque el callback
propio. El callback reconoce el valor reservado y, después de validar Ed25519,
acepta sin ejecutar Authenticode.

El test de salida de ADR-136 se reemplaza por uno que exige las dos piezas a la
vez: el `publisherName` reservado y la asignación de una función real a
`verifyUpdateCodeSignature`. Ninguna de las dos aislada cierra el hueco.

### 5. Cuando llegue SignPath se exigen las dos verificaciones

Antes de reemplazar el callback se conserva la función Authenticode original de
`electron-updater`. El verificador compuesto siempre ejecuta Ed25519 primero:

- Si `publisherNames` contiene únicamente el valor reservado, Ed25519 válida
  alcanza porque todavía no existe certificado.
- Cuando SignPath llegue, `publisherName` se reemplaza por el DN/CN real del
  certificado. Tras Ed25519, el callback llama al verificador Authenticode
  original con ese nombre. Las dos comprobaciones tienen que devolver éxito.

Así se comparten un único slot sin retirar la clave propia. Authenticode protege
la identidad del instalador inicial y Ed25519 mantiene una raíz de confianza
propia para las actualizaciones.

### 6. Sin dependencia criptográfica nueva

La generación, firma, SHA-512 y verificación usan `node:crypto`, disponible en
Node y en el proceso main de Electron. No se agrega una librería externa ni se
expone capacidad nueva al renderer.

## Verificación

- Vectores unitarios: firma válida, archivo alterado, versión/nombre/hash
  alterados, clave incorrecta, firma ausente o malformada y error de lectura.
- Test de configuración: `publisherName` reservado y callback real presentes.
- Test del firmador: produce metadata verificable y rechaza claves o entradas
  inválidas sin imprimir la privada.
- Threshold propio ≥85% de líneas para el módulo criptográfico puro. No intenta
  esconder ni resolver por accidente la deuda de cobertura del resto del shell.
- Gate de release: ni un tag ni `workflow_dispatch` pueden producir
  `latest.yml` sin `anonlyEd25519`; la ejecución manual valida el circuito sin
  publicar.
- Smoke de Windows: el binario empaquetado sigue abriendo por `app://`.

## Consecuencias

**A favor**

- Windows deja de ejecutar actualizaciones con HTTPS como única garantía.
- Un artefacto reemplazado, un manifiesto editado o un binario firmado viejo
  presentado como nuevo se rechazan.
- SignPath se puede sumar después sin retirar ni debilitar esta capa.
- No aparece una nueva dependencia ni una nueva salida de red.

**En contra**

- La clave privada pasa a ser infraestructura crítica y necesita backup.
- El instalador inicial sigue sin identidad de editor hasta integrar
  Authenticode; Ed25519 no puede intervenir antes de que Anonly esté instalado.
- Una cuenta con permiso para ejecutar Actions puede usar el secret y firmar.
- La rotación de clave requiere una transición firmada por la clave anterior o
  reinstalación manual.

## Documentación desplazada

Al entrar el código, ADR-136 pasa a **Superseded by ADR-137** y se corrigen los
tres lugares que hoy describen a Windows sin verificación:
`architecture/08_Security_Model.md` §2.1, `README.md` y
`apps/desktop-shell/README.md`. El punto del Hito 11.6 se cierra solo después de
que el workflow y el verificador estén probados; este ADR por sí solo no cambia
la garantía del producto.
