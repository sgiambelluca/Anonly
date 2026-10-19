<!-- CONTEXT: scope=plan-1.1 | dependencias=roadmap/Roadmap_1.x.md,core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/08_Security_Model.md,ui/UX_Guidelines.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md | audiencia=humanos+IA | fase=1.1-planificacion -->

# 1.1 — Detección a medida del usuario: plan

**Estado (2026-10-19):** definición funcional cerrada por el mantenedor, en
dos sesiones (2026-10-13 en Codex y 2026-10-19 con Claude). Los seis ADR
(ADR-219 a ADR-224) están **aceptados** desde el 2026-10-19, con los
detalles técnicos de §4. Los contratos y los specs de motor están escritos
(§6): la implementación puede arrancar por F0. El diseño de la interfaz lo hace el mantenedor más
adelante, y por eso este plan no anota nada de diseño.

Reemplaza a `Plan_Funcional_1.1.md`, el borrador del 2026-10-13, que no
llegó a commitearse.

## 1. Alcance

| Punto del roadmap | Queda en la 1.1 |
|---|---|
| Patrones Regex propios | Sí, como **generador de formatos**. El usuario nunca escribe una regex |
| Tipos de entidad definidos por el usuario | Sí |
| Filtros en el árbol de entidades | Sí, cuatro filtros |
| Búsqueda con regex en el árbol | **No.** Sale de la 1.1 y del roadmap (2026-10-19) |
| Panel de ayuda de atajos | Sí, con los atajos que ya existen |
| Tooltips enriquecidos en el visor | Sí |

Se suman dos cosas que no estaban en el roadmap:

- los catálogos por país: en la 1.1 está el mecanismo y Argentina; Chile y
  Uruguay llegan en la 1.1.1;
- exportar e importar formatos.

## 2. Conceptos

- **Tipo de entidad**: qué dato es, por ejemplo Teléfono o CBU.
- **Formato**: qué forma tiene el texto que se reconoce como ese tipo.
- **Tipo base**: los que trae la aplicación. No se borran.
- **Tipo propio**: lo crea el usuario. Si se crea desde inicio, se guarda.
  Si se crea con un documento abierto, es **del documento** y se pierde al
  cerrarlo.
- **Formato base**: viene en el catálogo de un país. Hay dos clases:
  - **de pura forma**, que se edita como copia;
  - **con control** (dígito verificador, lista de nombres o de meses,
    escáner del email), que solo se prende y apaga.
- **Formato propio**: lo arma el usuario con el generador. Se asocia a un
  tipo propio o a un tipo base que depende del país.
- **Catálogo**: los formatos base de un país. Hay uno activo.

## 3. Decisiones del mantenedor

### 3.1 Generador de formatos

| Decisión | Fecha | ADR |
|---|---|---|
| Se presenta como «generador de formatos»: no hace falta saber qué es una regex | 10-13 | 220 |
| Solo generador. No hay modo de regex escrita a mano | 10-19 | 220 |
| Piezas: bloques de dígitos o letras (cantidad fija o rango), separadores opcionales, texto fijo dentro del dato, palabra de contexto que no se tapa, partes opcionales y variantes | 10-19 | 220 |
| Es para formatos de países y rubros. Fechas, carátula, email y los demás con control no se editan | 10-19 | 220 |
| Formatos base de pura forma: se editan. Con control: solo se prenden y apagan | 10-19 | 220 |
| Árbol tipo → formatos: cada formato se prende, se apaga y se edita | 10-19 | 220, 221 |
| Un formato propio puede ir bajo un tipo base («Teléfono → Celular Chile») | 10-19 | 220 §5 |
| Solo se abre desde la pantalla de inicio | 10-19 | 223 |

### 3.2 Catálogos por país

| Decisión | Fecha | ADR |
|---|---|---|
| El país elige el catálogo de los tipos base, que conservan su identidad | 10-13 | 221 |
| B+: un solo país activo, con las etiquetas de ese país, y «agregar desde otro país» suelto | 10-19 | 221 |
| Los países son Argentina, Chile y Uruguay | 10-19 | 221 |
| **La 1.1 sale con Argentina sola; Chile y Uruguay salen en la 1.1.1.** Por §1 del roadmap correspondería a una menor: va en un parche por decisión del mantenedor | 10-19 | 221 §7 |
| Cada catálogo trae sus generadores sintéticos | 10-19 | 221 §4 |

