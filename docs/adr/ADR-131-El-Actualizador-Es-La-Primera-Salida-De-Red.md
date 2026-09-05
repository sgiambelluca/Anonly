<!-- CONTEXT: scope=adr | dependencias=00_Project_Vision.md,architecture/08_Security_Model.md,adr/ADR-002-No-Backend.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-131 — El actualizador es la primera salida de red

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, junto con ADR-130.
- **Relacionado con**: ADR-130 (el contenedor), ADR-002 (no-backend), `08_Security_Model.md` §11 (gates `no-network-from-core`, `no-third-party-connect`)
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

### 1. Un producto que se vende como local pasa a hacer requests salientes

Hasta acá Anonly no habla con la red: el gate `no-network-from-core` lo verifica por grep sobre `packages/`. Un actualizador cambia eso, y hay que enunciarlo con precisión antes de que alguien lo lea como una contradicción del pitch:

> **El Core nunca habla con la red. El contenedor puede, exclusivamente para consultar versiones y bajar actualizaciones firmadas, y nunca con contenido de un documento.**

El gate sigue verde —el updater vive en `apps/desktop-shell`, no en `packages/`— pero el gate ya no describe al producto entero. Eso es un cambio de la postura, no un detalle de packaging.

### 2. Sin actualizador, cada versión nueva reabre el trámite de Gatekeeper

En macOS, `com.apple.quarantine` es una marca que aplica **el navegador** al descargar. Gatekeeper solo revisa archivos marcados. La secuencia importa:

1. El usuario baja el `.dmg` → queda marcado.
2. Primera apertura → bloqueo → Ajustes → "Abrir igualmente" → **macOS le quita la marca**.
3. Desde ahí la app corre sin revisión.
4. Una actualización que la app **descarga por su cuenta** nunca recibe la marca → se instala y arranca sin bloqueo.

Sin auto-update, cada versión es un `.dmg` nuevo bajado con el navegador, o sea el paso 1 otra vez: **el trámite se repite en cada release**. Con auto-update, ocurre una sola vez en la vida de la instalación. La diferencia no es comodidad; decide si el proyecto puede iterar.

### 3. La restricción real no era de macOS

Squirrel.Mac —el actualizador que Electron trae de fábrica— exige una identidad de firma de Apple **antes** de aplicar una actualización, y falla con `Could not get code signature for running application`. Ese requisito es **de Squirrel**, no del sistema operativo: §2 muestra que Gatekeeper ya no participa en ese momento.

Sparkle, el framework de actualización estándar de macOS, resuelve el mismo problema apoyándose en **una clave EdDSA propia del desarrollador** en lugar del certificado de Apple, y documenta explícitamente el caso sin Developer ID.

## Decisión

### 1. La distribución es por **GitHub Releases**, disparada por **tags**

Sin dominio, sin hosting, sin servidor. Un release es un tag (`vX.Y.Z`) más artefactos publicados por CI. **Mergear a `main` no publica nada**: publica el push de un tag. No hay branch de producción.

### 2. Windows: `electron-updater`

Auto-update completo. Funciona con o sin certificado; la firma solo decide si aparece la advertencia de SmartScreen en la **primera descarga manual**. Los instaladores que baja el updater no llevan *Mark-of-the-Web*, así que las actualizaciones se aplican en silencio.

### 3. macOS: **Sparkle**, no Squirrel.Mac

