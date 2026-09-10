<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,tests/e2e/README.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md | audiencia=humanos+IA | fase=11 -->

# ADR-153 — El gate de tiempos se mide sobre el producto

- **Estado**: Accepted
- **Fecha**: 2026-09-10
- **Decidido por**: El planificador, sobre el informe del implementador en H-07: el presupuesto de 8 s daba rojo (8,16-8,71 s) contra `vite preview` y verde (4,5 s) contra el dev server, en el mismo instante y la misma máquina.
- **Relacionado con**: ADR-146 §3 (el instrumento de memoria es el contenedor real, misma lógica), ADR-149 §4 (un runner nuevo se documenta antes de usarse), ADR-130 (el contenedor es el producto)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El rojo era del instrumento, y está medido

Todo lo que sigue es la misma máquina, el mismo build (`VITE_E2E=1`), el mismo
`text-10p.pdf`, el mismo Chromium de Playwright, corridas **intercaladas** para
que la carga del equipo no se le atribuya a un servidor:

| Instrumento | `NER_MODEL_READY` | **import → `PIPELINE_READY`** |
|---|---|---|
| **Shell de Electron empaquetado (el producto)** | 1115-1414 ms | **2258-2917 ms** |
| Servidor estático plano sobre `dist` | 1077-2841 ms | 2234-4072 ms |
| Mismo servidor con headers de sirv (`no-cache`, `ETag`, `Content-Length`) | 1102-2010 ms | 2234-3254 ms |
| Mismo servidor sirviendo en chunks de 64 KB | 1077-1388 ms | 2390-2616 ms |
| **`vite preview`** | **7295-8420 ms** | **8625-9715 ms** |

El producto cumple el presupuesto de 8 s **con tres veces de margen**. El único
instrumento que da rojo es `vite preview`, y el sobrecosto está casi entero
adentro de la carga del modelo NER.

Que las tres variantes del servidor estático den lo mismo importa: **no es un
header, ni la compresión, ni el `Content-Length`, ni el tamaño de chunk**. Se
descartaron uno por uno.

### 2. La hipótesis del gzip no se sostiene, y se puede descartar con un número

El informe proponía que `vite preview` sirviera los 23,5 MB del WASM de ONNX sin
comprimir y que eso explicara ~4 s. Medido:

- Ninguno de los dos servidores comprime: los **23.567.050 bytes** viajan crudos
  en los dos (verificado con `Accept-Encoding: gzip`).
- Ese archivo se transfiere en **14-26 ms** en ambos, a ~1 GB/s. Es loopback: no
  hay red que ahorrar. El modelo de 170 MB tarda 60-150 ms en los dos.

O sea: comprimir podría ahorrar unos 15 ms. La diferencia a explicar es de 5000.
Y las variantes rápidas del servidor estático también sirven sin comprimir.

### 3. Los dos instrumentos hacen el mismo trabajo

Las corridas rápidas y las lentas terminan con **14 grupos** y **10 páginas de
NER**, y las dos páginas quedan `crossOriginIsolated: true` con
`SharedArrayBuffer` disponible y el mismo `hardwareConcurrency`. No es que el
rápido esté salteando trabajo ni corriendo mono-hilo.

**Por qué `vite preview` tarda cinco segundos más queda sin identificar**, y
conviene decirlo en vez de fingir que se cerró: se descartaron compresión, MIME
(`application/wasm` en los dos), aislamiento, headers de caché, `Content-Length`,
tamaño de chunk y throughput crudo. Lo que quede está adentro de su cadena de
middlewares. No se investigó más porque la decisión no depende de la respuesta:
ese servidor deja de usarse.

### 4. Y hay una razón anterior a la medición

El producto **no se sirve por HTTP**. Desde ADR-130 lo que se instala es el
contenedor de Electron, que entrega los assets por el protocolo `app://` desde
el disco local. Ni `vite dev` ni `vite preview` son eso. ADR-146 §3 ya resolvió
lo mismo para memoria: el instrumento es el contenedor real, con
`app.getAppMetrics()` leído desde el arnés.

Medir tiempos por un servidor HTTP que ningún usuario ejecuta era, desde el
principio, medir otra cosa.

## Decisión

### 1. `test:perf` corre sobre el shell empaquetado

El gate de tiempos usa el mismo arnés que los E2E —`tests/e2e/support/electronApp.ts`,
`_electron.launch()` contra `apps/desktop-shell`— con un `--user-data-dir`
propio por corrida, como ya hace ese arnés para no arrastrar `localStorage`
entre specs.

Su comando pasa a construir las dos mitades, igual que `test:e2e`:
`react-client` con `VITE_E2E=1` (que expone `__anonlyCore`, el hook por el que
el gate lee el bus) y `desktop-shell`. La fila de `07_Performance_Strategy.md`
§11.4 se actualiza con el comando y el runner reales **en el mismo cambio**.

Se retiran `playwright.perf.config.ts` apuntando a un `webServer` de Vite y
cualquier dependencia de `vite preview` en el camino del gate.

### 2. El mismo instrumento para tiempos y para memoria

Es el de ADR-146 §3. Que las dos familias de métricas salgan del mismo proceso
permite leerlas juntas —"este documento tardó X y llegó a Y MB"— en vez de tener
dos números de dos aplicaciones distintas que no se pueden cruzar.

### 3. Los presupuestos no se tocan

Los 8 s y los 60 s de `00_Project_Vision.md` §7 quedan como están. La medición
del §1 los confirma con margen; no había nada que reconciliar.

### 4. `preview.headers` se conserva, y no es el arreglo

El bloque `preview: { headers: … }` que se agregó a `vite.config.ts` **se queda**:
sin él, quien corra `pnpm preview` a mano obtiene una app sin
`SharedArrayBuffer`, con NER mono-hilo, y va a sacar conclusiones equivocadas
sobre la velocidad del producto. Es una corrección correcta por sí misma.

Pero **no arregla el sobrecosto de 5 s**: está medido con esos headers puestos y
con `crossOriginIsolated: true`. Que quede escrito para que nadie lo lea como la
solución del hallazgo.

## Consecuencias

**A favor**

- El gate mide el artefacto que se instala. Un rojo pasa a significar "el
  producto se puso lento", que es lo único que un gate de performance debería
  poder decir.
- Los números salen comparables con los de H-10 (mismo proceso, mismo
  instrumento).
- Desaparece una clase entera de falsos rojos: la del servidor de desarrollo que
  no se parece al producto.

**En contra**

- **El gate se vuelve más caro**: hay que construir las dos mitades y levantar
  Electron. Es el mismo costo que ya paga `test:e2e`, y se puede compartir el
  build entre los dos jobs, pero deja de ser un comando de segundos.
- Corre sobre un contenedor de escritorio, así que **no cubre un navegador**. Si
  algún día vuelve a haber target web, ese target necesita su propia medición;
  este gate no la da.
- **La causa del sobrecosto de `vite preview` queda sin identificar** (§3). Si
  alguien vuelve a usar ese servidor para medir cualquier otra cosa, se va a
  encontrar con lo mismo y este ADR solo le dice que no lo use.

**Lo que no toca**: los presupuestos, el código de producción, `Contracts.md`, ni
`tests/measure/`, que sigue siendo un instrumento de comparación relativa
—antes/después sobre el mismo runner— y no un gate.
