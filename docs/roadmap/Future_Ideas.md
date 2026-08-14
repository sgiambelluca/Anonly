<!-- CONTEXT: scope=roadmap-future | dependencias=roadmap/Version_2.0.md,00_Project_Vision.md | audiencia=humanos | fase=5 -->

# Anonly — Future Ideas

> Ideas a largo plazo, sin compromiso de versión. Requieren investigación, ADRs propios y validación de producto. Algunas pueden descartarse al evaluarlas.

---

## 1. IA y modelos

### 1.1 NER entrenado para Argentina

Fine-tunear un modelo NER específico para:
- Nombres y apellidos argentinos (incluyendo fonética no ortodoxa).
- Direcciones con formato AR (calle + altura + piso + dpto + localidad + provincia + CP).
- Matrículas profesionales (CPCE, medicina, abogacía) por jurisdicción.
- Patentes AR viejas + Mercosur + provinciales.

Modelo distribuido como `.onnx` cuantizado, cacheable, con versionado por `modelId`.

### 1.2 Detección por LLM local

Usar un LLM pequeño local (ej. Phi-3, Gemma 2B cuantizado) vía WebLLM o similar para:
- Detección de entidades con contexto ("Dr. Juan Pérez" → `Person` con rol "médico" opcional).
- Resolución de coreferencias ("el doctor" → referenciar a "Juan Pérez" previamente detectado).
- Clasificación de sensibilidad contextual (un DNI en un documento legal vs en un documento público).

Riesgo: modelos de 2–4 GB son pesados para descarga. Mitigación: opt-in, cache, modelos más chicos cuando estén disponibles.

### 1.3 Embeddings para agrupación

`Sentence-Transformers` multilingüe (Q8) para agrupar aliases semánticamente similares:
- "Dr. Juan Pérez" y "Juan Pérez" y "J. Pérez" → mismo grupo.
- "Belgrano 1234, CABA" y "Av. Belgrano 1234, Ciudad Autónoma de Buenos Aires" → mismo grupo.

Riesgo: costo de inferencia. Mitigación: solo para grupos con conflictos `ambiguous_canonical` o como opt-in.

### 1.4 Detección de imágenes sensibles

Detectar y redactar:
- Fotos de personas (caras) con face detection (MediaPipe Face Detection).
- Logos de organizaciones.
- Firmas manuscritas.
- Huellas dactilares.

### 1.5 Cobertura anglosajona del léxico de género

**Limitación conocida del Hito 10.6 (ADR-069 §1), anotada al decidirla, no descubierta después.**

El léxico se construye con **una sola fuente**: el registro civil porteño ("Nombres Permitidos", CC-BY-2.5-AR), 9.788 nombres, 30 KB gz. Los nombres ausentes de ese registro caen a "sin determinar" y el usuario los marca a mano con el selector — la red de seguridad de ADR-060 §5.

