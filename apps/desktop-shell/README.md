# @anonly/desktop-shell

Contenedor de escritorio de Anonly (Electron). Sirve el build de
`@anonly/react-client` por un protocolo propio con los headers de aislamiento
y la CSP del modelo de seguridad.

**No contiene lógica de producto.** No importa motores, no toca `packages/`,
no procesa documentos: solo aloja al renderer y le garantiza el entorno que la
web dejaba en manos del hosting.

Decisiones: [ADR-130](../../docs/adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md)
(por qué Electron), [ADR-131](../../docs/adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md)
(distribución y updater), [ADR-132](../../docs/adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md)
(esta postura de seguridad) y
[ADR-137](../../docs/adr/ADR-137-Windows-Verifica-Actualizaciones-Con-Clave-Ed25519-Propia.md)
(firma propia de actualizaciones Windows),
[ADR-138](../../docs/adr/ADR-138-Instalador-Universal-De-macOS.md)
(instalador universal de macOS).

## Correrlo

```bash
pnpm --filter @anonly/react-client build   # el shell sirve este dist
pnpm --filter @anonly/desktop-shell start
```

## Los archivos

| Archivo | Qué hace |
|---|---|
| `src/main.ts` | Proceso principal: registra `app://`, crea la ventana, bloquea la navegación externa y arranca el actualizador que corresponda a la plataforma. |
| `src/security.ts` | CSP, headers de aislamiento y `Content-Length`. **Fuente única**: si divergen de `08_Security_Model.md` §3.2, el gate `csp-under-app-protocol` falla. |
| `src/paths.ts` | Traduce pathname → archivo, y rechaza todo lo que no sea un asset del build. |
| `src/preload.ts` | La superficie main↔renderer completa: `check`, `install` y `onEvent`, todos del actualizador. |
| `src/updater.ts` | Carga del puente nativo a Sparkle (macOS) y la lista blanca del payload que cruza al renderer. |
| `src/windows-updater.ts` | Actualizador de Windows sobre `electron-updater`, traducido a los mismos eventos que emite Sparkle. Compone la verificación Ed25519 propia con Authenticode cuando esté disponible. |
| `src/windows-update-signature.ts` | Sobre firmado, decoder de `latest.yml` y verificación Ed25519 del instalador descargado. La pública está horneada acá; la privada nunca entra al repo. |
| `scripts/sign-windows-update.ts` | Paso de release que recibe la privada por stdin y agrega la firma a `latest.yml`. |
| `native/` | El puente N-API a Sparkle, vendoreado. Ver su README. |

**Dos actualizadores, un solo contrato.** El renderer no sabe qué plataforma
tiene abajo: los dos emiten los mismos eventos, y el aviso, el toggle y
`UpdateNotice` son los mismos en macOS y en Windows. Windows va por
`electron-updater` porque Squirrel.Windows no exige certificado para aplicar
una actualización; macOS necesita Sparkle porque Squirrel.Mac **sí** lo exige
(ADR-131 §2/§3).

**Las dos plataformas verifican las actualizaciones con una clave Ed25519
propia.** En Windows CI firma un sobre con versión, nombre y SHA-512 del `.exe`;
la app recalcula el hash y valida la firma antes de que `electron-updater`
acepte el instalador (ADR-137). Una metadata ausente, inválida o perteneciente
a otro artefacto falla cerrado.

Esto no autentica la primera instalación. Hasta que llegue SignPath, Windows
sigue mostrando un editor no verificado y SmartScreen puede advertir al
usuario. Cuando exista Authenticode, el mismo callback exigirá primero
Ed25519 y después la firma del certificado: son garantías complementarias.

Las privadas de las dos plataformas son secrets de Actions. No están en el
repositorio, pero quien controle un workflow con acceso a esos secrets podría
firmar; cubrir ese caso exige custodia y firma fuera de GitHub (ADR-131 §4).

## El ícono

`assets/icon.svg` es la fuente; `assets/icon.png` (1024×1024) es lo que consume
`electron-builder` para generar el `.icns` de macOS y el `.ico` de Windows.
Regenerar el PNG: `pnpm --filter @anonly/desktop-shell icon`.

Es la marca de `Logo.tsx` —documento con una barra de censura— adaptada al
medio, no un símbolo nuevo: la placa oscura con la geometría de íconos de
macOS ya lo distingue de un documento PDF suelto, así que el símbolo no tiene
que hacer ese trabajo. La página va rellena en blanco y no contorneada porque
a 32 px un contorno de 1 px desaparece contra la placa, y lo único que tiene
que sobrevivir a ese tamaño es "hoja con una barra azul cruzándola".

## Por qué `app://` y no `file://`

El renderer usa **module workers** (`worker: { format: "es" }` en el
`vite.config.ts` del cliente). Bajo `file://` fallan por CORS, y `COOP`/`COEP`
no aplican a ese esquema — sin ellos no hay `SharedArrayBuffer` y
`onnxruntime-web` se autolimita a un hilo, que es el doble de tiempo de
inferencia (ADR-100).

El esquema se registra `standard` **y** `secure`: sin el primero no tiene
origen y los workers no cargan; sin el segundo no es contexto seguro y no hay
`SharedArrayBuffer`. Verificado en el spike del 2026-09-04:
`crossOriginIsolated === true` en el renderer y adentro de los workers, con el
build `ort-wasm-simd-threaded` cargando.

## Por qué CommonJS

A contramano del resto del monorepo, que es ESM. `sandbox: true` (ADR-132 §3)
obliga a que el preload sea CommonJS —Electron lo carga con `require`— y
aflojar el sandbox para ganar coherencia de módulos sería cambiar una
propiedad de seguridad por una de estilo.


## Empaquetar

```bash
pnpm --filter @anonly/react-client build    # el renderer va adentro del instalador
pnpm --filter @anonly/desktop-shell package # o package:mac / package:win
```

Salen en `release/`, ignorado por git. macOS produce un único DMG y un único
ZIP **universales**: contienen slices `arm64` y `x86_64`, y el sistema elige
automáticamente el correcto. El bridge nativo de Sparkle también es universal;
el smoke test lo comprueba con `lipo` antes de subir artefactos. El grueso del
tamaño siguen siendo los ~243 MB del `dist` del renderer —modelo NER, wasm de
Tesseract y onnxruntime, cmaps de pdfjs— que viajan adentro en vez de
descargarse (inversión de ADR-018, decidida en ADR-130).

### La firma ad-hoc no es cosmética

`electron-builder` con `identity: null` no firma, y un binario arm64 queda con
la firma *linker-signed* que trae de fábrica. Esa firma **no valida**:

```
code has no resources but signature indicates they must be present
```

Una app descargada —con `com.apple.quarantine`— cuya firma no valida es la que
muestra «"Anonly" está dañado y no se puede abrir», el cartel sin salida.
`scripts/adhoc-sign.cjs` corre en `afterPack` y sella el bundle de verdad
(`Sealed Resources version=2 ... files=239`, `satisfies its Designated
Requirement`), con lo que la app cae en el camino de «desarrollador no
identificado», que sí tiene el botón "Abrir igualmente".

Sigue sin estar notarizada: `spctl` la rechaza, como corresponde sin
certificado de Apple (ADR-131 §4). Lo que esto evita es que el rechazo sea el
insalvable.
