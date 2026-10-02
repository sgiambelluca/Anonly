<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-137-Windows-Verifica-Actualizaciones-Con-Clave-Ed25519-Propia.md,adr/ADR-188-La-Busqueda-De-Actualizaciones-Se-Puede-Apagar.md,adr/ADR-195-Las-Actualizaciones-Se-Eligen-En-Un-Solo-Control.md,architecture/08_Security_Model.md,ui/Components.md,ui/React_Client.md,ui/UX_Guidelines.md,roadmap/Roadmap_1.x.md | audiencia=humanos+IA | fase=1.0.1 -->

# ADR-197 — La actualización se instala al cerrar, en silencio, y se recupera si se corta

- **Estado**: Aceptado.
- **Fecha**: 2026-10-02.
- **Decidido por**: el humano, al probar la actualización de la 0.9.2 a la
  1.0.0: pidió un aviso de descarga, que no se abra el instalador, que
  «Instalar automáticamente» instale **al cerrar** la aplicación y no la
  cierre de golpe, y que un corte a mitad de camino no deje un programa roto.
  El planificador eligió los mecanismos.
- **Alcance**: `apps/desktop-shell` y `apps/react-client`. Sin cambio de
  contrato del Core. Sin dependencias nuevas (R-12).
- **Enmienda**: ADR-131 §3 (cuándo se instala), ADR-195 §1 (qué hace cada
  modo) y §3 (los textos); `Components.md` §2.6.
- **Versión**: 1.0.1.

## Contexto

Lo que se vio al actualizar de la 0.9.2 a la 1.0.0 en Windows:

1. **Ningún aviso durante la descarga.** Son 245 MB. El contenedor ya emite
   `download-progress` con el porcentaje; `UpdateNotice` solo escucha
   `update-downloaded`.
2. **La aplicación se cerró sola.** Con `updateMode: "install"`,
   `UpdateNotice` pide la instalación apenas termina la descarga. El texto de
   Configuración dice otra cosa: «las instala al reiniciar».
3. **Se abrió el asistente de instalación.** `installWindowsUpdate` llama a
   `autoUpdater.quitAndInstall()` sin argumentos, que es el modo visible, y el
   instalador es de tipo asistente (`oneClick: false`).

Y lo que se leyó en el código de terceros, que condiciona la solución:

- **La descarga ya es segura ante un corte.** `electron-updater` 6.8.9 baja a
  un archivo temporal y lo renombra al terminar (`AppUpdater.js`); al volver a
  abrir, reutiliza la descarga solo si su SHA-512 coincide con el del
  manifiesto (`DownloadedUpdateHelper.js`) y, si no, la descarta y baja de
  nuevo. Un archivo incompleto no se instala.
- **Una descarga reutilizada no vuelve a pasar por la verificación propia.**
  `verifyUpdateCodeSignature` (ADR-137) corre dentro de la tarea de descarga.
  Cuando el archivo sale de la caché, esa tarea no corre.
- **La instalación no es atómica.** El instalador NSIS de `electron-builder`
  26.15.3 mueve los archivos de la versión anterior a una carpeta temporal,
  extrae la versión nueva a otra carpeta temporal y después la **copia** a la
  carpeta de instalación (`extractAppPackage.nsh`, `uninstaller.nsh`). Si el
  proceso muere durante esa copia —se apaga el equipo, alguien termina la
  tarea—, la carpeta de instalación queda incompleta y la aplicación no abre.

## Decisión

### 1. Qué hace cada modo

| `updateMode` | Descarga | Instala |
|---|---|---|
| `install` | sola | **al cerrar la aplicación**, en silencio, sin reabrirla. Nunca cierra la aplicación por su cuenta |
| `notify` | sola | cuando el usuario acepta el aviso: en silencio, y la aplicación se reabre sola |
| `off` | solo con «Buscar actualizaciones ahora» | igual que `notify` para la versión que encontró |

En `install`, el aviso de «versión lista» ofrece además **«Reiniciar ahora»**,
para quien no quiera esperar a cerrar.

En `notify`, si el usuario no acepta, cerrar la aplicación **no** instala nada.

### 2. Sin asistente

En una actualización, el instalador corre siempre en modo silencioso:

- instalación pedida por el usuario: `quitAndInstall(true, true)` (silencioso,
  reabre la aplicación);
- instalación al cerrar: silenciosa y sin reabrir.

El instalador sigue siendo de tipo asistente para la **primera** instalación:
`electron-builder.yml` no cambia `oneClick`.