### 3.3 Duplicados y colisiones

| Decisión | Fecha | ADR |
|---|---|---|
| Avisar que otro formato ya cubre el texto es obligatorio | 10-13 | 220 |
| Un formato idéntico no se crea. Uno que comparte textos avisa con un ejemplo y deja crear | 10-19 | 220 §3 |
| Dos formatos que se pisan en un documento van al panel de conflicto. Contención: gana el que contiene, sin panel. Mismo tipo: sin conflicto. Por defecto gana el propio y, entre iguales, el más largo. Nace resuelto y no bloquea el export | 10-19 | 222 |

### 3.4 Guardado, ciclo de vida, exportar e importar

| Decisión | Fecha | ADR |
|---|---|---|
| Los tipos creados desde inicio se guardan; los creados con documento abierto son del documento | 10-13 | 219, 223 |
| Guardar definiciones no autoriza guardar valores, apariciones ni contenido del documento | 10-13 | 223 |
| Se exporta y se importa. Revierte «importación excluida» del 10-13 | 10-19 | 223 |
| Se exporta lo propio, elegido uno por uno. No viajan el país ni el estado de los formatos base | 10-19 | 223 §5 |
| Al importar, un tipo con el mismo nombre suma sus formatos al existente | 10-19 | 223 §6 |
| Borrar un tipo propio borra todos sus formatos. Los tipos base no se borran | 10-19 | 223 §4 |
| Se guarda en claro: son solo formatos. El cifrado queda para la 1.4 | 10-19 | 223 §3 |

### 3.5 Tipos propios y reemplazos

| Decisión | Fecha | ADR |
|---|---|---|
| Tipos con identidad y nombre propios, no reunidos bajo «Custom» | 10-13 | 219 |
| Modos: etiqueta, máscara y censura total. Sin sintético | 10-13 | 219 §3 |
| Etiqueta en mayúsculas y sin tildes: `[HISTORIA CLINICA 01]` | 10-19 | 219 §2 |
| Versiones cortas automáticas, y el usuario puede escribirlas | 10-19 | 219 §2 |
| La máscara conserva espacios y separadores | 10-19 | 219 §3 |
| Numeración y modo, por tipo | 10-19 | 219, 224 |

### 3.6 Fallos

| Decisión | Fecha | ADR |
|---|---|---|
| Un formato que falla no frena el análisis, y se avisa qué páginas no cubrió | 10-19 | 220 §6 |

### 3.7 Panel de entidades y visor

| Decisión | Fecha | ADR |
|---|---|---|
| La lupa y el buscador del panel no cambian | 10-19 | 224 §1 |
| Lo que sale de un formato va en un subnivel bajo su tipo; lo del modelo y lo manual, directo bajo el tipo | 10-19 | 224 §2 |
| Cuatro filtros: formato, modo, desactivadas o con conflicto, y agregadas o editadas a mano. Discretos; el diseño, después | 10-19 | 224 §3 |

## 4. Propuestas del planificador sin objeción del mantenedor

Se presentaron el 2026-10-19 como «salvo que me digas otra cosa»:

1. Un sintético pedido para un tipo propio se resuelve como etiqueta
   (ADR-219 §3).
2. Dos apariciones de un tipo propio son la misma entidad si coinciden sin
   contar espacios, separadores ni mayúsculas, y no hay agrupación por
   parecido (ADR-219 §4).
3. Un formato agregado desde otro país conserva su control (ADR-221 §5).
4. Un tipo del documento no se puede pasar a guardado en la 1.1 (ADR-219
   §5).
5. El tooltip suma el nombre del formato, y la ayuda lista los atajos que ya
   existen, sin agregar nuevos (ADR-224 §4 y §5).

Detalles técnicos que no pasaron por el mantenedor y que **se presentan
para aceptar junto con los ADR**:

6. Cada variante de un formato tiene al menos una pieza de caracteres: un
   formato hecho solo de texto fijo guardaría texto literal (ADR-220 §1).
