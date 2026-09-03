<!-- CONTEXT: scope=tests-measure | dependencias=roadmap/Optimizacion_De_Rendimiento.md,adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md,tests/e2e/README.md | audiencia=humanos+IA | fase=11 -->

# Harness de medición

Mide **tiempo por etapa** y **calidad de detección** sobre el dataset de referencia, corriendo la app real en Chromium. Es el instrumento de "antes y después" del plan de `docs/roadmap/Optimizacion_De_Rendimiento.md`.

**No es un gate**: no afirma umbrales ni falla por un número. Mide, imprime y guarda.

## Por qué corre en un browser y no en Node

Las dos cosas que hay que medir son inseparables del entorno real:

1. **Calidad con NER encendido.** El kernel resuelve el modelo contra `env.localModelPath = "/models/ner/"`, una ruta de servidor: en Node no existe, y por eso `tests/quality/` mide con NER apagado (ADR-095 §5). Acá el dev server la sirve desde `public/`.
2. **Tiempos representativos.** En Node, Transformers.js usa el backend nativo de onnxruntime; en el browser usa WASM. Medido: **82 ms contra 1590 ms** para las mismas 256 palabras. Un número de Node no describiría el producto.

## Prerequisito

```bash
pnpm assets:mirror
```

Igual que `tests/e2e/` — ver su README. Sin el modelo en `apps/react-client/public/models/`, NER no carga.

## Correr

```bash
pnpm test:measure
```

Un subconjunto, y con etiqueta para no pisar una medición anterior:

```bash
MEASURE_DOCS=doc-001,doc-016 MEASURE_LABEL=post-A pnpm test:measure
```

La salida va a `.measure/<label>.json` (gitignoreado): tiempos crudos, ocurrencias y grupos de cada documento, para poder recalcular sin volver a medir.

## Cómo lee el estado

Por el **bus de eventos**, vía un hook que `core-adapter/index.ts` expone en `globalThis` **solo en dev** (`import.meta.env.DEV`, que Vite elimina del build de producción).

No se raspa el DOM a propósito: el árbol de entidades renderiza el valor canónico de cada grupo pero **no su página**, y la regla de matcheo de ADR-095 §1 necesita `(entityType, value, pageIndex)`. Raspar la UI mediría una renderización, no una detección.

La clasificación de grupos y la regla de matcheo se reusan de `tests/quality/` sin tocarlas, así que la métrica vive en un solo lugar.

## Lo que este número **no** dice todavía

- **El recall de NER ya se mide** (era una decisión abierta; se cerró). `evaluateDocument` calcula la cobertura de las entidades `detector: "ner"` con la misma regla de matcheo, y `formatReport` la publica como recall **solo** si `nerActive` es `true`. Con NER apagado (`tests/quality/`, ADR-095 §5) su cobertura sería 0/N por construcción —no porque el motor falle— así que ahí se sigue imprimiendo como "cuántas quedaron fuera". Es la misma cuenta; lo que cambia es si el detector corrió.

  Primera medición (2026-08-27): **9/14 = 64,3 %**. Las cinco sin cubrir son cuatro domicilios de calle + número (`"Maipú 1434"`, `"Belgrano 5983"`, `"Pueyrredón 9741"`, `"Pueyrredón 2584"`) y una organización. Cruzado con los falsos positivos —`"Buenos Aires"`, `"La Plata"`, `"Tucumán"`— el patrón es que el modelo reconoce **ciudades** y se pierde **domicilios**: su concepto de dirección no es el del dataset.
- **La precisión con NER encendido mezcla dos cosas.** Una detección de NER que no matchea el ground truth cuenta como falso positivo, pero el dataset se construyó enumerando **formas de escritura de Regex** (ADR-096): su verdad no pretende ser exhaustiva en Personas/Organizaciones. Parte de la caída puede ser verdad faltante y no ruido del motor. Hay que mirarlos uno por uno antes de sacar conclusiones.
- **Los documentos de referencia son chicos** (2-3 páginas, poco densas). Sirven para comparar, pero no ejercitan el camino caro que motiva A/B/C (5-15 s por página densa). Para eso hace falta sumar un documento denso.

## Una página por documento

Después de importar, la app muestra el visor y el `input[type=file]` deja de existir: no hay dónde soltar el segundo documento. Por eso el harness recarga la página en cada uno.

El costo es que cada documento vuelve a cargar el modelo (~1 s). Se reporta en su propia columna (`modelo`) justamente para poder descontarlo: lo que comparan A/B/C es el tiempo **por página**, no el arranque.

## Documentos reales, sin abrirlos

`real-docs.spec.ts` mide sobre expedientes de verdad **sin que su contenido salga de la máquina ni entre al repo**:

```bash
MEASURE_FILES="/ruta/a.pdf,/ruta/b.pdf" pnpm test:measure real-docs
```

**Nunca imprime contenido**: solo conteos, porcentajes y tiempos. Las entidades se reportan **por tipo** (`PERSON:98`), nunca por valor. Los errores se reportan por **clase** y no por mensaje, porque las librerías de PDF a veces incluyen texto del documento en la excepción.

Existe porque hay preguntas que el dataset sintético no puede contestar —todos sus PDF salen de `pdf-lib`, que es amable— y las respuestas cambiaron conclusiones: la tasa de empalme de ADR-097 pasó de 100 % en los fixtures a **0,2-27 %** en documentos reales (`roadmap/Post_Hito10.8_Pendientes.md` §24), y la ganancia de ADR-101 pasó de −25 % a **−46 %** sobre un escaneo de verdad.

Sin `MEASURE_FILES` el test se saltea, así que vive en la suite sin pedir nada.