**Límite: instalaciones en una carpeta protegida.** El asistente deja elegir
la carpeta. Si el usuario instaló en una que pide permisos de administrador
(por ejemplo `C:Program Files`), `electron-updater` lanza el instalador con
elevación y Windows muestra su aviso de control de cuentas (UAC). En ese caso
la actualización no es del todo silenciosa: no hay asistente, pero sí ese
aviso, tanto al instalar como si la recuperación de §5.c vuelve a correr el
instalador. Con la carpeta por defecto, dentro del perfil del usuario, no
aparece. Además, si quien aprueba el UAC es otra cuenta, el instalador borra
la entrada `RunOnce` de esa cuenta y no la del usuario; la limpieza al
arrancar de §5.c la retira igual.

### 3. El contenedor conoce el modo

Hoy la política vive solo en la interfaz (ADR-131 §3). Instalar al cerrar no
se puede decidir desde la interfaz, que en ese momento ya no existe.

- Mensaje nuevo, de la interfaz al contenedor: `updater:set-install-on-quit`,
  con un `boolean`. La interfaz lo envía al arrancar y cada vez que cambia
  `updateMode`, igual que `updater:set-automatic-checks` (ADR-188 §2). Vale
  `true` solo con `updateMode === "install"`.
- Un payload que no sea `boolean` se ignora sin cambiar nada.
- Hasta recibir el primer mensaje, el contenedor **no** instala al cerrar.
- La decisión vive en un módulo puro, sin Electron, junto a
  `update-check-policy.ts`.

### 4. Aviso de descarga

**Forma, elegida por el humano (2026-10-02).** El aviso es una **tarjeta en
la esquina inferior derecha, con el estilo de los toasts** que la aplicación
ya usa (`ToastHost`): ícono redondo, título, un renglón de detalle, una
acción y la X para cerrar. Fondo sólido. Reemplaza a la franja superior, que
tapaba la barra de la aplicación y en la primera prueba era translúcida.

Se descartó una franja superior más angosta: obligaba a abreviar los textos
y seguía flotando sobre el encabezado.

| Estado | Cuándo | Título | Detalle | Ranura de acción |
|---|---|---|---|---|
| descargando | desde `update-available` hasta `update-downloaded` | «Descargando la versión X» | «N %», con N entero; «Empezando la descarga…» mientras no llegue ningún `download-progress` | barra de progreso |
| lista, modos `notify` y `off` | `update-downloaded` | «La versión X está lista» | «Anonly se reinicia para instalarla.» | botón «Reiniciar y actualizar» |
| lista, modo `install` (Windows) | `update-downloaded` | «La versión X está lista» | «Se instala al cerrar Anonly.» | botón «Reiniciar ahora» |
| lista, modo `install` (macOS, §6) | `update-downloaded` con un documento abierto | «La versión X está lista» | «Se instala la próxima vez que abras Anonly.» | botón «Reiniciar ahora» |

- **La tarjeta mide lo mismo en todos los estados y en las dos plataformas**
  (UX-10): mismo ancho que un toast, y el mismo alto. La barra de progreso
  ocupa la ranura del botón; título y detalle van siempre en un renglón cada
  uno.
- **No se cierra sola.** A diferencia de un toast de confirmación, se queda
  hasta que el usuario la cierra o la actualización se instala.
- «descargando» no tiene X. Los estados de «lista» se cierran con la X; no
  hay botón «Más tarde». Una tarjeta cerrada vuelve a mostrarse si llega un
  `update-available` posterior, por ejemplo tras «Buscar actualizaciones
  ahora».
- Convive con los toasts en la misma esquina: se apilan, y ninguno tapa al
  otro. Los toasts existentes no cambian de comportamiento ni de duración.
- Si llega `update-rejected` (§5.b), la tarjeta se retira en cualquier estado.
- Si llega `error` durante la descarga, la tarjeta se retira sin mensaje. El
  actualizador vuelve a intentar en la próxima apertura, y el detalle del
  error no cruza a la interfaz (ADR-131 §5).
- La interfaz **deja de pedir la instalación por su cuenta**: el `useEffect`
  que llamaba a `updater.install()` en modo `install` se retira.

Los textos de Configuración (ADR-195 §3) pasan a:

| Modo | Descripción |
|---|---|
| Instalar automáticamente | «Busca versiones nuevas y las instala al cerrar Anonly.» |
| Avisarme | «Busca versiones nuevas y te avisa cuando están listas.» |
| No buscar | sin cambios |

