<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/React_Client.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-188-La-Busqueda-De-Actualizaciones-Se-Puede-Apagar.md | audiencia=humanos+IA | fase=11 -->

# ADR-195 — Las actualizaciones se eligen en un solo control

> **Enmendado por ADR-197 (2026-10-02, versión 1.0.1).** `install` pasa a instalar **al cerrar la aplicación**, en silencio, y deja de cerrarla por su cuenta; los textos de §3 cambian. La preferencia de tres valores y su migración (§1 y §2) siguen igual.

- **Estado**: Aceptado.
- **Fecha**: 2026-10-01.
- **Decidido por**: el humano, que pidió un único control en lugar de dos
  interruptores, y eligió la opción que no elimina ningún comportamiento.
- **Alcance**: `apps/react-client` (el setting, su migración y la sección
  «Actualizaciones» de Configuración). **El shell no cambia**: el mensaje
  `setAutomaticChecks` y todo ADR-188 §2 a §4 quedan como están. Sin cambio
  de contrato del Core.
- **Enmienda**: ADR-188 §1 (las dos preferencias pasan a ser una) y §5 (la
  interfaz); `Components.md` §2.6; `React_Client.md` §3.6.

## Contexto

ADR-188 separó «buscar» de «instalar» en dos interruptores. Combinados dan
tres comportamientos reales, porque con la búsqueda apagada el segundo
interruptor no cambia nada visible:

| Buscar | Instalar | Qué hace la app |
|---|---|---|
| apagado | cualquiera | no se conecta salvo con el botón |
| encendido | apagado | busca y avisa (el default) |
| encendido | encendido | busca e instala al reiniciar |

Dos controles para tres estados obligan al usuario a entender cómo se
combinan.

## Decisión

### 1. Una preferencia de tres valores

`updateMode: "install" | "notify" | "off"`, con default `"notify"`. Reemplaza
a `autoUpdate` y `checkUpdates` en `SettingsSlice`.

| Valor | Opción en la UI | Busca por su cuenta | Con una versión lista |
|---|---|---|---|
| `install` | Instalar automáticamente | sí | la instala al reiniciar, sin preguntar |
| `notify` | Avisarme | sí | muestra el aviso (`UpdateNotice`) |
| `off` | No buscar | no | muestra el aviso |

- Lo que antes leía `checkUpdates` lee `updateMode !== "off"`. Lo que leía
  `autoUpdate` lee `updateMode === "install"`.
- El mensaje al shell no cambia: se manda `setAutomaticChecks(updateMode !==
  "off")` al arrancar, y al guardar **solo si ese booleano cambió** (ADR-188
  §2). Pasar de `notify` a `install` no manda nada.
- Con `off`, «Buscar actualizaciones ahora» sigue funcionando, y lo que
  encuentra se avisa: no se instala sin preguntar.

### 2. Migración

En `load()`, si lo guardado no trae `updateMode`:

| `checkUpdates` guardado | `autoUpdate` guardado | `updateMode` |
|---|---|---|
| `false` | cualquiera | `off` |
| `true` o ausente | `true` | `install` |
| `true` o ausente | `false` o ausente | `notify` |

- Un `updateMode` que no es ninguno de los tres se carga como `notify`.
- `persist()` escribe `updateMode` y deja de escribir las dos claves viejas.
  `load()` no escribe.
- **Un caso cambia**: quien tenía la búsqueda apagada y la instalación
  encendida instalaba sin preguntar lo que encontraba con el botón. Con
  `off`, se le avisa.

### 3. Interfaz

En la sección **Actualizaciones** de Configuración, los dos interruptores se
reemplazan por un selector, igual al de Rendimiento, con tres opciones en
este orden: Instalar automáticamente, Avisarme, No buscar.

- Subtítulo de la sección: «Elegí qué hace Anonly con las versiones
  nuevas.»
- Descripción bajo el selector, en un renglón de alto fijo (ADR-169 §1):

  | Opción | Texto |
  |---|---|
  | Instalar automáticamente | «Busca versiones nuevas y las instala al reiniciar.» |
  | Avisarme | «Busca versiones nuevas y te avisa antes de instalar.» |
  | No buscar | «No se conecta a internet. Podés buscar con el botón de abajo.» |

- El aviso de red de ADR-131 §5 se conserva. Su última oración pasa a:
  «Si elegís "No buscar", Anonly no se conecta a internet salvo que toques
  "Buscar actualizaciones ahora".»
- La versión instalada y «Buscar actualizaciones ahora» no cambian.
- Todo es estático: cambiar de opción no cambia el alto del diálogo.

## Pruebas exigidas

1. **Migración**: las seis combinaciones de la tabla de §2, un `updateMode`
   guardado que se respeta, un valor desconocido que carga como `notify`, y
   `persist()` que escribe `updateMode` y no las claves viejas.
2. **Mensaje al shell**: al arrancar manda `false` con `off` y `true` con
   `notify` e `install`; al guardar, manda solo cuando el booleano cambia
   (de `notify` a `install` no manda; de `notify` a `off` manda `false`).
3. **Instalación**: con una versión lista, `install` instala y no muestra el
   aviso; `notify` y `off` muestran el aviso y no instalan.
4. **El diálogo**: las tres opciones en orden, los textos de §3 y el aviso
   de red con la oración nueva.

Cada una tiene que fallar contra el código anterior (ADR-149 §2). Los tests
de ADR-188 que afirmaban dos interruptores se reescriben para el selector;
los del shell no cambian.

## Consecuencias

**A favor**

- Un control en lugar de dos, sin perder ningún comportamiento.
- Desaparece la combinación sin efecto visible (búsqueda apagada con
  instalación encendida).

**En contra**

- Una migración más en `load()`.
- El caso de §2 que cambia de comportamiento.

## Alternativas descartadas

- **Un interruptor «buscar e instalar, o nada».** Pierde «avisarme», que es
  el default.
- **Un interruptor «buscar y avisar, o nada».** Pierde la instalación sin
  preguntar.