Vía [`electron-sparkle-updater`](https://github.com/Innei/electron-sparkle-updater) (MIT, bridge N-API a `Sparkle.framework`, con generación de appcast y firma EdDSA).

**Se vendorea, no se depende del paquete publicado.** El repo tenía, al evaluarlo (2026-09-04), mes y medio de vida, 7 estrellas, 0 forks, un solo autor y se describe como *work in progress*. El riesgo está acotado y hay que nombrarlo con precisión: el trabajo difícil —reemplazar una app en ejecución, verificar firmas, casos borde— **lo hace Sparkle**, que tiene veinte años de rodaje. Lo nuevo es la capa de traducción, que es glue code auditable de una sentada. Copiarla al repo bajo su licencia MIT nos deja el control y hace que el abandono del upstream no nos afecte.

### 4. La verificación de firma es **obligatoria y con clave propia**

Un actualizador descarga un archivo de internet y lo ejecuta con la confianza que el usuario le dio a la app: acceso a los documentos que está anonimizando. Sin verificar quién lo produjo, eso no es un actualizador, es un canal de ejecución remota.

- Par de claves **Ed25519**: la privada como *secret* de GitHub Actions, **nunca** en el repo; la pública embebida en la app.
- Toda actualización se firma al publicarse, y la app **rechaza** lo que no valide.
- HTTPS no sustituye esto: protege el transporte, no el origen. Alguien en el medio —wifi ajeno, DNS envenenado, un proxy— no puede alterar un release firmado sin que la app lo rechace.

> **Corregido el 2026-09-05.** Este punto decía además que la firma cubre el caso de una cuenta de GitHub comprometida, "porque la clave privada no vive en GitHub". **Es falso, y se contradecía con el primer ítem de esta misma lista**: la clave privada *sí* vive en GitHub, como *secret* de Actions. No está en el repositorio, que es otra cosa.
>
> Lo que la firma cubre de verdad: alguien que pueda alterar el artefacto después de que salió de CI, o adjuntar archivos a un release, **sin poder correr el workflow que firma**. Sube el listón, y no es poco.
>
> Lo que **no** cubre: quien tenga acceso de escritura al repo puede agregar un workflow que use ese secret y firmar lo que quiera. Para que una cuenta comprometida no alcanzara, la clave tendría que firmar **fuera** de CI —offline, en la máquina del desarrollador— y eso es una decisión aparte que **queda abierta**.
>
> El error se propagó a `08_Security_Model.md` §2.1, a los dos README y a ADR-136, y se corrigió en todos.

> **Acotado por ADR-136 (2026-09-04).** Este punto se cumple en macOS y **no** se cumple en Windows: sin certificado de firma de código, `electron-updater` aplica la actualización con HTTPS como única protección. ADR-136 registra esa excepción, por qué se tomó y cuál es su condición de salida. Lo de acá abajo sigue rigiendo tal cual.

Queda **expresamente descartado** el fork de Squirrel.Mac con la verificación removida: resuelve el síntoma creando exactamente el agujero que este punto prohíbe, y su propio README desaconseja usarlo en producción.

### 5. Qué se envía en el chequeo

Solo lo que el protocolo necesita para pedir un archivo: nada de telemetría, nada de identificadores, y **jamás** contenido, nombre o metadato de un documento. La consulta le revela a GitHub la IP y la versión instalada, y eso **se dice en la UI y en el README** en vez de esperar a que alguien lo descubra. El chequeo es desactivable.

### 6. Versionado con Changesets

`@changesets/cli` ya está instalado y sin configurar. Pasa a ser la fuente del número de versión: hoy todo está en `0.0.0` y un actualizador que compara versiones no puede funcionar así.

## Consecuencias

**A favor**

- **Auto-update en las dos plataformas sin pagar nada.** Los USD 99/año de Apple quedan comprando únicamente que desaparezca el trámite de la primera apertura.
- **El trámite de macOS es una sola vez por instalación**, no por versión (§2).
- **Una versión mala se corrige empujando el arreglo**, en vez de pedirle a cada usuario que reinstale.
- **Los prerelease dan red de seguridad**: `vX.Y.Z-beta.N` marcado como prerelease no llega a los usuarios normales.

**En contra**

- **El pitch se complica en una frase.** "100% local" pasa a necesitar la aclaración de §1. Se mitiga diciéndolo primero.
- **Dependencia nueva en el componente más sensible** (R-12; este ADR la autoriza), y encima inmadura. §3 acota el riesgo; no lo elimina.
- **Custodia de una clave privada a largo plazo.** Si se pierde, no se pueden publicar más actualizaciones y los usuarios tienen que reinstalar a mano; si se filtra, rotarla obliga a que todos instalen una versión con la clave pública nueva. Hace falta backup fuera de GitHub.
- **Dos mecanismos de actualización distintos** para mantener, uno por plataforma.
- **`08_Security_Model.md` §11 queda incompleto**: los gates describen un producto sin salidas de red. Hay que agregar el gate que verifique que la única salida es el updater, y que no viaja contenido. Se hace en ADR-132.

**Lo que no toca**

- El gate `no-network-from-core` sigue vigente y verde, sin excepciones nuevas: `packages/` no gana ni un `fetch`.
- ADR-002: sigue sin haber backend. GitHub Releases es almacenamiento de archivos, no un servidor de la aplicación.