7. Los formatos propios van bajo tipos propios o bajo los tipos base que
   dependen del país: DNI, CUIT, teléfono, matrícula y patente (ADR-220 §5).
8. El panel de colisión aparece solo si al menos uno de los formatos es
   propio. Entre dos formatos base, todo sigue como hoy (ADR-222 §5).
9. Lo importado llega prendido, y el resumen dice qué entró (ADR-223 §6).
10. «Custom» deja de ofrecerse en los selectores, y lo reemplaza «Nuevo
    tipo» (ADR-224 §6).
11. El filtro «con conflicto» incluye los conflictos que nacieron resueltos
    (ADR-224 §3).
12. Entre un formato propio y uno base del mismo tipo y del mismo largo,
    gana el propio, para que el grupo quede bajo el formato del usuario
    (ADR-222 §1).
13. Con un solo país, la 1.1 oculta el selector de país y «agregar desde
    otro país». Aparecen con la 1.1.1 (ADR-221 §7).

## 5. Mapa de ADR

| ADR | Qué decide | Toca |
|---|---|---|
| [ADR-219](../adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md) | Identidad, etiqueta, modos y agrupación de un tipo propio; tipos del documento | `Contracts.md`, `03_Data_Model.md`, Grouping, Orchestrator, app |
| [ADR-220](../adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md) | Qué es un formato, el recorrido lineal, validar, probar y comparar, la edición de los base, los fallos, y el retiro de `addPattern` | `Contracts.md`, `03_Data_Model.md`, `04_Event_System.md`, Regex, façade |
| [ADR-221](../adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md) | Catálogos por país, etiquetas y sintéticos por país, agregar desde otro país | `Contracts.md`, Regex, Grouping, `shared` (sintetizador), app |
| [ADR-222](../adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md) | Colisiones entre formatos al panel de conflicto | `Contracts.md`, `03_Data_Model.md`, Regex, Grouping |
| [ADR-223](../adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md) | `DetectionConfig`, guardado, borrar, exportar e importar | `Contracts.md`, Orchestrator, `08_Security_Model.md`, app |
| [ADR-224](../adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md) | Búsqueda con regex afuera, subnivel por formato, filtros, tooltip, ayuda de atajos, «Custom» afuera | `03_Data_Model.md`, Grouping, app, `UX_Guidelines.md` |

## 6. Qué falta antes de implementar

**Hecho el 2026-10-19:**

- El mantenedor aceptó los ADR, con los detalles técnicos de §4.
- Se escribieron los contratos, en el orden de R-19:
  - `Contracts.md`: §3.1, §3.5, §5, la §5.2 nueva, §6 y §8;
  - `03_Data_Model.md`: §7 a §11, §13, §15 y §18;
  - `04_Event_System.md`: `REGEX_FINISHED`, `CONFLICT_RESOLVE_REQUESTED` y la matriz.
- Se escribieron los specs de motor, con sus casos en §13, los tests con su nombre exacto en §14 y los ítems de §15:

  | Spec | Versión | Casos | Ítems de §15 |
  |---|---|---|---|
  | `Regex_Engine.md` | v2.0.0 | 37 a 52 | 25 a 28 |
  | `Grouping_Engine.md` | v1.18.0 | 78 a 88 | 15af a 15ai |
  | `Orchestrator.md` | v1.15.0 | 47 a 52 | 36 a 38 |
  | `Export_Engine.md` | v1.4.0 | 21, 22 y 24 | 28b |
  | `Render_Engine.md` | v1.20.0 | 40 | 8f |

- Se amplió `08_Security_Model.md` §10.2, y la tabla de atajos de `UX_Guidelines.md` §9 sumó deshacer y rehacer.

**Dos hallazgos al escribir los specs**, resueltos con reglas que los ADR ya tenían:

1. **Celular y matrícula pasan a `control`**: solo se prenden y apagan. El generador no los puede expresar, así que se aplicó la regla de ADR-220 §4. Quedan cinco formatos editables: DNI, teléfono fijo y las tres patentes (`Regex_Engine.md`, «Catálogo»).
2. **La hoja de referencia se pagina** (ADR-219 §6). Con tipos propios, sus filas ya no tienen el tope de 13 que suponía ADR-059. Render la pagina y Export agrega todas las páginas.

