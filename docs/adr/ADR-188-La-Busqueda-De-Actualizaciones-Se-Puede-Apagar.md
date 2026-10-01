<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-137-Windows-Verifica-Actualizaciones-Con-Clave-Ed25519-Propia.md,architecture/08_Security_Model.md,ui/Components.md,PRIVACY.md,roadmap/SignPath_Postulacion.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-188 — La búsqueda de actualizaciones se puede apagar

- **Estado**: Aceptado.
- **Fecha**: 2026-09-26.
- **Decidido por**: el humano, a propuesta del planificador.
- **Alcance**: `apps/desktop-shell` (main, preload, actualizador de Windows) y
  `apps/react-client` (configuración, frontera `updater/`, diálogo de
  Configuración). Sin cambio en `packages/`, contratos del Core, error codes
  ni en el addon nativo de Sparkle.
- **Relacionado con**: ADR-131 §5 (lo que este ADR vuelve a cumplir), ADR-132
  §3 (superficie main↔renderer), ADR-137 (verificación de actualizaciones en
  Windows).

## Contexto

ADR-131 §5 decidió que el chequeo de actualizaciones, la única salida de red
del producto, **es desactivable**. Lo repiten `08_Security_Model.md` §3.1 y
el README. El código dejó de cumplirlo:

- En macOS, `main.ts` llama a `bridge.setAutomaticChecks(true)` siempre.
- En Windows, `startWindowsUpdater` llama a `checkForUpdates()` al arrancar,
  siempre.
- El único control, «Actualizar automáticamente», decide si una actualización
  ya descargada se instala sola o se avisa. No decide si se busca.

La regresión tiene historia (ADR-132 §3). Existió un `setAutomatic` que
cableaba ese toggle a `automaticallyChecksForUpdates` de Sparkle. Como el
toggle viene apagado por defecto, la app dejaba de buscar actualizaciones
mientras la UI prometía avisar. El arreglo fue quitar el mensaje y buscar
siempre. Eso corrigió la confusión entre **buscar** e **instalar**, pero se
llevó también la posibilidad de no buscar, sin que ningún documento lo
registrara.

Ahora hace falta por dos motivos. Primero, lo que la documentación promete
no es lo que hace la app. Segundo, la política de privacidad que pide
SignPath (`PRIVACY.md`, `roadmap/SignPath_Postulacion.md` §2) queda más clara
si el usuario puede cortar la única conexión.

## Decisión

### 1. Dos preferencias distintas, con nombres distintos

> **Enmendado por ADR-195 (2026-10-01).** Las dos preferencias pasan a ser una, `updateMode` (`install`, `notify`, `off`), elegida en un selector. Lo que esta sección llama `checkUpdates` es `updateMode !== "off"`, y `autoUpdate` es `updateMode === "install"`. El mensaje al shell y §2 a §4 no cambian.

| Preferencia | Qué decide | Default |
|---|---|---|
| `checkUpdates` — «Buscar actualizaciones automáticamente» | si la app consulta a GitHub por su cuenta | **activada** |
| `autoUpdate` — «Actualizar automáticamente» (existente) | si una actualización ya descargada se instala sola o se avisa | desactivada (sin cambios) |

Son independientes. `autoUpdate` sigue aplicando cuando la búsqueda la pide
el usuario con «Buscar actualizaciones ahora».

`checkUpdates` viene activada porque las actualizaciones llevan correcciones.
Además, así las instalaciones existentes se comportan igual que hoy: una
configuración persistida sin la clave se lee como `true`.

### 2. El main no busca hasta que el renderer le dice qué prefiere el usuario

La preferencia vive en el renderer (`settings.store.ts`, `localStorage`), como
las demás. El main **no hace ninguna consulta automática** hasta recibir un
mensaje nuevo, `updater:set-automatic-checks`, con un booleano. Si nunca llega
—la ventana no cargó, el renderer falló—, no hay consulta. El caso de falla
queda del lado de no conectarse.

El renderer lo envía en dos momentos:

1. una vez al iniciar, después de leer la configuración persistida;
2. cada vez que el usuario guarda un cambio de `checkUpdates` en
   Configuración, en el mismo punto donde se persiste (`applyToStore`).

El main valida el payload: si no es un `boolean`, lo ignora y no cambia nada.

### 3. Qué hace cada plataforma con el mensaje

**Windows (`electron-updater`).** `startWindowsUpdater` registra los
listeners y el verificador de ADR-137 igual que hoy, pero **ya no llama a
`checkForUpdates()` al arrancar**. Regla: como máximo **una búsqueda
automática por ejecución**. Ocurre la primera vez que la preferencia recibida
es `true`. Un `false` no dispara nada. Un `true` posterior a un `false`
dispara la búsqueda solo si en esa ejecución todavía no hubo ninguna.

**macOS (Sparkle).** El addon se carga al arrancar como hoy, pero
`bridge.init(...)` se **difiere** hasta el primer mensaje. Al recibirlo, en el
mismo tick de JavaScript, se llama a `init(...)` y enseguida a
`setAutomaticChecks(valor)`. Se hace así por dos motivos:

- `setAutomaticChecks` fija `automaticallyChecksForUpdates`, que Sparkle
  **persiste** en las preferencias del usuario. Las instalaciones actuales lo
  tienen guardado en `true`.
