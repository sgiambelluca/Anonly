<!-- CONTEXT: scope=adr | dependencias=ui/React_Client.md,core/Contracts.md,07_Performance_Strategy.md,adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,roadmap/Post_Hito10.8_Pendientes.md | audiencia=humanos+IA | fase=11 -->

# ADR-155 — El arnés de medición configura el Core por un canal propio

- **Estado**: Accepted
- **Fecha**: 2026-09-10
- **Decidido por**: El humano, autorizando el canal que el implementador pidió para poder atribuir memoria pool por pool en H-10.
- **Relacionado con**: ADR-154 (que vuelve central la pregunta por pool), ADR-146 (que exige registrar la configuración efectiva de cada corrida), ADR-039 (`EngineConfigOverrides`, el tipo que este canal reusa), `Post_Hito10.8_Pendientes.md` §30 (la lección sobre superficie que vive solo para los tests)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. La atribución necesita mover un pool por vez, y no se puede

La única vía para cambiar tamaños de pool desde afuera es
`settings.performancePreset`, y sus tres valores son **baldes**: `low` pone los
cuatro pools en 1 y `high` los pone en 4/2/2/4. La atribución de H-10 tuvo que
reportar su resultado más importante con esta salvedad:

> `ocrPoolSize:1` solo es alcanzable vía el preset "low", que también baja los
> otros tres pools a 1 — no hay override más fino.

Con ADR-154 la pregunta central pasó a ser exactamente esa: cuánto cuesta **cada**
pool por separado. Sin un canal fino, esa pregunta no tiene cómo contestarse.

### 2. Lo que ya existe y por qué no alcanza

`settingsOverride.ts` escribe `localStorage["anonly:settings"]` antes del boot,
pero solo puede expresar lo que `SettingsSlice` declara: idioma, preset,
`nerEnabled`, idiomas de OCR. Ni `ocrPoolSize` suelto ni `ocr.dpi` son
alcanzables por ahí.

Ensanchar `SettingsSlice` para exponerlos sería repetir el error que
`Post_Hito10.8_Pendientes.md` §30 ya documenta con `nerEnabled`: declarar como
preferencia de usuario algo que ningún usuario puede alcanzar.

## Decisión

### 1. Un canal propio, con la guarda que ya existe

`initCore` (`apps/react-client/src/core-adapter/index.ts`) lee
**`localStorage["anonly:engine-overrides"]`** y lo mergea **por encima** del
`EngineConfigOverrides` derivado de los settings, antes de `createCore`.

Va bajo la **misma guarda** que ya protege la exposición de `__anonlyCore`:
`import.meta.env.DEV || import.meta.env.VITE_E2E === "1"`. Vite reemplaza esas
constantes literalmente, así que en un build de producción el cuerpo se elimina y
el canal no existe.

No hay tipo nuevo: el valor es un `EngineConfigOverrides` (ADR-039), el mismo que
`createCore` ya acepta.

### 2. Reglas del canal

- **Se lee una sola vez, en el boot.** No hay camino de mutación en runtime: un
  canal que se pueda cambiar con un documento abierto sería una segunda fuente de
  verdad sobre la configuración efectiva.
- **Falla cerrado y en silencio**: JSON inválido, tipo inesperado o clave
  desconocida se ignoran y el boot sigue con los settings normales. Un fixture de
  test roto no puede impedir que la app arranque.
- **No es una preferencia**: no aparece en `SettingsSlice`, no se persiste desde
  la app, no tiene control de UI y no se muestra en ningún lado.

### 3. Se documenta donde se busca

En `ui/React_Client.md` §3.7, junto al mapeo settings → `EngineConfig`, y en el
README de `tests/perf/`. La lección de §30 no es "no agregues superficie de
test": es que la superficie que vive solo para los tests **se documenta**, o
dentro de seis meses nadie sabe por qué existe.

### 4. Toda medición registra la configuración efectiva

ADR-146 §4 ya lo exige. Con este canal deja de ser una formalidad: una corrida
con overrides y una sin ellos pueden diferir en cualquier campo, así que un
resultado sin su configuración efectiva al lado no es interpretable.

## Consecuencias

**A favor**

- La atribución por pool pasa a ser posible sin cambiar defaults de producción ni
  inventar presets nuevos.
- Reusa el tipo, la guarda y el patrón que ya existen; no agrega contrato.
- Sirve para todo lo que viene: `ocr.dpi`, `maxLiveImageBytes` y cualquier otro
  campo que H-10 necesite mover para atribuir.

**En contra**

- **El build que se mide no es exactamente el que se instala.** Ya era cierto
  —`__anonlyCore` vive bajo la misma guarda y ADR-153 aceptó medir sobre el build
  de E2E—, y este canal agrega una lectura de `localStorage` en el arranque. Es
  chico y está declarado, pero es una diferencia más.
- Un canal que puede fijar **cualquier** campo es fácil de usar mal: una
  medición con un override olvidado describe otra aplicación. Por eso §4.
- Es superficie que vive para los tests, con el riesgo de §30. Se acepta con la
  documentación de §3 como condición, no como buena intención.

**Lo que no toca**: `Contracts.md`, `SettingsSlice`, los defaults del Core, el
comportamiento de producción, ni el Core — el canal vive entero en el adaptador.
