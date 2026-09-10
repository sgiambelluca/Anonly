<!-- CONTEXT: scope=adr | dependencias=ui/UX_Guidelines.md,ui/React_Client.md,ui/Components.md,07_Performance_Strategy.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md | audiencia=humanos+IA | fase=11 -->

# ADR-150 — La pantalla de escaneo dura lo que dura el escaneo

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El humano, sobre la medición del "first preview" del plan de campaña de hardening (§9, H-07). Pidió expresamente sacar el techo, conservar el piso y entrar al panel de trabajo con el escaneo terminado y el botón de exportar ya visible.
- **Relacionado con**: **ADR-087 §6 (superseded en su regla de pase)**, ADR-038 §5 (el reanálisis que vuelve a `Detecting`), ADR-151 (la página ya dibujada al entrar)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. La regla actual suelta al usuario antes de que el documento esté listo

ADR-087 §6 fijó el pase de ②a (escanear) a ②b (revisar) con **la primera** de:
20 % de las páginas procesadas en `Detecting`, o **6 s** desde el import; nunca
antes de **1,2 s**.

Medido sobre el build de producción con `text-10p.pdf` (10 páginas de texto
nativo, NER en frío, tres corridas):

| marca | corrida 1 | corrida 2 | corrida 3 |
|---|---|---|---|
| `DOCUMENT_PARSED` | 119 ms | 110 ms | 101 ms |
| `NER_MODEL_READY` | 2763 ms | 2341 ms | 2331 ms |
| **`PIPELINE_READY`** | **3960 ms** | **3490 ms** | **3536 ms** |
| pase a ②b (medido aparte) | ~2770 ms | | |

O sea: el usuario entra al panel de trabajo **entre 700 y 1200 ms antes de que
el documento esté listo**, con `stage === Detecting`.

Dos cosas que eso produce, las dos observables:

1. **El botón de exportar no está.** `ExportButton` se monta con
   `stage ∈ {Ready, Done}`: quien entra en `Detecting` llega a una superficie de
   trabajo desde la que todavía no puede terminar el trabajo.
2. **El árbol de entidades sigue llenándose debajo del cursor.** Y eso es
   exactamente lo que ADR-087 §6 declara como su razón **fuerte** para existir:

   > Protege al usuario de editar sobre datos que todavía se mueven. Las
   > entidades entran incrementalmente y cada una **renumera los marcadores** de
   > todo el documento: `[PERSONA 03]` puede pasar a `[PERSONA 04]` bajo el
   > cursor.

   La regla de pase temprano, sumada a "después del pase el escaneo sigue en
   segundo plano", deja al usuario justo en la situación que esa razón describe.

### 2. Las dos razones de §6 no se pueden cumplir a la vez

ADR-087 §6 tenía dos objetivos: **(1)** acotar la espera y **(2)** no dejar
editar sobre datos que se mueven. El techo de 6 s sirve al (1) y, al servirlo,
rompe el (2). No hay valor del techo que cumpla los dos: cualquier pase
anterior a `Ready` es un pase sobre datos en movimiento.

Este ADR elige el **(2)**, que es el que protege el resultado del trabajo, y
paga el (1) con lo que la pantalla de escaneo ya tiene: progreso real en vivo y
`Cancelar`.

## Decisión

### 1. Se pasa a ②b cuando el pipeline terminó, y no antes

`shouldAdvanceFromScan` pasa a tener una sola condición de pase: el `stage` es
terminal.

- **`Ready` / `Done`** ⇒ se pasa, **respetando el piso** de 1,2 s desde el
  import.
- **`Failed` / `Cancelled`** ⇒ se pasa **de inmediato, sin piso**. El piso
  existe para que una transición rápida no parpadee, no para retener a nadie
  frente a un error (el criterio ya escrito en `scanAdvance.ts`, que acá se
  conserva y se acota a estos dos stages).
- Cualquier otro stage ⇒ se queda.

### 2. Desaparecen el techo y el umbral por páginas