La segunda fuente que ADR-060 §9 había previsto ([Gender by Name — UCI](https://archive.ics.uci.edu/dataset/591/gender+by+name), CC BY 4.0) se retiró al medirla: de 24 nombres extranjeros probados, el registro porteño ya resolvía 21 y UCI agregaba tres (Piotr, Kwame, Katarzyna); la mitad de sus 133.899 entradas las llevan menos de 20 personas en todo el corpus; y sus 130 entradas que no son nombres —letras sueltas, iniciales, títulos— hacían que `"J. Pérez"` resolviera masculino, violando ADR-060 §4. Tiene sentido: el registro de nombres permitidos de un país de inmigración ya es internacional.

**Si se retoma, la variante correcta está medida**: UCI filtrada a nombres con **1.000 apariciones o más**, más el saneamiento de ADR-069 §3 → **17.156 entradas, 230 KB crudo / 50 KB gz**, +6.413 nombres determinados sobre el registro. Los umbrales más finos (≥100 → 115 KB gz; ≥20 → 183 KB gz) se descartaron: multiplican el peso para cubrir grafías cada vez más raras que el usuario resuelve con un clic, y a partir de ~150 KB gz habría que volver a sacar el léxico del bundle y reconstruir la maquinaria de carga que ADR-069 §2 eliminó. Volver a agregar UCI implica además reponer su atribución CC BY 4.0 en el producto (ADR-060 §11).

### 1.6 Créditos de las licencias de código del stack

**Deuda conocida, anotada al construir la superficie de créditos (ADR-070, Contexto §4), no descubierta después.**

ADR-070 resolvió la atribución de **datos** de terceros —hoy una sola entrada, el léxico de género— con la sección "Acerca de" del `SettingsDialog` y `thirdPartyCredits.ts` como módulo de datos. Lo que **no** cubrió: las licencias del código que la app ya distribuye. `pdf.js`, Tesseract y `onnxruntime-web` son Apache-2.0, que exige propagar el `NOTICE` del proyecto original; Radix y el resto del stack, MIT, que exige conservar el aviso de copyright.

Es un trabajo de auditoría propio —enumerar el árbol de dependencias que efectivamente viaja al bundle, no el `devDependencies` entero— y no lo introdujo el Hito 10.6, así que no era su alcance. Cuando se haga, **la superficie ya existe**: son filas nuevas en `THIRD_PARTY_CREDITS` (ADR-070 §2), sin componente nuevo ni decisión de UI que tomar. Candidato natural al hito de Hardening, antes del release.

---

## 2. Plataformas y distribución

### 2.1 SDK Python

Empaquetar el Core como SDK Python (vía Pyodide o re-implementación) para que equipos de datos lo usen en pipelines server-side. Sería un producto separado que **reutiliza los specs** pero no el código del Core TS. Requiere su propio ADR de licenciamiento y mantenimiento.

### 2.2 CLI

CLI `anonly` para procesar PDFs desde terminal:
```bash
anonly anonimize input.pdf --output output.pdf --mode placeholder
```

Útil para integraciones CI/CD y scripts. Reutiliza el Core via Node (con Web Workers → Worker threads).

### 2.3 Server-side batch (producto separado)

Servicio server-side para batch masivo (millones de documentos), dirigido a empresas. Sería un producto separado con su propio stack, que **reutiliza los specs y algoritmos** del Core. Un ADR propio (Server Batch, número a asignar al crearlo) definiría licenciamiento y diferenciación.

### 2.4 VS Code extension

Procesar PDFs abiertos en VS Code sin salir del editor.

---

## 3. Compliance y legal

### 3.1 Compliance con normativas

- **GDPR**: documentación de compliance, registro de procesamiento (headerless, sin datos del usuario).
- **HIPAA**: modo "medical" con detección de PHI (números de historia clínica, fechas de nacimiento, etc.).
- **Ley 25.326 (Argentina)**: guía de uso para cumplimiento.
- **CCPA** (California).

### 3.2 Auditoría

- **Audit log**: registro inmutable de acciones del usuario (qué grupo editó, qué modo aplicó, qué exportó). Sin datos del documento, solo metadatos. Persistencia opcional en `localStorage`.
- **Reporte de anonimización**: PDF adjunto al export con resumen de qué se anonimizó (tipo, conteo, modo aplicado). Útil para compliance.

### 3.3 Garantías criptográficas

- **k-anonimidad probada**: para `synthetic`, garantizar que cada valor sintético es indistinguible de K otros valores posibles.
- **Hash de auditoría**: hash del documento anonimizado + lista de grupos anonimizados, firmable para auditoría externa.

### 3.4 Exports sintéticos reproducibles

Hoy **no se puede** reproducir un export en modo `synthetic`, y no es un olvido: el seed es un `crypto.randomUUID()` por sesión sin forma de fijarlo, porque ADR-019 §5 lo decidió así para evitar correlación entre sesiones del mismo documento (ADR-012 §SAN). ADR-072 §5 lo dejó anotado al cambiar la semilla del sintetizador de `indexInType` a `EntityGroup.id`.

Si alguna vez hace falta —reproducir una entrega concreta para una auditoría, por ejemplo— hacen falta **dos** cosas, no una: un seed configurable **y** identidades de grupo deterministas, porque los `id` también son UUID de runtime. Y hay que decidir explícitamente qué se hace con la garantía SAN que se estaría relajando: un seed conocido convierte la síntesis en reproducible para quien lo tenga. Es un ADR propio, con `08_Security_Model.md` §9 en la mesa.

---

## 4. Colaboración

### 4.1 Multi-usuario en tiempo real

Co-edición de reglas y grupos entre varios usuarios sobre el mismo documento. Requiere signaling server (WebRTC) pero el documento sigue sin salir del dispositivo de cada usuario (cada uno lo procesa local y solo se sincronizan las decisiones). Riesgo: complejidad alta, valor de producto medio.

### 4.2 Compartir plantillas

Marketplace opcional de plantillas de reglas (ej. "Plantilla legal AR", "Plantilla médica HIPAA"). Sin datos del usuario, solo configuración.

### 4.3 Compartir patrones Regex custom

Entre usuarios de la misma organización.

---

## 5. UX avanzada

### 5.1 Vista de diff entre original y anonimizado

Modo que muestra el texto original con diff visual contra el anonimizado (estilo GitHub PR). Útil para revisión.

### 5.1b Búsqueda difusa de variantes al agregar una entidad a mano

**Limitación conocida del Hito 10.7 (ADR-061 §2), anotada al decidirla, no descubierta después.**

El agregado manual busca el valor **exacto**, insensible a mayúsculas y acentos: "JOSE PEREZ" encuentra "José Pérez", pero **"J. Pérez" no**. Si el documento nombra a la misma persona de dos formas, el usuario tiene que agregar las dos por separado.

Lo que sí funciona ya: una vez agregadas, Grouping **las fusiona solo** en un mismo grupo — su matching fuzzy por Levenshtein y aliases hace exactamente eso (`Grouping_Engine.md` §Matching). Lo que falta es que la **búsqueda** las encuentre sin que el usuario las escriba.

Se arrancó exacto a propósito: la búsqueda difusa trae falsos positivos, y esta es una función cuyo punto es que el usuario corrija con precisión lo que el detector automático erró. La decisión fue medir en uso real cuántas apariciones se escapan antes de invertir.

Cuando se retome, el candidato natural es reusar el mismo Levenshtein normalizado que ya usa Grouping —umbral `GROUPING_SIMILARITY_THRESHOLD`, `Contracts.md` §6— en lugar de introducir un algoritmo nuevo, más un tratamiento explícito de abreviaturas e inversiones ("Apellido, Nombre"), que Levenshtein solo no resuelve bien.

### 5.2 Búsqueda en el documento anonimizado

Buscar texto en el PDF anonimizado (sobre la imagen, con OCR en vivo) para validar que un dato específico fue reemplazado.

### 5.3 Modo "validar muestra"

Tras exportar, cargar el PDF resultante de vuelta y verificar que ningún valor original aparece (auto-validación post-export).

### 5.4 Internacionalización de placeholders

`[DNI 01]` en español, `[ID 01]` en inglés, `[IDN 01]` en portugués. Configurable.

### 5.5 Qué debería ser el valor sintético de `EntityType.Custom`

`synthesize` devuelve hoy `custom-3` para el tipo `Custom`: no sortea nada, interpola el `indexInType`. No es un "valor sintético válido y plausible", que es como ADR-012 define el modo — es un string de relleno.

De ahí sale una inconsistencia menor que ADR-072 §3 dejó **deliberadamente sin arreglar**: como la semilla del sintetizador dejó de depender del índice pero esta rama sigue interpolándolo, un grupo `Custom` en modo `synthetic` que se renumera conserva `custom-3` mientras su placeholder diría `[CUSTOM 04]`. Es exactamente el comportamiento previo a ADR-072, ni mejor ni peor.

Arreglar el índice sin contestar la pregunta de fondo sería pulir un valor que probablemente haya que cambiar entero, y la pregunta de fondo —qué dato falso plausible corresponde a un tipo de entidad que define el usuario— es de producto: depende de si `Custom` llega a tener formato declarado (ver §4.3, patrones regex compartidos).

---

## 6. Performance futurista

### 5.1 WebGPU para render

Render del PDF vía WebGPU en lugar de Canvas. Más rápido para zoom alto.

### 5.2 Streaming de modelos

Cargar solo las capas del modelo NER que se necesitan (cuando Transformers.js lo soporte). Reduce tiempo de carga inicial.

### 5.3 Indexación de documentos enormes

Para PDFs de > 10.000 páginas, indexar por `pageIndex → textHash` para re-procesamiento delta tras edición sin re-escanear todo.

---

## 7. Investigación abierta

| Tema | Estado | Próximo paso |
|---|---|---|
| Modo "texto preservado" seguro | en investigación para v2.0 | prototipo con pdf-lib + test de no-recuperabilidad por capas |
| LLM local para detección | investigación | evaluar Phi-3-mini en WebLLM con dataset de referencia |
| Server-side batch | evaluación de producto | survey de empresas objetivo |
| Compliance HIPAA | evaluación | asesoría legal |
| Embeddings para grouping | prototipo | comparar recall vs Levenshtein |

---

## 8. Lo que probablemente no haremos

- **SaaS con cuentas y billing**: rompe la promesa local-first. Si hay producto server, es separado y pago por uso.
- **Mobile web con todos los motores**: móviles no tienen memoria para OCR + NER simultáneos. React Native con subsets sí.
- **Soporte para formatos exóticos** (RTF, ODT antiguo, PostScript): demanda muy baja, costo alto.
- **Anonimización criptográficamente garantizada (zero-knowledge proofs)**: fuera de alcance del producto, que es operacional.

---

## 9. Referencias

- `00_Project_Vision.md` §6 (alcance/no-alcance)
- `roadmap/Version_2.0.md`
- `adr/ADR-002-No-Backend.md` (el server-side sería producto separado)