### 5. Recuperación ante un corte (Windows)

**a. Descarga cortada.** No se agrega nada: lo cubre `electron-updater`
(Contexto). Queda escrito para que nadie lo reimplemente.

**b. Se verifica otra vez antes de instalar.** Justo antes de lanzar el
instalador, por cualquiera de los dos caminos, el contenedor vuelve a
verificar el archivo con `verifyWindowsUpdateFile` contra la firma del
manifiesto de esa versión (ADR-137). Si falla: no se instala, se descarta la
descarga pendiente, se registra en el log y se emite un evento propio,
`update-rejected`, sin más datos que el tipo. La interfaz retira con él el
aviso de «versión lista», que si no quedaría con un botón que ya no hace
nada. No se reutiliza `error`: ese también llega por una búsqueda fallida, y
la interfaz no podría distinguirlos.

El mismo evento se emite cuando el instalador **no llega a lanzarse** (falla
en el momento, dentro de la llamada que lo lanza): la descarga queda dada de
baja y el botón de la tarjeta ya no haría nada. Un `error` que llega después
de lanzado el instalador no cuenta como fallo de lanzamiento: no se puede
distinguir de uno de búsqueda o de descarga, así que la marca y la entrada
de recuperación de §5.c **se conservan**. Esto cubre
además la descarga reutilizada de la caché, que hoy no pasa por esa
verificación.

**c. Instalación cortada.** Antes de lanzar el instalador, el contenedor deja
dos cosas, de forma síncrona:

- una **marca** en la carpeta de datos de la aplicación
  (`pending-install.json`: versión que se instala y ruta del instalador);
- una entrada en `HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce`,
  de nombre `AnonlyUpdateRecovery`, que vuelve a correr ese mismo instalador
  en silencio en el próximo inicio de sesión de Windows.

Y se retiran así:

- **El instalador borra la entrada `RunOnce` cuando termina bien.** Va en un
  script propio de NSIS (`nsis.include`, macro `customInstall`). Si el
  instalador no llega al final, la entrada queda y Windows lo vuelve a correr
  en el próximo inicio de sesión.
- **La aplicación, al arrancar, borra la marca y la entrada** si las
  encuentra, sea cual sea la versión que arrancó. Si arrancó la versión
  nueva, la instalación terminó. Si arrancó la anterior, el instalador no
  llegó a tocar nada, y el actualizador vuelve a ofrecer la descarga que
  sigue en la caché.

La entrada se escribe y se borra con `reg.exe`, invocado por su ruta absoluta
dentro de `%SystemRoot%\System32`, con los argumentos como lista y sin shell.
Si la escritura falla, se registra en el log y la instalación **sigue**: la
ventana de riesgo son los segundos que dura la copia, y dejar a alguien sin
actualizar para siempre es peor.

**Límite de seguridad, aceptado.** La entrada `RunOnce` ejecuta un archivo de
la caché del usuario sin volver a verificarlo en ese momento. Quien pueda
reemplazar ese archivo ya puede escribir en `HKCU` y en la carpeta del
usuario, que es la misma frontera de confianza que `08_Security_Model.md` ya
describe para el contenedor. La verificación de §5.b ocurre antes de
registrar la entrada.

**macOS.** Sin cambios en la recuperación: la instalación la hace Sparkle,
fuera de este código.

### 6. macOS: se instala al abrir, no al cerrar

Decidido por el humano (2026-10-02). Instalar al cerrar pediría tocar el
puente nativo de Sparkle, que no se puede probar sin una Mac. Instalar **al
abrir** usa lo que el puente ya hace:

- Cuando hay una actualización ya bajada de una sesión anterior, Sparkle la
  informa al arrancar y el puente emite `update-downloaded`
  (`sparkle_bridge.mm`, etapa `SPUUserUpdateStageInstalling`).
- `installUpdateNow()` la instala y reabre la aplicación. Es la misma
  llamada que las versiones anteriores hacían en modo `install`.

En macOS, con `updateMode === "install"`:

- Si `update-downloaded` llega **antes de que se haya abierto ningún
  documento en esta sesión, y sin una importación en curso**, la interfaz
  pide la instalación sin preguntar. Una importación en curso cuenta como
  documento abierto: el usuario ya soltó un archivo y está esperando.
  Es el caso de abrir la aplicación con una actualización pendiente: se
  actualiza y se reabre antes de que haya trabajo que perder.
- Si llega **con un documento abierto, o después de haber abierto alguno**,
  no se instala. La tarjeta dice «Se instala la próxima vez que abras
  Anonly.» y ofrece «Reiniciar ahora» (§4).
