<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/React_Client.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-048-Plan-De-Cierre-Hito-10.md | audiencia=humanos+IA | fase=11 -->

# ADR-125 — La configuración se toca antes del primer documento

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano, que pidió poder configurar la app **antes** de que empiece el escaneo de un PDF.
- **Relacionado con**: **ADR-087** (que sacó la toolbar de la primera pantalla), **ADR-038 §7** (que ya decidió qué pasa al cambiar settings sin documento abierto), ADR-048 §7 punto 2 / PR16.5 (bootstrap settings → `EngineConfig`)
- **Parte de**: Hito 11

## Contexto

### 1. Hoy no hay forma de abrir Configuración sin un documento

`SettingsButton` vive en la `Toolbar`, y ADR-087 §1 dejó la `Toolbar` **fuera** del momento ① (`LoadScreen`): *"sin documento no hay nada que mostrar ahí"*. Para el estado del pipeline, el progreso y el botón de exportar eso es cierto y el ADR sigue vigente.

Pero ahí adentro viajaba también el único acceso a Configuración, y **ADR-087 no lo menciona ni una vez** — no hay una sola aparición de "Configuración" ni de "Settings" en todo el documento. No fue una decisión sobre el acceso a los settings: fue una consecuencia que nadie miró. El resultado es que la única forma de llegar a Configuración es cargar un PDF primero, que es exactamente lo contrario de lo que hace falta para elegir **con qué** se lo va a analizar.

### 2. El caso "sin documento abierto" no es hipotético: ya está decidido

ADR-038 §7 razona explícitamente sobre él y decide, sobre `performancePreset`:

> *"sin documento abierto, la UI recrea el core al vuelo (nada que perder); con documento abierto, el cambio queda persistido y **aplica al próximo documento**"*

`SettingsDialog` implementa la mitad con documento abierto (confirmación + `reanalyze`). La otra mitad quedó **inalcanzable desde la UI**, y la señal de que se esperaba está en el código: `disposeCore` existe, y su propio docstring dice que es *"para un flujo futuro de recreación del core (ADR-038 §7, `performancePreset` sin documento abierto)"*. Nunca llegó ese flujo porque no había desde dónde dispararlo.

### 3. Persistir no alcanza, y un botón que solo persiste sería una palanca desconectada

`initCore` es idempotente por diseño (`if (core) return core`) y corre **una sola vez por carga de la app**, en el `useEffect` de arranque de `App.tsx`. `createCore` congela su `mergedConfig` y lo reparte a cada motor por `ctx`: no hay API pública para reconfigurarlo, y `reanalyze` —la única vía de cambio en caliente— exige un `documentId`.

O sea que un botón que solo guarde los settings dejaría esto: el usuario abre Configuración en la landing, desactiva NER, carga el PDF, y el análisis corre **con NER activado igual**, porque el core se creó al abrir la página. La configuración recién tendría efecto en la próxima carga de la app.

Ese modo de falla es el que este repo ya conoce de memoria: un control que existe, no falla, no avisa, y no hace nada (ADR-119, una detección de orientación que nunca corrió; errata v1.2.1 de `OCR_Engine.md`, un OCR que llegaba a "Listo" con cero entidades). **Un botón de configuración que no configura es peor que no tener botón**, porque el usuario cree que eligió.

## Decisión

### 1. Un botón de Configuración en `LoadScreen`, no la toolbar entera

Entrada a `SettingsDialog` desde el momento ①. **ADR-087 no se revierte**: no vuelven a la primera pantalla el estado del pipeline, el progreso, el export ni el cierre de documento — nada de eso tiene sentido sin documento, y esa parte del ADR se sostiene. Lo único que se restituye es el acceso a lo que se elige **antes** de tener uno.

### 2. Guardar sin documento abierto recrea el core

Implementa ADR-038 §7 tal como está escrito, sin API nueva del Core y sin tocar un contrato: `disposeCore()` + `initCore(overrides)` con el `EngineConfigOverrides` derivado de los settings nuevos (`settingsToEngineConfig.ts`, el mismo mapeo del bootstrap de PR16.5).

**Solo si el override cambió.** `language` es UI pura y no toca el `EngineConfig`: cambiarlo no puede costar la recreación de cinco workers. La comparación es una función pura sobre el override derivado, no sobre los settings crudos.

### 3. La recreación ocurre con el diálogo abierto, no después de cerrarlo

`importDocument` usa `getCore()`, que **lanza** si el core no existe. Entre el `dispose` y el `init` hay una ventana sin core, y soltar un PDF ahí tiraría un error que `LoadScreen` traga (su `catch` solo apaga el estado "Abriendo…"). Como `SettingsDialog` es modal, hacer la recreación **antes de cerrarlo** —con el `saving` que el diálogo ya tiene— cierra la ventana por construcción: mientras se recrea, no hay dónde soltar nada. Un fallo va al `saveError` que el diálogo ya renderiza.

## Consecuencias

- El momento ① gana **un** control, y es el único que ahí significa algo.
- Los cinco workers se recrean al guardar un cambio de `EngineConfig` sin documento abierto. No se re-descarga ningún modelo: desde ADR-099 los kernels se cargan cuando se usan, y ninguno se usó todavía.
- `disposeCore` deja de ser una función que solo usan los tests y pasa a estar en un camino de producto. Su docstring decía que ese día iba a llegar.

**En contra**

- **Es un estado más que puede fallar.** Si `createCore` rechaza durante la recreación, la app queda sin core hasta que el usuario reintente. Es el mismo riesgo que el `initCore` del arranque ya corre, con la diferencia de que acá hay un `saveError` visible en vez de un `console.error`.
- **Cambiar el preset de rendimiento sin documento ahora cuesta**, donde antes era gratis (y no hacía nada). Es el precio de que haga algo.

**Lo que no toca**: ningún contrato de `core/Contracts.md`, ningún motor, el flujo con documento abierto (confirmación + `reanalyze` de ADR-038 §7), ni el resto de ADR-087.

## Qué hay que cubrir con tests

- El override derivado decide la recreación: dos settings que difieren solo en `language` **no** recrean; `nerEnabled`, `ocrLanguages` y `performancePreset` sí.
- Guardar sin documento abierto no dispara `reanalyze` (sigue siendo el camino de ADR-038 §7 con documento).
- E2E: elegir una configuración en la primera pantalla y cargar un PDF después la respeta. Es lo único que prueba que el botón no es decorativo — que es el punto entero de este ADR.