- `startUpdater` (dentro de `init`) no consulta de forma sincrónica: agenda la
  consulta en el run loop. Ese run loop no corre hasta que el tick de
  JavaScript del main termina, y para entonces la preferencia real ya está
  aplicada.

Los mensajes siguientes solo llaman a `setAutomaticChecks(valor)`. El addon
nativo no se toca, y `SUEnableAutomaticChecks` sigue en el `Info.plist`: evita
el diálogo de permiso propio de Sparkle, que la app no muestra.

**En las dos plataformas**, «Buscar actualizaciones ahora» funciona siempre.
Es una consulta que pide el usuario, y es la excepción que la política de
privacidad declara.

### 4. La superficie main↔renderer pasa de tres mensajes a cuatro

`updater:set-automatic-checks` se suma a `check`, `install` y `onEvent`. El
preload lo expone como `setAutomaticChecks(enabled: boolean)`, y la frontera
`apps/react-client/src/updater/` lo agrega a `ShellUpdater` y a
`isShellUpdater`. Renderer y shell viajan en el mismo instalador, así que no
hay combinaciones de versiones que contemplar.

**No repite el error que ADR-132 §3 corrigió.** Aquel mensaje colgaba del
toggle de **instalar**. Este cuelga de un toggle propio que significa
exactamente lo que significa la propiedad de Sparkle: buscar.

### 5. Interfaz

> **Reemplazada por ADR-195 §3**: un selector de tres opciones en lugar de los dos interruptores.

En la sección **Actualizaciones** de Configuración:

- se agrega un segundo interruptor, «Buscar actualizaciones automáticamente»,
  encima de «Actualizar automáticamente»;
- el aviso de red de ADR-131 §5 suma una oración al final: *«Si desactivás
  la búsqueda automática, Anonly no se conecta a internet salvo que toques
  "Buscar actualizaciones ahora".»*;
- el subtítulo de la sección pasa a describir los dos controles:
  *«Elegí si Anonly busca versiones nuevas por su cuenta y si las instala
  sola al reiniciar o te avisa.»*

Todo es estático: no aparece ni desaparece nada al tocar los controles. El
layout no se desplaza.

## Pruebas exigidas

- **Shell, unit** (sin Electron real, con dobles):
  - Windows no busca al iniciar.
  - Busca una sola vez con el primer `true`.
  - No busca con `false`.
  - Un `true` después de una búsqueda ya hecha no repite.
  - La búsqueda manual funciona con la preferencia apagada.
  - Un payload no booleano se ignora.
- **Shell, unit, macOS:** `init` no se llama antes del primer mensaje, y
  `setAutomaticChecks` se llama inmediatamente después de `init`, con el
  valor recibido. La lógica que decide esto sale de `main.ts` a un módulo
  puro, igual que se hizo con la verificación de ADR-137. Así entra en la
  cobertura del shell.
- **Renderer:**
  - `checkUpdates` persiste, y una configuración sin la clave se lee como
    `true`.
  - El mensaje se envía al iniciar y al guardar un cambio.
  - No se envía fuera del contenedor de escritorio.
  - El diálogo muestra el interruptor nuevo y el texto de §5.
- **Gates existentes** siguen verdes: `updater-payload-clean`,
  `network-destinations`, `shell-no-egress`.
- **Verificación manual sobre el instalador empaquetado** (el humano), con la
  búsqueda apagada: al abrir la app no sale ninguna conexión hacia GitHub, y
  «Buscar actualizaciones ahora» sí consulta. En Windows y en macOS. Los E2E
  no lo cubren, porque corren desempaquetados y ahí ningún actualizador
  arranca.

## Consecuencias

- ADR-131 §5 vuelve a ser cierto. El README, `08_Security_Model.md` §3.1 y
  `PRIVACY.md` pueden decir que la única conexión se apaga desde
  Configuración.
- La primera búsqueda de cada ejecución ocurre unos instantes más tarde, al
  cargar el renderer y no al arrancar el main. No tiene efecto visible.
- ADR-132 §3 se corrige: la superficie es de cuatro mensajes, y se explica
  por qué este no es el `setAutomatic` retirado.
- Si alguien apaga la búsqueda y nunca busca a mano, se queda en su versión.
  Es la elección que ADR-131 §5 le reconoce.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Corregir ADR-131 y el README para decir que no se puede apagar | Deja al usuario sin forma de cortar la única conexión desde la app. Obliga a una política de privacidad más débil ante SignPath. |
| Que el main persista la preferencia en su propio archivo | Duplica la fuente de verdad de la configuración y suma escritura de disco desde el main. El renderer ya tiene la preferencia; esperar su mensaje es suficiente. |
| Reusar «Actualizar automáticamente» para las dos cosas | Es exactamente el error que ADR-132 §3 corrigió: mezcla buscar con instalar. |
| Sacar `SUEnableAutomaticChecks` del `Info.plist` y agendar la búsqueda de macOS desde el main | Obliga a tocar cómo Sparkle agenda sus búsquedas, y eso no se puede probar desde Windows. El diferimiento de `init` logra lo mismo sin tocar el addon ni el plist. |