Se retiran `SCAN_ADVANCE_MAX_MS` (6000) y `SCAN_ADVANCE_PAGE_RATIO` (0,20), y
con ellos la guarda `modelLoading === null` y los parámetros que solo existían
para calcularlos: `current`, `pageCount` y `modelLoadingInProgress`.
`shouldAdvanceFromScan` queda con `stage` y `elapsedMs`.

`SCAN_ADVANCE_MIN_MS` (1200) **se conserva**, y recién ahora **ata de verdad**:
antes solo aplicaba al camino no terminal, y un `Ready` temprano lo salteaba.
Un PDF nativo chico, que llega a `Ready` en menos de un segundo, deja de hacer
parpadear la pantalla.

### 3. Qué encuentra el usuario al entrar

Por construcción, y esto es la decisión de producto, no un efecto lateral:

- el escaneo **terminado**: el árbol de entidades completo y los marcadores
  quietos;
- el **botón de exportar visible**, porque `stage ∈ {Ready, Done}` es su misma
  condición de montaje;
- la **página 1 ya dibujada**, que es lo que decide ADR-151.

### 4. La pantalla de escaneo pasa a ser la única cota, y tiene que ganárselo

Sin techo, ②a dura lo que dure el trabajo. Lo que la hace tolerable es lo que ya
tiene y no puede degradarse: progreso real por etapa, entidades apareciendo en
vivo como prueba de vida, y `Cancelar` operativo. Si algún día una etapa deja de
reportar progreso, esta pantalla se vuelve una espera ciega — y ese es el
riesgo que este ADR asume conscientemente.

### 5. El reanálisis no vuelve a ②a

Sin cambios: el latch por documento de `appPhase.ts` (`advancedForDocumentId`)
sigue igual, así que un `reanalyze` que lleva el pipeline de `Ready` a
`Detecting` (ADR-038 §5) **no** devuelve al usuario a la pantalla de escaneo.
Esa protección ya existía y este ADR no la toca.

## Consecuencias

**A favor**

- Se entra a trabajar cuando hay trabajo que hacer: árbol completo, marcadores
  estables, exportar disponible. Desaparece la ventana en la que el panel está
  abierto y a medio llenar.
- La razón fuerte de ADR-087 §6 —no editar sobre datos que se mueven— pasa a
  cumplirse de verdad, en vez de quedar contradicha por el propio techo.
- La regla se vuelve explicable en una frase: *la pantalla de escaneo dura lo
  que dura el escaneo*. Deja de haber tres números interactuando (20 %, 6 s,
  1,2 s) para decidir un momento que el usuario percibe como uno solo.

**En contra**

- **Un documento largo retiene al usuario todo el escaneo.** Un escaneado de 200
  páginas con OCR puede ser minutos, y antes el techo lo soltaba a los 6 s. Es
  el costo aceptado: lo que se soltaba a los 6 s era un panel con el árbol vacío
  (§6 lo dice: *"entra a ②b con el árbol vacío"*), y el usuario no podía hacer
  nada útil ahí más que mirar cómo se llenaba y se renumeraba.
- **La espera deja de tener cota.** Si una etapa se cuelga sin reportar progreso,
  el usuario espera sin límite. `Cancelar` es la única salida, y por eso §4 la
  vuelve una condición y no un detalle.
- Los tests de `scanAdvance.ts` que cubren techo y umbral por páginas
  desaparecen con ellos; los que cubren el piso se refuerzan, porque ahora el
  piso aplica al caso que antes lo salteaba.

**Lo que no toca**: el Core —ninguna línea, ningún contrato—, las tres fases de
ADR-087 §1, el latch por documento, ni el contenido de la pantalla de escaneo.
Cambia **cuándo** suelta, no qué muestra.

**Documentos que se actualizan con la implementación**: ADR-087 §6 queda
anotado, `ui/UX_Guidelines.md` §7.2 y la tabla de constantes de
`ui/React_Client.md`/`ui/Components.md` donde aparezcan.