- `updater:set-install-on-quit` no tiene efecto en macOS: el contenedor lo
  recibe y lo ignora.

**Cómo sabe la interfaz en qué plataforma corre.** Hoy no lo sabe. El
contenedor se lo informa por la misma vía que la RAM instalada (ADR-194 §4):
un dato de solo lectura en `window.anonlyDevice`, que el preload recibe por
argumento. El campo es `platform`, con tres valores posibles: `"windows"`,
`"macos"` u `"other"`. No se lee `navigator.userAgent`. Si el dato falta,
la interfaz se comporta como en `"other"`: avisa y espera, sin instalar
sola en ningún momento.

La descripción de «Instalar automáticamente» en Configuración es, en macOS:
«Busca versiones nuevas y las instala al abrir Anonly.»

El aviso de descarga (§4) funciona igual: el puente ya emite
`download-progress` y `update-downloaded`.

**Sin probar.** No hay una Mac en este entorno. Lo que respalda el diseño es
la lectura del puente, y que no agrega ninguna llamada nueva al código
nativo. Se verifica a mano en una Mac antes de darlo por bueno, y se anota en
`Roadmap_1.x.md`.

### 7. Qué versión estrena esto

La actualización de la 1.0.0 a la 1.0.1 la ejecuta el código de la **1.0.0**:
todavía va a mostrar el asistente. El comportamiento nuevo se ve a partir de
la actualización siguiente a la 1.0.1.

## Cómo se verifica

- **Tests puros**: la política de instalar al cerrar (payload inválido, antes
  del primer mensaje, cambios de modo), la decisión de arranque sobre la
  marca, el armado de los argumentos de `reg.exe`, y los estados de
  `UpdateNotice`.
- **Tests estáticos**: que `electron-builder.yml` incluya el script de NSIS y
  que ese script borre el valor `AnonlyUpdateRecovery`.
- **De punta a punta, en Windows**: un build empaquetado de esta branch con
  la versión forzada a una menor que la 1.0.0 ve a la 1.0.0 publicada como
  actualización, firmada con la clave real.
  - **Hecho el 2026-10-02** con un build forzado a 0.9.9: el script de NSIS
    compila dentro del instalador; `anonlyDevice.platform` llega como
    `"windows"`; el aviso pasa por «Descargando la versión 1.0.0…», «… 100 %»
    y «La versión 1.0.0 está lista.» con «Reiniciar y actualizar»; en modo
    `install` dice «La versión 1.0.0 se instala al cerrar Anonly.» con
    «Reiniciar ahora». La descarga fue diferencial y duró un segundo, así que
    no se vieron porcentajes intermedios.
  - **Instalación, hecha por el humano el mismo día** con ese build, sobre
    una instalación en `C:Program Files`:
    - al cerrar, en modo `install`: se escribieron la marca y la entrada
      `RunOnce`, el instalador corrió en silencio, la carpeta de instalación
      se recreó en unos cuatro segundos, no apareció el asistente y la
      aplicación no se reabrió;
    - con «Reiniciar y actualizar», en modo `notify`: sin asistente, y la
      aplicación se reabrió sola.
    - No apareció el aviso de UAC: ese equipo tiene la política de Windows
      «elevar sin preguntar». Con la política habitual sí aparece (§2).
    - El instalador de la 1.0.0 es anterior a este ADR y no borra la entrada
      `RunOnce`: se retiró a mano después de cada prueba. El borrado por el
      instalador se estrena con el de la 1.0.1.
  - La tarjeta de §4 se vio en la aplicación en los estados de «lista», en
    claro y en oscuro (380 × 106 px en todos), y apilada con un toast de
    «Deshacer». El estado «descargando» no se llegó a capturar.
- **Sin verificar por medios automáticos: el corte real.** Matar el
  instalador durante la copia y comprobar que el próximo inicio de sesión
  repara la instalación deja al equipo sin la aplicación mientras dura la
  prueba. Se hace a mano, en una máquina virtual o en Windows Sandbox, y su
  resultado se anota en `Roadmap_1.x.md`.

## Lo que no se hace

- **Instalación atómica.** Pediría reemplazar el instalador de
  `electron-builder`. La recuperación de §5.c acota el daño; no lo evita.
- **Diferir la instalación en `notify` hasta el cierre.** En `notify` decide
  el usuario, cada vez.
- **Instalar al cerrar en macOS**: se instala al abrir (§6).
