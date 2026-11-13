<!-- CONTEXT: scope=adr | dependencias=roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-166-El-Modelo-De-NER-Se-Libera-Al-Terminar-La-Deteccion.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,roadmap/mediciones/ner/AB_Intercalado_Medicion.md,roadmap/mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md | audiencia=humanos+planificador+implementador+revisor | fase=1.x -->

# ADR-226 — El modelo de NER no espera cargado durante el OCR del documento siguiente

- **Estado**: **Accepted** por el humano el 2026-11-05 e implementado en
  `perf/pico-memoria`. **Refutado en el banco Linux con NER (2026-11-13)**: no
  baja el pico caliente de P2, ni solo ni en combinación
  (`Reduccion_De_Pico_Nube_2026-11.md` §6.1). Por la condición de §5 corresponde
  revertirlo; falta la confirmación en Windows y la decisión del humano.
- **Fecha**: 2026-11-05
- **Propuesto por**: el planificador, en la campaña de reducción de pico
  ([`Reduccion_De_Pico_Nube_2026-11.md`](../roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md),
  candidato C-2).
- **Relacionado con**: ADR-157 (baja del pool de OCR al terminar su etapa),
  ADR-166 y ADR-167 (cuándo se suelta el modelo de NER), ADR-154 (los levers de
  memoria aceptados), ADR-192 (techos por perfil).

## Contexto

### 1. El segundo documento escaneado pica más que el primero

En Windows, sobre el producto final de Confianza
([`Memoria_Final_Confianza_2026-10-11.md`](../roadmap/mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md)),
P2 (50 páginas escaneadas, OCR y NER) dio 1935–2190 MB en frío y
**2755–2820 MB en caliente**. El máximo caliente es el que deja a P2 a 180 MB
de su techo de 3,0 GB, menos que el ruido de esa medición (~345 MB). En P1, sin
OCR, pasa lo contrario: caliente pica menos que frío, porque el modelo ya está
cargado y no se paga su carga.

### 2. Por qué: en caliente, NER y OCR conviven

- **En frío** las etapas se suceden: el pool de OCR se da de baja al terminar
  su etapa (ADR-157) y recién después la detección carga el modelo de NER. El
  pico es el mayor de los dos, no la suma.
- **En caliente**, el documento anterior dejó el modelo cargado. Se libera por
  temporizador a los 15 s de inactividad (ADR-167). La línea de base caliente
  de `memory.spec.ts` asienta en pocos segundos (en la campaña de 2026-11, con NER apagado, la importación caliente de P2 arrancó unos 3 s después del `Ready` frío; con NER puede asentar distinto, con un techo de 30 s, ADR-146 §7bis), y
  quien abre un expediente
  detrás de otro tampoco espera 15 s. Entonces **el OCR del documento nuevo
  corre con el modelo de NER residente**: el pico pasa a ser OCR + NER.
- **El tamaño cuadra.** ADR-167 §1 midió que el modelo residente pesa unos
  450 MB en el árbol de procesos. La campaña de 2026-11 midió en Linux, sin
  NER, que caliente supera a frío en unos 90 MB de mediana (informe, §3).
  Juntos dan unos 540 MB, del mismo orden que los ~630 MB de diferencia de
  Windows.
  **Es una inferencia sobre mediciones de distinto equipo, no una medición de
  este mecanismo.** El A/B de §5 es el que lo confirma o lo refuta.

### 3. Lo que ADR-167 ya descartó y por qué esto es distinto

ADR-166 soltaba el modelo al terminar la detección. T-8 midió que así el
documento siguiente pagaba la recarga **apilada sobre su propio trabajo**:
+1,2 s y +485–635 MB de pico (ADR-167 §2). Por eso se retiró.

Esta propuesta suelta el modelo **solo cuando el documento nuevo va a hacer
OCR**, al empezar esa etapa. La recarga cae en la detección, cuando el pool de
OCR ya se dio de baja (ADR-157): se apila sobre la detección, que es lo que
pasa en frío, y no sobre el OCR. En un documento sin OCR, como P1, no cambia
nada, así que no reabre el caso que midió T-8.

## Decisión propuesta

1. Al **empezar** `runOcrStage`, si el pool de NER está ocioso, el
   Orchestrator le pide que suelte sus workers. Es la misma baja con guarda de
   ADR-157 §1ter: si hay un job en vuelo no hace nada, y el temporizador de
   ADR-167 sigue como red.
2. La baja reabre el ciclo del modelo (`modelWarm = false`, ADR-166 §1bis; el listener `onWorkersReleased` de ADR-167 §3 ya lo garantiza para cualquier camino de baja), para que la recarga en la detección emita `NER_MODEL_LOADING` /
   `NER_MODEL_READY` y el indicador no mienta (ADR-135).
3. No cambia `nerIdleDisposeMs`, ni los tamaños de pool, ni la cantidad de
   hilos: no baja paralelismo (ADR-154 §1).

**Contrato**: ADR-167 §1 eliminó `NerEngine.releaseIdleWorkers()` por no tener
llamador. Esta decisión necesita volver a exponer una baja de NER, así que
lleva su cambio de spec antes del código: en `NER_Engine.md` §6, y en `Contracts.md` solo si trae tipo, evento o error code nuevo (precedente: la baja de OCR en `OCR_Engine.md`). Va en un commit propio con
este ADR (R-2, R-19).

## Costo esperado

- **Tiempo**: el segundo documento escaneado vuelve a pagar la carga del
  modelo, unos 1–2 s según ADR-167 §4 (2065 / 1983 ms contra 470 / 471 ms sin
  recarga, en la Mac). En un escaneo de 50 páginas, el OCR dura decenas de
  segundos: es un porcentaje chico, pero hay que medirlo.
- **Calidad**: ninguna, por construcción. Es el mismo modelo y la misma
  inferencia; solo cambia cuándo se carga.

## Compatibilidad con varios documentos (1.2)

| Criterio | Cumple | Por qué |
|---|---|---|
| No cambia pico por retención | sí | baja retención; no guarda nada nuevo |
| No supone un solo documento | sí | actúa sobre el pool, que ya es compartido por el Core; no indexa nada por documento |
| Libera al terminar una etapa, no al cerrar | sí | se dispara al empezar la etapa de OCR del documento que llega |
| Se mide en frío y en caliente | sí | §5 exige los dos; la ganancia esperada es solo en caliente |

Con una cola de documentos procesados de a uno, que es lo que prevé la 1.2, el
caso caliente pasa a ser el normal: es justo donde ayuda.

## 5. Cómo se verifica antes de aceptarlo

- **A/B intercalado** con build de arnés (mismo método que ADR-218 y que C-1),
  ABBA × 3, perfiles P1 y P2 de `memory.spec.ts`, frío y caliente. Requiere el
  modelo de NER: en un contenedor con `huggingface.co` permitido, o en la
  máquina del mantenedor.
- **Gana si** el máximo caliente de P2 baja más que el ruido en las tres rondas
  y P1 no se mueve. **Pierde si** el pico caliente no baja o si el tiempo
  agregado supera lo que el humano acepte.
- **Confirmación de techos en Windows nativo** (ADR-192 §4) antes de un
  release.

## Consecuencias

- Si se acepta, P2 caliente debería quedar cerca de P2 frío, y el margen
  contra el techo de 3,0 GB pasaría a ser mayor que el ruido.
- La asimetría NER/OCR de ADR-167 se mantiene en el reposo: después de
  `PIPELINE_READY` el modelo sigue esperando 15 s, porque ahí no hay OCR con el
  que se apile.