**Falta:**

1. **El frente F6** (Chile y Uruguay, para la 1.1.1) tiene su propia aprobación de tablas antes de escribir sus filas (ADR-221 §6). Su investigación no necesita código y puede arrancar en paralelo.
2. **Los specs de interfaz** (`ui/Components.md`, `ui/UX_Guidelines.md` y `ui/React_Client.md`) se escriben después del diseño. Este plan no los adelanta.

## 7. Frentes de implementación

Es una propuesta de orden: cada frente arranca con el spec auditado, como
un hito, y cada commit toca un solo módulo (R-1).

| Frente | Qué | Módulo | Depende de |
|---|---|---|---|
| F0 | Cambio de contrato: `EntityTypeId`, `FormatDefinition`, `DetectionConfig`, `CountryCode`, campos nuevos en `Occurrence`, `OccurrenceRef`, `EntityGroup`, `ConflictCandidate`, `RegexFinished` y `SyntheticRequest`, los tipos de la hoja paginada, `alphanumericKey`, `maskByCharacters`, `DEFAULT_DETECTION_CONFIG` y las constantes `FORMAT_*`/`USER_TYPE_*` (`Contracts.md` §5.2 y §6) | `shared` | ADR aceptados y contratos escritos |
| F1 | Generador: compilar, recorrido lineal, `validateFormat`, `testFormat` y `compareFormat`; retiro de `addPattern` | `regex-engine` | F0 |
| F2 | Catálogo argentino como catálogo (sin cambio de conducta, con celular y matrícula como `control`), `detection.country`, ajustes de formatos base, referencias, emitir los dos matches de ADR-222 y `skippedFormats` | `regex-engine` | F1 |
| F3 | Tipos propios (etiquetas, modos, máscara, clave), tipos del documento, etiquetas por país, desempate del conflicto y `formatId` del grupo | `grouping-engine` | F0 |
| F4 | `DetectionConfig` en `createCore`, `defineDocumentEntityType`, validar el tipo del agregado manual, reexportar las funciones puras y `validateFormatsFile` | façade | F1, F3, F4b |
| F4b | Hoja de referencia paginada: `renderLegendPages` en Render y varias páginas de leyenda en Export (ADR-219 §6) | `render-engine`, `export-engine` (un commit cada uno) | F0 |
| F5 | Sintetizador por país, con Argentina idéntica | `shared` | F0 |
| F6 (1.1.1) | Chile y Uruguay: investigación, corpus sintético, medición, tablas aprobadas, y después filas de catálogo, etiquetas y generadores. Muestra el selector de país y «agregar desde otro país» | `regex-engine`, `grouping-engine`, `shared`, `react-client` | F2, F3, F5; la investigación, de nada |
| F7 | Aplicación: guardado, generador, exportar e importar, subnivel, filtros, tooltip, ayuda de atajos, «Nuevo tipo» y el aviso de `skippedFormats` | `react-client` | Diseño del mantenedor, F4 |
| F8 | Verificación: línea de base de calidad idéntica con Argentina y sin formatos propios, E2E de punta a punta y la suite pesada de una versión menor | `tests/` | Todo lo anterior |

F1, F3, F4b y F5 no dependen entre sí y pueden ir en paralelo después de F0.

**Una medición pendiente.** No hay tope para la cantidad de formatos propios
prendidos. Cada uno suma un recorrido lineal por página, así que F1 mide el
costo con 10, 50 y 200 formatos sobre un documento largo. Si hace falta un
tope, lleva su ADR.

## 8. Fuera de la 1.1

- Escribir una regex a mano, en el generador o en el buscador.
- Pasar un tipo del documento a guardado.
- Modo sintético para tipos propios (`Future_Ideas.md` §5.5 sigue abierto).
- Cifrar los formatos guardados.
- Plantillas de reglas reutilizables (`Future_Ideas.md` §4.2).
- Chile y Uruguay: salen en la 1.1.1 (frente F6). En la 1.1 el selector de
  país y «agregar desde otro país» quedan ocultos, porque hay un solo país.
- Otros países además de Argentina, Chile y Uruguay.
