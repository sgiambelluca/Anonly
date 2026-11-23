# Medición de la tanda 1 (CL, UY, PY, BO y los tipos nuevos de AR)

Campaña 1.1.1, paso 2 de `Plan_1.1.1.md` §2. Prototipos fuera de los motores. **No se implementó nada en `packages/` ni en `apps/`, y no se commiteó.** Todo lo que se mide es **sintético**: no se usó ninguna variable `ANONLY_REAL_DOC_*` ni ningún documento real.

## A. Qué es y cómo leerlo

- **Qué se midió.** Cada formato propuesto en el informe de investigación (`Paises_Tanda1_Investigacion_2026-11-22.md`, con su §11 por encima del resto), más las formas de menor precisión o sin verificador que el Plan §5 manda medir **una por una**, contra un corpus sintético por país con verdad anotada (tramo y tipo), con negativos casi iguales, y en tres «versiones» de cada documento (normal, todo en MAYÚSCULAS, y con el texto de contexto en minúsculas).
- **Qué NO es.** No es un gate, no afirma umbrales. El **recall del corpus es optimista por construcción**: el corpus lo escribí con las formas que el informe propone, así que un recall de 100 % dice «el prototipo implementa lo que dice el informe», no «el formato cubre lo que se escribe en la realidad». Lo que discrimina son los **falsos positivos, las formas que se pierden, los choques y el ruido numérico** (§8b). Todo sale de datos sintéticos; **nada sale de documentos reales**.
- **Prototipos.** Dos maneras, según el informe: formas de **piezas** (`structure`, ADR-220: `chars`, `text`, `separator`, `optional`, con la semántica del spec: más a la izquierda y más largo, bordes de letra o dígito, contexto con `:` opcional) y formas de **RegExp con control** (`control`). Después del recorrido se aplica lo mismo que hace `RegexEngine.process`: control, **guarda de corrida** (la función `passesRunGuard` del motor, importada por ruta relativa, sin tocar el paquete) y **prioridad del match más largo** entre formatos base (reimplementada: `resolveOverlaps` con todos los formatos `base`).
- **Catálogo argentino.** `DEFAULT_PATTERNS_AR` importado de `packages/anonymization-core/regex-engine/src/patterns/default-ar.ts` (los quince patrones, con su checksum). Solo el email se corre con su `RegExp` y no con el escáner lineal del motor.
- **Fixtures argentinas usadas para los choques inversos (§5.2).** El dataset de referencia de `tests/fixtures/generate.ts` (`buildReferenceDocSpecs()`: 26 documentos, 33 páginas, con sus entidades anotadas) y `TEXT_10P_PAGES` (10 páginas, sin anotar). Total 43 páginas.
- **Decisiones del Plan §5 aplicadas.** RUT de CL bajo `DNI`; todas las formas sin verificador o de menor precisión **entran** y se miden aparte (`opcional`); CI y RUT de UY con puntos/guion se tapan siempre (sin control) y solo dígitos solo si pasa el verificador de python-stdnum; **no** se midieron los pasaportes de UY/PY/BO ni las licencias sin forma; **no** se midieron las patentes nuevas de Chile (5+1 y 4+1, DS 114/2025); la CI de BO conserva número, complemento y extensión en el normalizador.
- **Roles.** *Núcleo* = lo que el informe propone sin salvedad. *Opcional* = forma de menor precisión o sin verificador (se agrega de a una). *Alternativa* = reemplaza a otra forma (misma verdad esperada).

## B. Lo que más importa (hallazgos)

1. **Falsos positivos de las formas `structure` de patente, por palabra en mayúscula + número.** Es lo que más tapa de más: `cl:plate-moto-3l2d` 10 de 54 negativos del corpus normal («LEY 18», «ART 15», «IVA 19», «UTM 60», «DEC 30», «PAG 12», «SRL 12», «DFL 25»…); `py:plate-3l3d` 6 de 36 («USD 100», «ART 123», «DEC 500»); `bo:plate` 6 de 38 («100 USD», «2024 UFV», «100 KMS»); `py:plate-mercosur` 3 («LOTE 123», «FOJA 123», «ZONA 123»); `uy:plate-moto` 2; `uy:plate` 1; `cl:plate-moto-2l3d` 1 en las copias («EN 100»); `ar:passport` 4 de 19 («NRO 123456», «REF 654321», «EXP 123456»). La restricción de letras de `cl:plate-4l2d` los evita (0 FP) y su alternativa `structure` (`cl:plate-4l2d-lax`) da 4 de 54 («LOTE 12», «ZONA 12», «CAJA 15», «TOMO 45»). La lista de las 18 letras **no tiene fuente primaria** (informe §11.7).
2. **Las cédulas y el RUT sin verificador tapan de más todo número con puntos.** `py:ci` (núcleo) da 7 de 36 negativos en el corpus normal (montos `Gs. 2.500.000`, `1.234.567`), y **sobre 2000 montos aleatorios de 7 dígitos con puntos acierta el 100 %**; sobre 8 dígitos con puntos acierta el tramo interno `345.678` del 100 % (deja el `12.` a la vista). `uy:ci-sindv` (D-6) igual: 5 de 42, 100 % de los montos de 7 dígitos. Con contexto (`uy:ci-sindv-ctx`) bajan a 0 FP y pierde 2 de 8 verdades (las que no traen palabra de documento). `py:ci-ctx` y `bo:ci-ctx` dan 100 % y 74 % de FP sobre cualquier número tras «Nº» (FP de `Factura N° 123456`).
3. **Las formas `control` sin verificador real dejan pasar por azar una fracción fija de los números.** Sobre 2000 números aleatorios por largo (§8b): `cl:rut-singuion` 8,1 % (8 dígitos) y 8,9 % (9); `uy:ci-digitos` 11,3 % (7) y 10,4 % (8); `uy:ci-guion` 9,4 %; `ar:cbu` 1,1 % (22 dígitos); `cl:rut` con cuerpo y DV al azar 8,3 a 9,3 % (por eso el RUT con el DV mal tipeado queda **sin tapar** el 91 % de las veces: `cl:rut-ctx` lo cubre con RUT/RUN antes). `uy:rut` y `py:ruc` (que exige guion) casi no pasan nada sin separadores.
4. **Teléfonos fijos sin prefijo ni separador son ruido.** El esquema de `py:phone-landline` **tal como está en el informe §3.4** acierta el **79 %** de los números aleatorios de 8 y 9 dígitos (sin lista de códigos y sin exigir el 0 ni el prefijo). La alternativa que armé (`py:phone-landline-estricto`: prefijo de país o 0 inicial) da 0 FP en el corpus y 0 % en el ruido, y conserva el recall (8/8). `cl:phone-landline` acierta el **36 %** de los números de 9 dígitos pegados (Santiago `2` + los 23 códigos): hay que decidir si sin prefijo exige separador. Las formas `*-pegado` (UY, BO) dan 22 %, 23 % y 35 % de los números de 8 dígitos.
5. **Choques con el catálogo argentino (AR activo), §5.1.**
   - `cl:rut`: `dni-ar` tapa el cuerpo y **deja el dígito verificador a la vista** en 24 de 34 casos (parcial); en 10 casos no emite nada. Pasa igual con `uy:ci` (17 de 19 parciales) y `bo:ci-ext` (27 de 31 parciales: tapa el número y deja la extensión).
   - `py:ci` = `dni-ar` de 7 dígitos con puntos: AR lo cubre exacto 15 de 17; `uy:ci-digitos` y `uy:ci-sindv`: `dni-ar` los cubre exacto (mismo tipo, mismo tramo: no hay conflicto de tipo).
   - **Conflictos de tipo distinto:** `py:ruc` (CUIT) contra `dni-ar` (DNI) en 20 de 21; `uy:account-brou` contra `phone-landline-ar` en 7 de 7; `bo:nit-ctx` contra `phone-mobile-ar` en 13 de 16; `ar:cbu` en las grafías `8+14` y de a cuatro contra `dni-ar` y `phone-landline-ar` (16 de 33), que se resuelven por el match más largo (el CBU entero gana).
   - **Las formas nuevas sobre las fixtures argentinas (§5.2):** 47 matches entre las 42 formas juntas; 32 pisan una entidad argentina y 12 caen en texto sin verdad. Lo que más emite: `cl:plate-moto-3l2d` 10 («DNI 46» sobre `46.578.630`), `uy:ci-sindv` 10 y `py:ci` 10 (tramos `578.630` dentro de un DNI de 8 dígitos), `uy:phone-landline` 8, `py:phone-landline` 4, `bo:phone-mobile` 3 (dos dentro de un IBAN español). `cl:rut` emite 1 sobre un CUIT (`09082125-3` dentro de `23-09082125-3`: el DV coincide por azar; el match más largo del CUIT lo resuelve).
   - `ar:cbu` y `ar:passport` (§5.3): recall 33/33 y 21/21 también junto al catálogo argentino; `ar:passport` suma 4 FP sobre «NRO/REF/EXP + 6 dígitos».
6. **Universales (§6): la medición dice qué falla, no lo corrige.** En 5 países: **fecha con punto** (`17.05.2025`) 0 de 5; **mes abreviado** (`17-may-2025`) 0 de 1; **`Camino`** 0 de 2 y **`esq./c/`** 0 de 1 (PY: «Mcal. López c/ Brasil 1234»); **`Ruta`** con kilómetro: UY parcial (`Ruta 8`, deja el `km 17`) y PY sin detectar; **carátula con dos apellidos** 0 de 8 enteras (los ocho salen parciales: `caratula-ar` emite solo el segundo apellido y el nombre, y el primer apellido queda a la vista); la carátula en MAYÚSCULAS sin `c/` no se detecta. Fechas numéricas con `/` o `-` y en texto, y direcciones con `Avenida`, `Avda.`, `Calle`, `Pasaje`, `Bv.`: 100 %. Ningún universal pisa una entidad de un formato nuevo.
7. **Agrupación (§7).** El normalizador de `cl:rut` **separa** una identidad cuando el DV está mal tipeado (`14253687-0` y `14253687-1`), como corresponde; `uy:ci` separa «con DV» de «sin DV» (`34567894` y `3456789`); `bo:ci-ext` **separa** la misma CI escrita con extensión (`1234567/LP`) y sin ella (`1234567`, de `bo:ci-ctx`). **D-7 medido:** con el normalizador del Plan §5 (número + complemento + extensión) no se junta a nadie. Con uno alternativo que solo guarda el número se juntarían **3 números** que en el corpus son de personas distintas (`1234567` ← LP, SC y CB; `7654321` ← SC y LP; `3456789` ← CH y CB). Esos tres pares están **puestos a propósito** en el corpus (SEGIP 2011): no es una tasa.
8. **Mayúsculas y minúsculas.** Los formatos con letras en el match (patentes, extensión de la CI de BO) dan el mismo recall en la copia en MAYÚSCULAS. Con el texto en minúsculas las palabras de contexto siguen funcionando (se comparan por pliegue). En las patentes `structure` el FP depende de la caja: con el texto en minúsculas las palabras comunes («iva», «art») ya no matchean `upper` y el FP baja a 0; con todo en MAYÚSCULAS aparecen FP nuevos con palabras corrientes («EN 100» en `cl:plate-moto-2l3d`, «123 DEL» en `py:plate-moto-3d3l`).

## C. Dudas para el mantenedor (no elegí: las anoto)

1. **`py:ruc`: los ejemplos del informe no cierran con su algoritmo (§3.3 y §2 de la medición).** El algoritmo (que reproduce el ejemplo de DNIT `80000519-8` y `1234567-9`) da DV `0` para el cuerpo `80012345` y `7` para `2345678`; el informe dice `7` y `0`. Parecen intercambiados. Mi prototipo usa el algoritmo; los dos ejemplos del informe quedan sin detectar. ¿Cuál vale, el ejemplo o el algoritmo? (los demás ejemplos de RUC cierran).
2. **`cl:phone-landline`: «No detectar `29 345 6789`» contra «Santiago = `2` + 8 cifras» (§1.3).** Con `2` + 8 cifras, `29 345 6789` es un número de Santiago válido. El prototipo lo detecta. ¿Qué quería decir el «no detectar»?
3. **`cl:plate-4l2d`: «`BC.DF.12`» está en las formas del informe (§1.4) pero el patrón propuesto no lo cubre.** Quedó como verdad perdida (2 de 11). ¿Se agrega esa grafía, o se quita de la lista?
4. **Los esquemas de `cl:phone-landline` no cubren sus propios ejemplos (§1.3).** El esquema agrupa las 8 cifras de Santiago como 4+4 y el ejemplo `22 345 6789` es 1+3+4; y trae `6[1345 7]` con un espacio. Lo escribí como `\d[\s-]?\d{3}[\s-]?\d{4}` (1+3+4 tras el `2`) y leí `6[13457]`.
5. **`uy:ci`: la forma «puntos y guion» sin control (Plan §5) contradice el «No detectar `1.234.567-3`» del informe (§2.2).** Es una decisión posterior; el prototipo la sigue (tapa siempre). Pero la variante de 6 dígitos de esa forma (`123.456-1`) **también matchea dentro de un número de 8 dígitos con puntos** (`12.345.678-2` → emite `345.678-2`, deja el `12.` a la vista): 92 % de los `12.345.678-X` al azar. Igual `py:ci` de 6 dígitos dentro de `12.345.678`. Lo permite la regla de bordes del generador (el `.` no es letra ni dígito). ¿Se quita la variante de 6 dígitos, se agrega una guarda del punto, o se acepta?
6. **El informe se contradice en los teléfonos fijos de Paraguay (§3.4 contra §11.8).** El esquema de §3.4 acepta abonado de 6 o 7 cifras y no tiene lista de códigos; el §11.8 corrige Asunción a 7 cifras. Medí el esquema literal (`py:phone-landline`) y una alternativa que exige prefijo de país o el 0 (`py:phone-landline-estricto`); la comparación está en §4 y en el ruido de §8b.
7. **Contextos de más de cinco palabras.** El informe escribe «(5 palabras máximo)» junto a `py:ci-ctx`. No leí ADR-220 y no sé si el máximo es del formato o del informe. Mis contextos tienen entre 5 y 10 palabras (`cl:phone-mobile-pelado-ctx`: 10). Si el límite es de 5 por formato, hay que recortarlos; no cambia el recall del corpus (usa las primeras).
8. **`bo:nit-ctx` y el contexto «justo antes».** El spec de contexto exige la palabra **inmediatamente antes** (con espacios y `:`). 10 de las 16 verdades se escriben «NIT del emisor: 1234567010» o «NIT de la empresa 1020304050, 4012345679» y **no se detectan** (recall 6 de 16; en el corpus normal 6 de 11 quedan sin tapar). ¿Se acepta «hasta N palabras entre la etiqueta y el número» o se acepta la pérdida?
9. **BO: forma del complemento.** El informe propone `\d[A-Z]` (sin fuente); la nota de prensa de 2011 que cita (§11.4) habla de **dos dígitos** («irá desde uno hasta el 27») y no dice dónde va. No medí una forma con complemento de dos dígitos porque el Plan §5 no permite formatos sin forma confirmada. ¿Se busca?
10. **`cl:rut-ctx` (sin verificador, con RUT/RUN antes) no está en el informe:** la armé para medir qué pasa con el DV mal tipeado, que `cl:rut` deja sin tapar el 91 % de las veces. Igual con `cl:phone-mobile-pelado-ctx`, `cl:plate-4l2d-lax`, `uy:ci-guion-sc`, `uy:ci-sindv-ctx`, `py:phone-landline-estricto` y las formas `*-pegado`. Son alternativas mías para que el mantenedor compare; si no las quiere, se ignoran.
11. **`uy:phone-landline` sin prefijo exige separador (C-6) y `bo:phone-*` también.** Es la propuesta del informe; lo que queda **sin tapar** son los de 8 dígitos pegados, que son las formas `*-pegado` (opcionales, 22 a 35 % de ruido).
12. **D-1 a D-13 del informe siguen abiertas;** esta medición aporta números a D-3 (RUT sin guion: 8 % de ruido, 0 FP en el corpus), D-4 (las patentes viejas de CL, 2l4d y moto 2l3d, dan 0 FP en el corpus normal; el FP de patentes está en `cl:plate-moto-3l2d` y en PY y BO, ver B.1), D-6 (`uy:ci-sindv`: 100 % de los montos con puntos; con contexto, 0 FP y pierde 2 de 8), D-7 (arriba) y D-9 (contextos: ver 7 y 8).

## D. Lo que NO sale de esta medición (límites)

- **Todo sale de sintéticos.** Nada sale de documentos reales; los números, nombres, direcciones y patentes los inventé o los calculé. Los números reales, las formas con que de verdad se escribe una cédula en un escrito de Paraguay o Bolivia, o la frecuencia real de las palabras «ART/LEY/IVA» en mayúscula, **no están medidos**. Una medición que decide producto debería sumar documentos reales por `ANONLY_REAL_DOC_*` (fuera del alcance de esta tarea).
- **Los negativos son pocos** (36 a 54 por país en el corpus normal) y escritos a mano; el ruido numérico (§8b) es lo único estadístico (2000 números por largo, PRNG fijo), y solo para números sin contexto.
- **El recall es optimista** (ver §A).
- **El enumerador de piezas no es el autómata del motor** y el resolvedor de solapamientos es el de formatos base; no se ejerció la copia editada ni el conflicto con formatos propios (ADR-222).
- **El NER no entra** (carátulas y direcciones solo con sus patrones).
- **No se midió tiempo ni peor caso.** No se tocó `tests/perf`.

## E. Cómo reproducirla

```bash
pnpm exec vitest run --config tests/paises/vitest.paises.config.ts
```

Variables: `PAISES_OUT` (directorio de salida; por defecto el temporal del sistema). Escribe `medicion-tablas.md` (las tablas de abajo) y `medicion-datos.json`. Dura unos 2 segundos. **No entra en `pnpm test`:** el `include` del `vitest.config.ts` de la raíz es `tests/**/*.test.ts` y el archivo es `medicion.spec.ts`, con config propio (`tests/paises/vitest.paises.config.ts`); `vitest list` sobre la raíz no lo ve. Para correr solo prettier y eslint: `pnpm exec prettier --check tests/paises` y `pnpm exec eslint tests/paises` (los dos limpios); además `pnpm exec tsc -p tests/tsconfig.json --noEmit` sin errores.

Archivos (todo bajo `tests/paises/`, sin commitear): `medicion.spec.ts`, `vitest.paises.config.ts`, `corpus/{cl,uy,py,bo,ar}.ts`, `lib/{types,checks,gen,pieces,engine,formats,dsl,measure,examples,fixtures-ar,report}.ts`.

---

# Tablas (generadas por el comando de arriba)

## 0. Resumen por forma

Cada forma corrida sola sobre el corpus de su país (detalle en §3). *Recall* = exactas / esperadas, sobre todas las copias del corpus (normal, MAYÚS, minús). *FP corpus normal* = matches de la forma en los documentos normales que no son una entidad (caen sobre un negativo anotado o en texto corriente), de cuántos negativos anotados hay. *FP todas* = lo mismo sobre todas las copias (las copias en mayúsculas repiten los negativos).

| País | Forma | Tipo | Rol | Esperadas | Exactas | Recall | FP corpus normal | FP todas |
|---|---|---|---|---|---|---|---|---|
| CL | `cl:rut` | DNI | núcleo | 34 | 34 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:rut-singuion` | DNI | opcional | 4 | 4 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:rut-ctx` | DNI | opcional | 3 | 3 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:phone-mobile` | PHONE | núcleo | 11 | 11 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:phone-mobile-parentesis` | PHONE | opcional | 1 | 1 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:phone-mobile-pelado` | PHONE | opcional | 3 | 3 | 100.0 % | 1 de 54 | 3 |
| CL | `cl:phone-mobile-pelado-ctx` | PHONE | alternativa | 3 | 3 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:phone-landline` | PHONE | núcleo | 9 | 9 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:plate-4l2d` | PLATE | núcleo | 11 | 9 | 81.8 % | 0 de 54 | 0 |
| CL | `cl:plate-4l2d-lax` | PLATE | alternativa | 11 | 9 | 81.8 % | 4 de 54 | 4 |
| CL | `cl:plate-2l4d` | PLATE | núcleo | 8 | 8 | 100.0 % | 0 de 54 | 0 |
| CL | `cl:plate-moto-3l2d` | PLATE | núcleo | 6 | 6 | 100.0 % | 10 de 54 | 13 |
| CL | `cl:plate-moto-2l3d` | PLATE | núcleo | 6 | 6 | 100.0 % | 0 de 54 | 1 |
| UY | `uy:ci` | DNI | núcleo | 19 | 19 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:ci-digitos` | DNI | núcleo | 9 | 9 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:ci-guion` | DNI | opcional | 4 | 4 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:ci-guion-sc` | DNI | alternativa | 4 | 4 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:ci-sindv` | DNI | opcional | 8 | 8 | 100.0 % | 5 de 42 | 10 |
| UY | `uy:ci-sindv-ctx` | DNI | alternativa | 8 | 6 | 75.0 % | 0 de 42 | 0 |
| UY | `uy:rut` | CUIT | núcleo | 9 | 9 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:rut-separado` | CUIT | núcleo | 8 | 8 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:phone-mobile` | PHONE | núcleo | 14 | 14 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:phone-landline` | PHONE | núcleo | 10 | 10 | 100.0 % | 0 de 42 | 0 |
| UY | `uy:phone-landline-pegado` | PHONE | opcional | 2 | 2 | 100.0 % | 1 de 42 | 2 |
| UY | `uy:plate` | PLATE | núcleo | 13 | 13 | 100.0 % | 1 de 42 | 1 |
| UY | `uy:plate-moto` | PLATE | núcleo | 6 | 6 | 100.0 % | 2 de 42 | 3 |
| UY | `uy:account-brou` | BANK_ACCOUNT | núcleo | 7 | 7 | 100.0 % | 0 de 42 | 0 |
| PY | `py:ci` | DNI | núcleo | 17 | 17 | 100.0 % | 7 de 36 | 13 |
| PY | `py:ci-ctx` | DNI | opcional | 12 | 12 | 100.0 % | 3 de 36 | 6 |
| PY | `py:ruc` | CUIT | núcleo | 21 | 21 | 100.0 % | 0 de 36 | 0 |
| PY | `py:phone-mobile` | PHONE | núcleo | 14 | 12 | 85.7 % | 0 de 36 | 0 |
| PY | `py:phone-landline` | PHONE | núcleo | 8 | 8 | 100.0 % | 0 de 36 | 0 |
| PY | `py:phone-landline-estricto` | PHONE | alternativa | 8 | 8 | 100.0 % | 0 de 36 | 0 |
| PY | `py:plate-3l3d` | PLATE | núcleo | 4 | 4 | 100.0 % | 6 de 36 | 10 |
| PY | `py:plate-moto-3d3l` | PLATE | núcleo | 4 | 4 | 100.0 % | 1 de 36 | 2 |
| PY | `py:plate-mercosur` | PLATE | núcleo | 9 | 9 | 100.0 % | 3 de 36 | 5 |
| PY | `py:plate-moto-mercosur` | PLATE | núcleo | 4 | 4 | 100.0 % | 0 de 36 | 0 |
| BO | `bo:ci-ext` | DNI | núcleo | 31 | 31 | 100.0 % | 0 de 38 | 0 |
| BO | `bo:ci-ctx` | DNI | opcional | 6 | 6 | 100.0 % | 2 de 38 | 4 |
| BO | `bo:nit-ctx` | CUIT | opcional | 16 | 6 | 37.5 % | 0 de 38 | 0 |
| BO | `bo:phone-mobile` | PHONE | núcleo | 13 | 13 | 100.0 % | 0 de 38 | 0 |
| BO | `bo:phone-mobile-pegado` | PHONE | opcional | 4 | 4 | 100.0 % | 1 de 38 | 3 |
| BO | `bo:phone-landline` | PHONE | núcleo | 8 | 8 | 100.0 % | 0 de 38 | 0 |
| BO | `bo:phone-landline-pegado` | PHONE | opcional | 1 | 1 | 100.0 % | 0 de 38 | 0 |
| BO | `bo:plate` | PLATE | núcleo | 17 | 17 | 100.0 % | 6 de 38 | 8 |
| AR | `ar:cbu` | BANK_ACCOUNT | núcleo | 33 | 33 | 100.0 % | 0 de 19 | 0 |
| AR | `ar:passport` | PASSPORT | núcleo | 21 | 21 | 100.0 % | 4 de 19 | 4 |

## 1. Tamaño del corpus

| País | Docs normal | Docs MAYÚS | Docs minús | Caracteres | Entidades P (normal) | Entidades P (total) | Negativos (normal) | Negativos (total) | Universales U (normal) |
|---|---|---|---|---|---|---|---|---|---|
| CL | 8 | 3 | 3 | 8942 | 57 | 96 | 54 | 97 | 23 |
| UY | 8 | 3 | 3 | 7186 | 66 | 109 | 42 | 80 | 19 |
| PY | 6 | 3 | 2 | 5761 | 53 | 93 | 36 | 69 | 16 |
| BO | 6 | 3 | 2 | 5704 | 56 | 96 | 38 | 74 | 15 |
| AR | 3 | 1 | 1 | 3457 | 40 | 74 | 19 | 33 | 5 |

«Normal» son los documentos escritos; «MAYÚS» son copias de algunos pasadas a mayúsculas (todo el texto y las entidades); «minús» son copias con el texto de contexto en minúsculas (las entidades quedan como están, los negativos van en minúscula). Las copias repiten las mismas entidades, por eso se cuenta aparte lo «normal».

Entidades por forma (P):

| País | Forma | Tipo | Normal | Total |
|---|---|---|---|---|
| CL | cl:phone-landline | PHONE | 7 | 9 |
| CL | cl:phone-mobile | PHONE | 7 | 11 |
| CL | cl:phone-mobile-parentesis | PHONE | 1 | 1 |
| CL | cl:phone-mobile-pelado | PHONE | 2 | 3 |
| CL | cl:plate-2l4d | PLATE | 4 | 8 |
| CL | cl:plate-4l2d | PLATE | 5 | 11 |
| CL | cl:plate-moto-2l3d | PLATE | 3 | 6 |
| CL | cl:plate-moto-3l2d | PLATE | 3 | 6 |
| CL | cl:rut | DNI | 18 | 34 |
| CL | cl:rut-ctx | DNI | 3 | 3 |
| CL | cl:rut-singuion | DNI | 4 | 4 |
| UY | uy:account-brou | BANK_ACCOUNT | 4 | 7 |
| UY | uy:ci | DNI | 10 | 19 |
| UY | uy:ci-digitos | DNI | 6 | 9 |
| UY | uy:ci-guion | DNI | 4 | 4 |
| UY | uy:ci-sindv | DNI | 6 | 8 |
| UY | uy:phone-landline | PHONE | 7 | 10 |
| UY | uy:phone-landline-pegado | PHONE | 2 | 2 |
| UY | uy:phone-mobile | PHONE | 9 | 14 |
| UY | uy:plate | PLATE | 6 | 13 |
| UY | uy:plate-moto | PLATE | 3 | 6 |
| UY | uy:rut | CUIT | 5 | 9 |
| UY | uy:rut-separado | CUIT | 4 | 8 |
| PY | py:ci | DNI | 8 | 17 |
| PY | py:ci-ctx | DNI | 6 | 12 |
| PY | py:phone-landline | PHONE | 7 | 8 |
| PY | py:phone-mobile | PHONE | 9 | 14 |
| PY | py:plate-3l3d | PLATE | 2 | 4 |
| PY | py:plate-mercosur | PLATE | 4 | 9 |
| PY | py:plate-moto-3d3l | PLATE | 2 | 4 |
| PY | py:plate-moto-mercosur | PLATE | 2 | 4 |
| PY | py:ruc | CUIT | 13 | 21 |
| BO | bo:ci-ctx | DNI | 5 | 6 |
| BO | bo:ci-ext | DNI | 15 | 31 |
| BO | bo:nit-ctx | CUIT | 11 | 16 |
| BO | bo:phone-landline | PHONE | 6 | 8 |
| BO | bo:phone-landline-pegado | PHONE | 1 | 1 |
| BO | bo:phone-mobile | PHONE | 8 | 13 |
| BO | bo:phone-mobile-pegado | PHONE | 2 | 4 |
| BO | bo:plate | PLATE | 8 | 17 |
| AR | ar:cbu | BANK_ACCOUNT | 18 | 33 |
| AR | ar:cuit-ar | CUIT | 4 | 7 |
| AR | ar:dni-ar | DNI | 3 | 5 |
| AR | ar:passport | PASSPORT | 11 | 21 |
| AR | ar:phone-landline-ar | PHONE | 1 | 2 |
| AR | ar:phone-mobile-ar | PHONE | 1 | 2 |
| AR | ar:plate-mercosur-ar | PLATE | 1 | 2 |
| AR | ar:plate-vieja-ar | PLATE | 1 | 2 |

Negativos por clase (corpus normal):

| País | Clases |
|---|---|
| CL | art: 1; bloque: 1; boleta: 1; caja: 1; causa: 1; cert: 1; codigo: 2; cp: 2; cuotas: 1; dec: 1; depto: 1; dfl: 1; est: 1; expediente: 1; factura: 2; fojas: 2; folio: 2; iva: 1; ley: 2; lote: 1; monto: 10; n: 2; numero: 1; oc: 1; oficio: 1; pag: 2; piso: 1; planta: 1; ref: 1; rol: 1; rol-avaluo: 1; ruc: 1; serie: 1; sociedad: 1; tomo: 1; utm: 1; zona: 1 |
| UY | apto: 1; art: 1; caja: 1; casa: 1; casilla: 1; codigo: 2; contrato: 1; cp: 2; dec: 1; est: 1; exp: 1; expediente: 1; fojas: 1; folio: 1; iue: 1; iva: 1; ley: 1; lote: 1; monto: 10; n: 2; oc: 1; op: 1; orden: 1; padron: 2; pag: 1; piso: 1; ref: 1; res: 1; serie: 1 |
| PY | art: 2; casa: 1; codigo: 1; cp: 2; cuenta: 1; dec: 1; est: 1; exp: 1; factura: 2; finca: 2; fojas: 1; folio: 1; iva: 1; km: 1; ley: 1; lote: 1; monto: 7; n: 1; oc: 1; piso: 1; ref: 1; timbrado: 1; usd: 3; zona: 1 |
| BO | art: 2; casa: 1; codigo: 2; cp: 1; ctrl: 1; cuf: 1; dec: 1; detalle: 1; est: 1; exp: 2; factura: 2; fojas: 2; folio: 1; iva: 1; km: 1; ley: 2; lote: 1; monto: 5; n: 1; nit-sin-etiqueta: 1; pago: 1; piso: 1; ufv: 2; usd: 3; zona: 1 |
| AR | alias: 1; cbu-21: 1; cbu-23: 1; cbu-dv1: 1; cbu-dv2: 2; contrato: 1; corto: 1; cuatro-letras: 1; dos-letras: 1; exp: 2; factura: 1; inversa: 1; lote: 1; monto: 1; nro: 1; orden: 1; ref: 1 |

Universales anotados (verdad U, corpus normal):

| País | Tipos |
|---|---|
| CL | ADDRESS: 7; DATE: 15; PERSON: 1 |
| UY | ADDRESS: 7; DATE: 10; PERSON: 2 |
| PY | ADDRESS: 6; DATE: 9; PERSON: 1 |
| BO | ADDRESS: 6; DATE: 8; PERSON: 1 |
| AR | ADDRESS: 1; CREDIT_CARD: 1; DATE: 3 |

## 2. Los ejemplos del informe contra los prototipos

Cada «Detectar» y «No detectar» de `Paises_Tanda1_Investigacion_2026-11-22.md`, corridos tal cual contra su prototipo (solo esas formas, con guarda de corrida). Un desacuerdo es una duda, no un fallo: puede ser un error del informe, uno del prototipo o una decisión posterior del Plan §5.

| Familia de formas | Informe | Detecta (de los «detectar») | No detecta (de los «no detectar») |
|---|---|---|---|
| cl:rut | §1.2 | 8/8 | 6/6 |
| cl:phone-mobile | §1.3 | 5/5 | 5/5 |
| cl:phone-landline | §1.3 | 4/4 | 3/4 |
| cl:plate-4l2d | §1.4 | 4/5 | 5/5 |
| cl:plate-2l4d | §1.4 | 4/4 | 4/4 |
| cl:plate-moto-3l2d | §1.4 | 3/3 | 3/3 |
| cl:plate-moto-2l3d | §1.4 | 3/3 | 3/3 |
| uy:ci (tres formas) | §2.2 | 6/6 | 2/4 |
| uy:rut (continuo y separado) | §2.3 | 4/4 | 4/4 |
| uy:phone-mobile | §2.4 | 4/4 | 4/4 |
| uy:phone-landline | §2.4 | 4/4 | 3/3 |
| uy:plate | §2.5 | 4/4 | 3/3 |
| uy:account-brou | §2.6 | 3/3 | 3/3 |
| py:ci | §3.2 | 4/4 | 3/4 |
| py:ci-ctx | §3.2 | 3/3 | 3/3 |
| py:ruc | §3.3 | 4/6 | 4/4 |
| py:phone-mobile | §3.4 | 4/4 | 3/3 |
| py:plate (cuatro formas) | §3.5 | 6/6 | 4/4 |
| bo:ci-ext | §4.2 | 4/4 | 4/4 |
| bo:ci-ctx | §4.2 | 2/2 | 1/1 |
| bo:nit-ctx | §4.3 | 3/3 | 3/3 |
| bo:phone-mobile | §4.4 | 4/4 | 3/3 |
| bo:phone-landline | §4.4 | 3/3 | 2/2 |
| bo:plate | §4.5 | 4/4 | 4/4 |
| ar:cbu | §5.1 y §11.6 | 9/9 | 5/5 |
| ar:passport | §5.3 | 4/4 | 4/4 |

Desacuerdos:

- `cl:phone-landline`, NO debería detectar «29 345 6789»: detecta «29 345 6789» (cl:phone-landline).
- `cl:plate-4l2d`, debería detectar «BC.DF.12»: no detecta nada.
- `uy:ci (tres formas)`, NO debería detectar «1.234.567-3»: detecta «1.234.567-3» (uy:ci).
- `uy:ci (tres formas)`, NO debería detectar «12.345.678-2»: detecta «345.678-2» (uy:ci).
- `py:ci`, NO debería detectar «12.345.678»: detecta «345.678» (py:ci).
- `py:ruc`, debería detectar «80012345-7»: no detecta nada.
- `py:ruc`, debería detectar «2345678-0»: no detecta nada.

## 3. Medición por forma

**Método.** Cada forma se corre **sola** (con la guarda de corrida de ADR-075 §2 y el control propio) sobre todos los documentos de su país, y se compara con la verdad anotada. *Esperadas* = entidades P cuya forma es esa (o la que esa forma reemplaza). *Exactas* = el match tiene el mismo tramo y el mismo tipo que la verdad. *Parcial* = solapa una verdad del mismo tipo con otro tramo. *Otro tipo* = solapa una verdad de otro tipo. *FP negativo* = el match cae sobre un negativo anotado; *FP texto* = cae en texto corriente sin verdad ni negativo. *Solapa* = match parcial o de otro tipo sobre una verdad.

### CL

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cl:rut` | DNI | control | núcleo | 34 | 34 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 0 | 18/18 | 10/10 | 6/6 |
| `cl:rut-singuion` | DNI | control | opcional | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 0 | 4/4 | - | - |
| `cl:rut-ctx` | DNI | structure+context | opcional | 3 | 3 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 21 | 3/3 | - | - |
| `cl:phone-mobile` | PHONE | structure | núcleo | 11 | 11 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 1 | 0 | 7/7 | 2/2 | 2/2 |
| `cl:phone-mobile-parentesis` | PHONE | structure | opcional | 1 | 1 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 0 | 1/1 | - | - |
| `cl:phone-mobile-pelado` | PHONE | structure | opcional | 3 | 3 | 100.0 % | 0 | 0 | 0 | 3 | 1 de 54 | 0 | 0 | 2/2 | - | 1/1 |
| `cl:phone-mobile-pelado-ctx` | PHONE | structure+context | alternativa de `cl:phone-mobile-pelado` | 3 | 3 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 0 | 2/2 | - | 1/1 |
| `cl:phone-landline` | PHONE | control | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 0 | 0 | 7/7 | 1/1 | 1/1 |
| `cl:plate-4l2d` | PLATE | control | núcleo | 11 | 9 | 81.8 % | 0 | 0 | 2 | 0 | 0 de 54 | 0 | 0 | 4/5 | 1/1 | 4/5 |
| `cl:plate-4l2d-lax` | PLATE | structure | alternativa de `cl:plate-4l2d` | 11 | 9 | 81.8 % | 0 | 0 | 2 | 4 | 4 de 54 | 0 | 0 | 4/5 | 1/1 | 4/5 |
| `cl:plate-2l4d` | PLATE | structure | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 54 | 3 | 0 | 4/4 | - | 4/4 |
| `cl:plate-moto-3l2d` | PLATE | structure | núcleo | 6 | 6 | 100.0 % | 0 | 0 | 0 | 13 | 10 de 54 | 12 | 0 | 3/3 | 2/2 | 1/1 |
| `cl:plate-moto-2l3d` | PLATE | structure | núcleo | 6 | 6 | 100.0 % | 0 | 0 | 0 | 1 | 0 de 54 | 0 | 0 | 3/3 | 2/2 | 1/1 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `cl:rut` | cuerpo 7 dígitos | 2 | 2 | 0 | 0 |
| `cl:rut` | dv-K | 2 | 2 | 0 | 0 |
| `cl:rut` | dv-k-minuscula | 2 | 2 | 0 | 0 |
| `cl:rut` | empresa | 3 | 3 | 0 | 0 |
| `cl:rut` | puntos+guion | 15 | 15 | 0 | 0 |
| `cl:rut` | sin puntos | 10 | 10 | 0 | 0 |
| `cl:rut-singuion` | espacio-DV | 2 | 2 | 0 | 0 |
| `cl:rut-singuion` | pegado | 2 | 2 | 0 | 0 |
| `cl:rut-ctx` | dv-errado | 3 | 3 | 0 | 0 |
| `cl:phone-mobile` | +56 9 4+4 | 3 | 3 | 0 | 0 |
| `cl:phone-mobile` | +569 8 | 2 | 2 | 0 | 0 |
| `cl:phone-mobile` | +56987654321 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile` | 56 9 4+4 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile` | 9 4+4 | 3 | 3 | 0 | 0 |
| `cl:phone-mobile` | 9-4-4 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile-parentesis` | (+56) | 1 | 1 | 0 | 0 |
| `cl:phone-mobile-pelado` | pelado | 3 | 3 | 0 | 0 |
| `cl:phone-mobile-pelado-ctx` | pelado | 3 | 3 | 0 | 0 |
| `cl:phone-landline` | (02) | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | (32) 7 | 5 | 5 | 0 | 0 |
| `cl:phone-landline` | +56 41 7 | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | 2+8 con prefijo | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | 22 3+4 | 1 | 1 | 0 | 0 |
| `cl:plate-4l2d` | 4l2d con punto | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d` | 4l2d | 7 | 7 | 0 | 0 |
| `cl:plate-4l2d` | BC.DF.12 | 2 | 0 | 0 | 2 |
| `cl:plate-4l2d-lax` | 4l2d con punto | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d-lax` | 4l2d | 7 | 7 | 0 | 0 |
| `cl:plate-4l2d-lax` | BC.DF.12 | 2 | 0 | 0 | 2 |
| `cl:plate-2l4d` | 2l4d con puntos | 2 | 2 | 0 | 0 |
| `cl:plate-2l4d` | 2l4d | 6 | 6 | 0 | 0 |
| `cl:plate-moto-3l2d` | moto 3l2d | 6 | 6 | 0 | 0 |
| `cl:plate-moto-2l3d` | moto 2l3d | 6 | 6 | 0 | 0 |

### UY

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `uy:ci` | DNI | structure | núcleo | 19 | 19 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 10/10 | 5/5 | 4/4 |
| `uy:ci-digitos` | DNI | control | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 6/6 | 1/1 | 2/2 |
| `uy:ci-guion` | DNI | control | opcional | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 4/4 | - | - |
| `uy:ci-guion-sc` | DNI | structure | alternativa de `uy:ci-guion` | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 4/4 | - | - |
| `uy:ci-sindv` | DNI | structure | opcional | 8 | 8 | 100.0 % | 0 | 0 | 0 | 10 | 5 de 42 | 19 | 0 | 6/6 | 2/2 | - |
| `uy:ci-sindv-ctx` | DNI | structure+context | alternativa de `uy:ci-sindv` | 8 | 6 | 75.0 % | 0 | 0 | 2 | 0 | 0 de 42 | 18 | 0 | 4/6 | 2/2 | - |
| `uy:rut` | CUIT | control | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 5/5 | 3/3 | 1/1 |
| `uy:rut-separado` | CUIT | structure | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 4/4 | 3/3 | 1/1 |
| `uy:phone-mobile` | PHONE | control | núcleo | 14 | 14 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 9/9 | 2/2 | 3/3 |
| `uy:phone-landline` | PHONE | control | núcleo | 10 | 10 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 7/7 | 1/1 | 2/2 |
| `uy:phone-landline-pegado` | PHONE | control | opcional | 2 | 2 | 100.0 % | 0 | 0 | 0 | 2 | 1 de 42 | 3 | 0 | 2/2 | - | - |
| `uy:plate` | PLATE | structure | núcleo | 13 | 13 | 100.0 % | 0 | 0 | 0 | 1 | 1 de 42 | 0 | 0 | 6/6 | 2/2 | 5/5 |
| `uy:plate-moto` | PLATE | structure | núcleo | 6 | 6 | 100.0 % | 0 | 0 | 0 | 3 | 2 de 42 | 0 | 0 | 3/3 | - | 3/3 |
| `uy:account-brou` | BANK_ACCOUNT | structure | núcleo | 7 | 7 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 42 | 0 | 0 | 4/4 | 2/2 | 1/1 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `uy:ci` | 6 dígitos | 2 | 2 | 0 | 0 |
| `uy:ci` | dv-errado | 2 | 2 | 0 | 0 |
| `uy:ci` | puntos+guion | 15 | 15 | 0 | 0 |
| `uy:ci-digitos` | 7 dígitos (6+DV) | 1 | 1 | 0 | 0 |
| `uy:ci-digitos` | 8 dígitos | 8 | 8 | 0 | 0 |
| `uy:ci-guion` | guion sin puntos | 4 | 4 | 0 | 0 |
| `uy:ci-guion-sc` | guion sin puntos | 4 | 4 | 0 | 0 |
| `uy:ci-sindv` | sin DV con contexto | 6 | 6 | 0 | 0 |
| `uy:ci-sindv` | sin DV sin contexto | 2 | 2 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV con contexto | 6 | 6 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV sin contexto | 2 | 0 | 0 | 2 |
| `uy:rut` | 12 dígitos | 9 | 9 | 0 | 0 |
| `uy:rut-separado` | dv-errado | 2 | 2 | 0 | 0 |
| `uy:rut-separado` | guiones | 6 | 6 | 0 | 0 |
| `uy:phone-mobile` | (+598) | 1 | 1 | 0 | 0 |
| `uy:phone-mobile` | +598 099 3+3 | 1 | 1 | 0 | 0 |
| `uy:phone-mobile` | +598 94 3+3 | 1 | 1 | 0 | 0 |
| `uy:phone-mobile` | +598 99 3+3 | 1 | 1 | 0 | 0 |
| `uy:phone-mobile` | 099 3+3 | 3 | 3 | 0 | 0 |
| `uy:phone-mobile` | 099 sin sep | 2 | 2 | 0 | 0 |
| `uy:phone-mobile` | 09X 3+3 | 3 | 3 | 0 | 0 |
| `uy:phone-mobile` | 09X sin sep | 2 | 2 | 0 | 0 |
| `uy:phone-landline` | (02) 901 2345 | 1 | 1 | 0 | 0 |
| `uy:phone-landline` | +598 2901 2345 | 2 | 2 | 0 | 0 |
| `uy:phone-landline` | 2 901 2345 | 1 | 1 | 0 | 0 |
| `uy:phone-landline` | 2901 23 45 | 1 | 1 | 0 | 0 |
| `uy:phone-landline` | 2901 2345 | 4 | 4 | 0 | 0 |
| `uy:phone-landline` | 4332 1234 | 1 | 1 | 0 | 0 |
| `uy:phone-landline-pegado` | pegado | 2 | 2 | 0 | 0 |
| `uy:plate` | 3l4d | 13 | 13 | 0 | 0 |
| `uy:plate-moto` | 3l3d | 6 | 6 | 0 | 0 |
| `uy:account-brou` | 9+5 | 7 | 7 | 0 | 0 |

### PY

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `py:ci` | DNI | structure | núcleo | 17 | 17 | 100.0 % | 0 | 0 | 0 | 13 | 7 de 36 | 4 | 0 | 8/8 | 6/6 | 3/3 |
| `py:ci-ctx` | DNI | structure+context | opcional | 12 | 12 | 100.0 % | 0 | 0 | 0 | 6 | 3 de 36 | 0 | 0 | 6/6 | 5/5 | 1/1 |
| `py:ruc` | CUIT | control | núcleo | 21 | 21 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 36 | 0 | 0 | 13/13 | 6/6 | 2/2 |
| `py:phone-mobile` | PHONE | control | núcleo | 14 | 12 | 85.7 % | 0 | 0 | 2 | 0 | 0 de 36 | 0 | 0 | 8/9 | 1/1 | 3/4 |
| `py:phone-landline` | PHONE | control | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 36 | 11 | 0 | 7/7 | 1/1 | - |
| `py:phone-landline-estricto` | PHONE | control | alternativa de `py:phone-landline` | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 36 | 0 | 0 | 7/7 | 1/1 | - |
| `py:plate-3l3d` | PLATE | structure | núcleo | 4 | 4 | 100.0 % | 0 | 0 | 0 | 10 | 6 de 36 | 0 | 0 | 2/2 | - | 2/2 |
| `py:plate-moto-3d3l` | PLATE | structure | núcleo | 4 | 4 | 100.0 % | 0 | 0 | 0 | 2 | 1 de 36 | 0 | 0 | 2/2 | - | 2/2 |
| `py:plate-mercosur` | PLATE | structure | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 5 | 3 de 36 | 0 | 0 | 4/4 | 1/1 | 4/4 |
| `py:plate-moto-mercosur` | PLATE | structure | núcleo | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 36 | 0 | 0 | 2/2 | - | 2/2 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `py:ci` | 6 dígitos | 2 | 2 | 0 | 0 |
| `py:ci` | con puntos | 15 | 15 | 0 | 0 |
| `py:ci-ctx` | C.I. + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | C.I.: + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | CI: + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | CIC + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | cédula + número | 4 | 4 | 0 | 0 |
| `py:ruc` | 6 dígitos | 1 | 1 | 0 | 0 |
| `py:ruc` | cuerpo-DV | 7 | 7 | 0 | 0 |
| `py:ruc` | cédula con puntos + DV | 4 | 4 | 0 | 0 |
| `py:ruc` | empresa | 1 | 1 | 0 | 0 |
| `py:ruc` | persona física | 8 | 8 | 0 | 0 |
| `py:phone-mobile` | (0981) | 2 | 2 | 0 | 0 |
| `py:phone-mobile` | +595 3+3 | 2 | 2 | 0 | 0 |
| `py:phone-mobile` | +595 981 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | +595 sin sep | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0981 3+3 | 3 | 3 | 0 | 0 |
| `py:phone-mobile` | 0981-123-456 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0981123456 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0991-3+3 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | sin 0 | 2 | 0 | 0 | 2 |
| `py:phone-landline` | (021) | 1 | 1 | 0 | 0 |
| `py:phone-landline` | +595 21 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | +595 61 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | 021 3+4 | 3 | 3 | 0 | 0 |
| `py:phone-landline` | 0541 3+3 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | 061 3+4 | 1 | 1 | 0 | 0 |
| `py:phone-landline-estricto` | (021) | 1 | 1 | 0 | 0 |
| `py:phone-landline-estricto` | +595 21 | 1 | 1 | 0 | 0 |
| `py:phone-landline-estricto` | +595 61 | 1 | 1 | 0 | 0 |
| `py:phone-landline-estricto` | 021 3+4 | 3 | 3 | 0 | 0 |
| `py:phone-landline-estricto` | 0541 3+3 | 1 | 1 | 0 | 0 |
| `py:phone-landline-estricto` | 061 3+4 | 1 | 1 | 0 | 0 |
| `py:plate-3l3d` | 3l3d | 4 | 4 | 0 | 0 |
| `py:plate-moto-3d3l` | 3d3l con guion | 2 | 2 | 0 | 0 |
| `py:plate-moto-3d3l` | 3d3l | 2 | 2 | 0 | 0 |
| `py:plate-mercosur` | 4l3d sin sep | 2 | 2 | 0 | 0 |
| `py:plate-mercosur` | 4l3d | 7 | 7 | 0 | 0 |
| `py:plate-moto-mercosur` | 3d4l con guion | 2 | 2 | 0 | 0 |
| `py:plate-moto-mercosur` | 3d4l | 2 | 2 | 0 | 0 |

### BO

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `bo:ci-ext` | DNI | control | núcleo | 31 | 31 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 38 | 0 | 0 | 15/15 | 13/13 | 3/3 |
| `bo:ci-ctx` | DNI | structure+context | opcional | 6 | 6 | 100.0 % | 0 | 0 | 0 | 4 | 2 de 38 | 18 | 0 | 5/5 | - | 1/1 |
| `bo:nit-ctx` | CUIT | structure+context | opcional | 16 | 6 | 37.5 % | 0 | 0 | 10 | 0 | 0 de 38 | 0 | 0 | 5/11 | 1/4 | 0/1 |
| `bo:phone-mobile` | PHONE | control | núcleo | 13 | 13 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 38 | 0 | 0 | 8/8 | 1/1 | 4/4 |
| `bo:phone-mobile-pegado` | PHONE | control | opcional | 4 | 4 | 100.0 % | 0 | 0 | 0 | 3 | 1 de 38 | 2 | 0 | 2/2 | - | 2/2 |
| `bo:phone-landline` | PHONE | control | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 38 | 0 | 0 | 6/6 | 2/2 | - |
| `bo:phone-landline-pegado` | PHONE | control | opcional | 1 | 1 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 38 | 0 | 0 | 1/1 | - | - |
| `bo:plate` | PLATE | structure | núcleo | 17 | 17 | 100.0 % | 0 | 0 | 0 | 8 | 6 de 38 | 1 | 0 | 8/8 | 2/2 | 7/7 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `bo:ci-ext` | 6 dígitos | 2 | 2 | 0 | 0 |
| `bo:ci-ext` | con complemento | 2 | 2 | 0 | 0 |
| `bo:ci-ext` | extensión con puntos | 1 | 1 | 0 | 0 |
| `bo:ci-ext` | mismo número que otra persona | 4 | 4 | 0 | 0 |
| `bo:ci-ext` | número + extensión | 22 | 22 | 0 | 0 |
| `bo:ci-ctx` | pelado con complemento | 1 | 1 | 0 | 0 |
| `bo:ci-ctx` | pelado con contexto | 5 | 5 | 0 | 0 |
| `bo:nit-ctx` | N.I.T. + número | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | NIT + número | 3 | 3 | 0 | 0 |
| `bo:nit-ctx` | NIT + palabras + número | 7 | 0 | 0 | 7 |
| `bo:nit-ctx` | NIT 12 dígitos + palabras | 2 | 0 | 0 | 2 |
| `bo:nit-ctx` | NIT corto (5) | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | NIT: + número | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | segundo NIT de una lista | 1 | 0 | 0 | 1 |
| `bo:phone-mobile` | (591) | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | +591 7 3+4 | 1 | 1 | 0 | 0 |
| `bo:phone-mobile` | +591 71234567 | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 591- | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 6234 5678 | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 7123 4567 | 4 | 4 | 0 | 0 |
| `bo:phone-mobile-pegado` | pegado | 4 | 4 | 0 | 0 |
| `bo:phone-landline` | (2) 3+4 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | (4) 3+4 | 3 | 3 | 0 | 0 |
| `bo:phone-landline` | +591 2 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | +591 3 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | 2 7 | 2 | 2 | 0 | 0 |
| `bo:phone-landline-pegado` | pegado | 1 | 1 | 0 | 0 |
| `bo:plate` | 3d3l sin sep | 2 | 2 | 0 | 0 |
| `bo:plate` | 3d3l | 2 | 2 | 0 | 0 |
| `bo:plate` | 4d3l sin sep | 2 | 2 | 0 | 0 |
| `bo:plate` | 4d3l | 11 | 11 | 0 | 0 |

### AR

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ar:cbu` | BANK_ACCOUNT | control | núcleo | 33 | 33 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 19 | 0 | 0 | 18/18 | 15/15 | - |
| `ar:passport` | PASSPORT | structure | núcleo | 21 | 21 | 100.0 % | 0 | 0 | 0 | 4 | 4 de 19 | 0 | 0 | 11/11 | - | 10/10 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `ar:cbu` | 22 seguidos | 12 | 12 | 0 | 0 |
| `ar:cbu` | 4+4+4+4+4+2 | 6 | 6 | 0 | 0 |
| `ar:cbu` | 8+14 con espacio | 4 | 4 | 0 | 0 |
| `ar:cbu` | 8+14 con guion | 2 | 2 | 0 | 0 |
| `ar:cbu` | CVU 22 seguidos | 5 | 5 | 0 | 0 |
| `ar:cbu` | CVU 4+4+4+4+4+2 | 2 | 2 | 0 | 0 |
| `ar:cbu` | CVU 8+14 | 2 | 2 | 0 | 0 |
| `ar:passport` | 3l6d con espacio | 7 | 7 | 0 | 0 |
| `ar:passport` | 3l6d con guion | 6 | 6 | 0 | 0 |
| `ar:passport` | 3l6d pegado | 6 | 6 | 0 | 0 |
| `ar:passport` | ZZX (refugiados, sin confirmar) | 2 | 2 | 0 | 0 |

## 4. Combinaciones: núcleo, núcleo más cada forma opcional, completo

País activo = las formas del país más los universales (email, IBAN, tarjeta, fecha, fecha en texto, carátula, dirección), con control, guarda y prioridad del match más largo entre formatos base (caso 10). *Núcleo* = las formas no opcionales. *Alcance* = las verdades cuya forma está en la combinación. FP país / FP universal se separan por el origen del match. Δ = cambio contra el núcleo (exactas y FP del país). La fila «en lugar de» reemplaza la forma que dice la alternativa.

### CL

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 85 | 83 | 97.6 % | 0 | 2 | 13 | 1 | 0 | 0 | 4 | 0/11 | +0 | +0 |
| núcleo + `cl:rut-singuion` | 89 | 87 | 97.8 % | 0 | 2 | 13 | 1 | 0 | 0 | 4 | 0/7 | +4 | +0 |
| núcleo + `cl:rut-ctx` | 88 | 86 | 97.7 % | 0 | 2 | 13 | 1 | 0 | 0 | 3 | 0/8 | +3 | +0 |
| núcleo + `cl:phone-mobile-parentesis` | 86 | 84 | 97.7 % | 0 | 2 | 13 | 1 | 0 | 0 | 3 | 0/10 | +1 | +0 |
| núcleo + `cl:phone-mobile-pelado` | 88 | 86 | 97.7 % | 0 | 2 | 16 | 1 | 0 | 0 | 4 | 0/8 | +3 | +3 |
| núcleo con `cl:phone-mobile-pelado-ctx` en lugar de `cl:phone-mobile-pelado` | 88 | 86 | 97.7 % | 0 | 2 | 13 | 1 | 0 | 0 | 4 | 0/8 | +3 | +0 |
| núcleo con `cl:plate-4l2d-lax` en lugar de `cl:plate-4l2d` | 85 | 83 | 97.6 % | 0 | 2 | 17 | 1 | 0 | 0 | 4 | 0/11 | +0 | +4 |
| completo (núcleo + todas las opcionales, sin alternativas) | 96 | 94 | 97.9 % | 0 | 2 | 16 | 1 | 0 | 0 | 2 | 0/0 | +11 | +3 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Núñez, Camila» sobre «Barría Núñez, Camila» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): `cl:phone-mobile-pelado` «987654321»; `cl:plate-moto-3l2d` «LEY 18»; `cl:plate-moto-3l2d` «ART 15»; `cl:plate-moto-3l2d` «IVA 19» (texto); `cl:plate-moto-3l2d` «IVA 19»; `cl:plate-moto-3l2d` «UTM 60»; `cl:plate-moto-3l2d` «DEC 30»; `cl:plate-moto-3l2d` «PAG 12»; `cl:plate-moto-3l2d` «SRL 12»; `cl:plate-moto-3l2d` «DFL 25»; `cl:plate-moto-3l2d` «PAG 45».

Con «completo»: entidades P que no se tapan enteras (corpus normal): «BC.DF.12» (cl:plate-4l2d, BC.DF.12; nada).

### UY

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 95 | 95 | 100.0 % | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 0/14 | +0 | +0 |
| núcleo + `uy:ci-guion` | 99 | 99 | 100.0 % | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 0/10 | +4 | +0 |
| núcleo + `uy:ci-sindv` | 103 | 103 | 100.0 % | 0 | 0 | 14 | 0 | 0 | 0 | 4 | 0/6 | +8 | +10 |
| núcleo + `uy:phone-landline-pegado` | 97 | 97 | 100.0 % | 0 | 0 | 6 | 0 | 0 | 0 | 4 | 0/12 | +2 | +2 |
| núcleo con `uy:ci-guion-sc` en lugar de `uy:ci-guion` | 99 | 99 | 100.0 % | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 0/10 | +4 | +0 |
| núcleo con `uy:ci-sindv-ctx` en lugar de `uy:ci-sindv` | 103 | 101 | 98.1 % | 0 | 2 | 4 | 0 | 0 | 0 | 4 | 0/6 | +6 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 109 | 109 | 100.0 % | 0 | 0 | 16 | 0 | 0 | 0 | 4 | 0/0 | +14 | +12 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Techera, Martín» sobre «Rodríguez Techera, Martín» (universal); `address-keyword-ar` «Ruta 8» sobre «Ruta 8 km 17» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): `uy:ci-sindv` «1.234.567»; `uy:plate-moto` «ART 123»; `uy:plate-moto` «DEC 500»; `uy:plate` «RES 1234»; `uy:phone-landline-pegado` «20250123»; `uy:ci-sindv` «125.000»; `uy:ci-sindv` «2.345.678»; `uy:ci-sindv` «1.050.000»; `uy:ci-sindv` «2.500.000».

Con «completo»: entidades P que no se tapan enteras (corpus normal): ninguna.

### PY

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 81 | 79 | 97.5 % | 0 | 2 | 29 | 0 | 0 | 0 | 2 | 0/12 | +0 | +0 |
| núcleo + `py:ci-ctx` | 93 | 91 | 97.8 % | 0 | 2 | 35 | 0 | 0 | 0 | 2 | 0/0 | +12 | +6 |
| núcleo con `py:phone-landline-estricto` en lugar de `py:phone-landline` | 81 | 79 | 97.5 % | 0 | 2 | 29 | 0 | 0 | 0 | 2 | 0/12 | +0 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 93 | 91 | 97.8 % | 0 | 2 | 35 | 0 | 0 | 0 | 2 | 0/0 | +12 | +6 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Ortiz, Carlos» sobre «Villalba Ortiz, Carlos» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): `py:ci` «2.500.000»; `py:ci` «1.234.567»; `py:plate-mercosur` «LOTE 123»; `py:ci-ctx` «12345»; `py:plate-3l3d` «USD 100»; `py:ci` «345.678»; `py:plate-3l3d` «ART 123»; `py:plate-mercosur` «FOJA 123»; `py:ci` «150.000»; `py:ci` «450.000»; `py:ci-ctx` «12345678»; `py:plate-moto-3d3l` «100 KMS»; `py:plate-mercosur` «ZONA 123»; `py:ci` «5.000.000»; `py:ci` «100.000»; `py:plate-3l3d` «DEC 500»; `py:ci-ctx` «54321».

Con «completo»: entidades P que no se tapan enteras (corpus normal): «981 123 456» (py:phone-mobile, sin 0; nada).

### BO

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 69 | 69 | 100.0 % | 0 | 0 | 8 | 0 | 0 | 0 | 2 | 0/27 | +0 | +0 |
| núcleo + `bo:ci-ctx` | 75 | 75 | 100.0 % | 0 | 0 | 12 | 0 | 0 | 0 | 2 | 0/21 | +6 | +4 |
| núcleo + `bo:nit-ctx` | 85 | 75 | 88.2 % | 0 | 10 | 8 | 0 | 0 | 0 | 2 | 0/11 | +6 | +0 |
| núcleo + `bo:phone-mobile-pegado` | 73 | 73 | 100.0 % | 0 | 0 | 11 | 0 | 0 | 0 | 2 | 0/23 | +4 | +3 |
| núcleo + `bo:phone-landline-pegado` | 70 | 70 | 100.0 % | 0 | 0 | 8 | 0 | 0 | 0 | 2 | 0/26 | +1 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 96 | 86 | 89.6 % | 0 | 10 | 15 | 0 | 0 | 0 | 2 | 0/0 | +17 | +7 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Vargas, Pedro» sobre «Choque Vargas, Pedro» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): `bo:ci-ctx` «123456»; `bo:plate` «100 USD»; `bo:plate` «2024 UFV»; `bo:phone-mobile-pegado` «71234567»; `bo:plate` «100 KMS».

Con «completo»: entidades P que no se tapan enteras (corpus normal): «1023456789» (bo:nit-ctx, NIT + palabras + número; nada); «1234567010» (bo:nit-ctx, NIT + palabras + número; nada); «1020304050» (bo:nit-ctx, NIT + palabras + número; nada); «4012345679» (bo:nit-ctx, segundo NIT de una lista; nada); «1023456780» (bo:nit-ctx, NIT + palabras + número; nada); «987654321012» (bo:nit-ctx, NIT 12 dígitos + palabras; nada).

### AR

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 54 | 54 | 100.0 % | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0/20 | +0 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 54 | 54 | 100.0 % | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0/20 | +0 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): ninguno.

Con «completo»: falsos positivos (corpus normal, sin repetir): `ar:passport` «NRO 123456»; `ar:passport` «REF 654321»; `ar:passport` «EXP 123456»; `ar:passport` «NRO 654321».

Con «completo»: entidades P que no se tapan enteras (corpus normal): ninguna.

## 5. Choques

### 5.1 El catálogo argentino vigente (AR activo) sobre cada corpus

Se corren los quince patrones de `DEFAULT_PATTERNS_AR` (`BASE_CATALOG` del motor) tal como están, con su checksum, la guarda de corrida y el match más largo. Lo que importa: qué tapa AR de los datos del país (y si lo tapa entero), y qué tapa de más.

#### AR activo sobre el corpus de CL

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `cl:phone-landline` | 9 | 0 | 0 | 4 | 5 | dni-ar: 4 |
| `cl:phone-mobile` | 11 | 0 | 0 | 2 | 9 | dni-ar: 2 |
| `cl:phone-mobile-parentesis` | 1 | 0 | 0 | 0 | 1 |  |
| `cl:phone-mobile-pelado` | 3 | 0 | 0 | 0 | 3 |  |
| `cl:plate-2l4d` | 8 | 0 | 0 | 0 | 8 |  |
| `cl:plate-4l2d` | 11 | 0 | 0 | 0 | 11 |  |
| `cl:plate-moto-2l3d` | 6 | 0 | 0 | 0 | 6 |  |
| `cl:plate-moto-3l2d` | 6 | 0 | 0 | 0 | 6 |  |
| `cl:rut` | 34 | 0 | 24 | 0 | 10 | dni-ar: 24 |
| `cl:rut-ctx` | 3 | 0 | 3 | 0 | 0 | dni-ar: 3 |
| `cl:rut-singuion` | 4 | 1 | 2 | 0 | 1 | dni-ar: 3 |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `cuit-ar` | 2 | 0 | 0 | 0 | 2 | 0 |
| `date-ar` | 13 | 13 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `dni-ar` | 59 | 1 | 29 | 6 | 23 | 0 |
| `phone-mobile-ar` | 1 | 0 | 0 | 0 | 1 | 0 |
| `plate-vieja-ar` | 1 | 0 | 0 | 0 | 1 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 38; se listan 14):

- `dni-ar` emite «14.253.687» → partial; verdad «14.253.687-0» (cl:rut).
- `dni-ar` emite «7500000» → fp-neg; sin verdad.
- `dni-ar` emite «1.250.000» → fp-neg; sin verdad.
- `caratula-ar` emite «Núñez, Camila» → partial; verdad «Barría Núñez, Camila» (universal).
- `dni-ar` emite «7.654.321» → partial; verdad «7.654.321-6» (cl:rut).
- `dni-ar` emite «76.123.456» → partial; verdad «76.123.456-0» (cl:rut).
- `dni-ar` emite «12.345.678» → fp-neg; sin verdad.
- `dni-ar` emite «00012345» → fp-neg; sin verdad.
- `dni-ar` emite «87654321» → other; verdad «+569 87654321» (cl:phone-mobile).
- `cuit-ar` emite «2400123456-7» → fp-neg; sin verdad.
- `dni-ar` emite «4521879» → fp-neg; sin verdad.
- `dni-ar` emite «13.579.246» → partial; verdad «13.579.246-2» (cl:rut).
- `dni-ar` emite «12345678» → fp-neg; sin verdad.
- `dni-ar` emite «7654321» → fp-neg; sin verdad.

#### AR activo sobre el corpus de UY

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `uy:account-brou` | 7 | 0 | 0 | 7 | 0 | phone-landline-ar: 7 |
| `uy:ci` | 19 | 0 | 17 | 0 | 2 | dni-ar: 17 |
| `uy:ci-digitos` | 9 | 9 | 0 | 0 | 0 | dni-ar: 9 |
| `uy:ci-guion` | 4 | 0 | 4 | 0 | 0 | dni-ar: 4 |
| `uy:ci-sindv` | 8 | 8 | 0 | 0 | 0 | dni-ar: 8 |
| `uy:phone-landline` | 10 | 0 | 0 | 0 | 10 |  |
| `uy:phone-landline-pegado` | 2 | 0 | 0 | 2 | 0 | dni-ar: 2 |
| `uy:phone-mobile` | 14 | 4 | 0 | 0 | 10 | phone-landline-ar: 4 |
| `uy:plate` | 13 | 0 | 0 | 0 | 13 |  |
| `uy:plate-moto` | 6 | 6 | 0 | 0 | 0 | plate-vieja-ar: 6 |
| `uy:rut` | 9 | 0 | 0 | 0 | 9 |  |
| `uy:rut-separado` | 8 | 0 | 0 | 0 | 8 |  |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 12 | 10 | 2 | 0 | 0 | 0 |
| `caratula-ar` | 3 | 1 | 2 | 0 | 0 | 0 |
| `date-ar` | 10 | 10 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 9 | 9 | 0 | 0 | 0 | 0 |
| `dni-ar` | 63 | 17 | 21 | 2 | 23 | 0 |
| `phone-landline-ar` | 11 | 4 | 0 | 7 | 0 | 0 |
| `plate-vieja-ar` | 9 | 6 | 0 | 0 | 3 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 30; se listan 14):

- `dni-ar` emite «1.234.567» → partial; verdad «1.234.567-2» (uy:ci).
- `dni-ar` emite «3.456.789» → partial; verdad «3.456.789-4» (uy:ci).
- `dni-ar` emite «1.234.567» → fp-neg; sin verdad.
- `dni-ar` emite «98765432» → fp-neg; sin verdad.
- `caratula-ar` emite «Techera, Martín» → partial; verdad «Rodríguez Techera, Martín» (universal).
- `dni-ar` emite «5.123.456» → partial; verdad «5.123.456-1» (uy:ci).
- `dni-ar` emite «2.345.678» → partial; verdad «2.345.678-3» (uy:ci).
- `address-keyword-ar` emite «Ruta 8» → partial; verdad «Ruta 8 km 17» (universal).
- `dni-ar` emite «4.567.890» → partial; verdad «4.567.890-8» (uy:ci).
- `plate-vieja-ar` emite «ART 123» → fp-neg; sin verdad.
- `dni-ar` emite «1234567» → fp-neg; sin verdad.
- `dni-ar` emite «12345678» → fp-neg; sin verdad.
- `dni-ar` emite «7654321» → fp-neg; sin verdad.
- `phone-landline-ar` emite «000123456» → other; verdad «000123456-00001» (uy:account-brou).

#### AR activo sobre el corpus de PY

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `py:ci` | 17 | 15 | 0 | 0 | 2 | dni-ar: 15 |
| `py:ci-ctx` | 12 | 10 | 0 | 0 | 2 | dni-ar: 10 |
| `py:phone-landline` | 8 | 4 | 0 | 0 | 4 | phone-mobile-ar: 4 |
| `py:phone-mobile` | 14 | 1 | 0 | 0 | 13 | phone-mobile-ar: 1 |
| `py:plate-3l3d` | 4 | 4 | 0 | 0 | 0 | plate-vieja-ar: 4 |
| `py:plate-mercosur` | 9 | 0 | 0 | 0 | 9 |  |
| `py:plate-moto-3d3l` | 4 | 0 | 0 | 0 | 4 |  |
| `py:plate-moto-mercosur` | 4 | 0 | 0 | 0 | 4 |  |
| `py:ruc` | 21 | 0 | 0 | 20 | 1 | dni-ar: 20 |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 8 | 8 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `date-ar` | 9 | 9 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 7 | 7 | 0 | 0 | 0 | 0 |
| `dni-ar` | 62 | 25 | 0 | 20 | 17 | 0 |
| `phone-mobile-ar` | 8 | 5 | 0 | 0 | 3 | 0 |
| `plate-vieja-ar` | 14 | 4 | 0 | 0 | 10 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 24; se listan 14):

- `dni-ar` emite «2.500.000» → fp-neg; sin verdad.
- `dni-ar` emite «1.234.567» → fp-neg; sin verdad.
- `dni-ar` emite «80012345» → other; verdad «80012345-0» (py:ruc).
- `dni-ar` emite «1234567» → other; verdad «1234567-9» (py:ruc).
- `plate-vieja-ar` emite «USD 100» → fp-neg; sin verdad.
- `caratula-ar` emite «Ortiz, Carlos» → partial; verdad «Villalba Ortiz, Carlos» (universal).
- `dni-ar` emite «80099900» → other; verdad «80099900-2» (py:ruc).
- `dni-ar` emite «12.345.678» → fp-neg; sin verdad.
- `phone-mobile-ar` emite «001-0001234» → fp-neg; sin verdad.
- `plate-vieja-ar` emite «ART 123» → fp-neg; sin verdad.
- `phone-mobile-ar` emite «002-0004567» → fp-neg; sin verdad.
- `dni-ar` emite «12345678» → fp-neg; sin verdad.
- `dni-ar` emite «80000519» → other; verdad «80000519-8» (py:ruc).
- `dni-ar` emite «1.234.567» → other; verdad «1.234.567-9» (py:ruc).

#### AR activo sobre el corpus de BO

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `bo:ci-ctx` | 6 | 5 | 0 | 0 | 1 | dni-ar: 5 |
| `bo:ci-ext` | 31 | 0 | 27 | 0 | 4 | dni-ar: 27 |
| `bo:nit-ctx` | 16 | 0 | 0 | 13 | 3 | phone-mobile-ar: 13 |
| `bo:phone-landline` | 8 | 0 | 0 | 6 | 2 | dni-ar: 6 |
| `bo:phone-landline-pegado` | 1 | 0 | 0 | 1 | 0 | dni-ar: 1 |
| `bo:phone-mobile` | 13 | 0 | 0 | 2 | 11 | dni-ar: 2 |
| `bo:phone-mobile-pegado` | 4 | 0 | 0 | 4 | 0 | dni-ar: 4 |
| `bo:plate` | 17 | 0 | 0 | 0 | 17 |  |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 10 | 10 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `date-ar` | 9 | 9 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 7 | 7 | 0 | 0 | 0 | 0 |
| `dni-ar` | 56 | 5 | 27 | 13 | 11 | 0 |
| `phone-mobile-ar` | 14 | 0 | 0 | 13 | 1 | 0 |
| `plate-vieja-ar` | 6 | 0 | 0 | 0 | 6 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 36; se listan 14):

- `dni-ar` emite «1234567» → partial; verdad «1234567 LP» (bo:ci-ext).
- `dni-ar` emite «7654321» → partial; verdad «7654321 SC» (bo:ci-ext).
- `dni-ar` emite «1.234.567» → fp-neg; sin verdad.
- `phone-mobile-ar` emite «1023456789» → other; verdad «1023456789» (bo:nit-ctx).
- `dni-ar` emite «71234567» → fp-neg; sin verdad.
- `caratula-ar` emite «Vargas, Pedro» → partial; verdad «Choque Vargas, Pedro» (universal).
- `dni-ar` emite «1234567» → partial; verdad «1234567 SC» (bo:ci-ext).
- `phone-mobile-ar` emite «4012345678» → other; verdad «4012345678» (bo:nit-ctx).
- `dni-ar` emite «2345678» → partial; verdad «2345678 PT» (bo:ci-ext).
- `dni-ar` emite «3456789» → partial; verdad «3456789 CH» (bo:ci-ext).
- `dni-ar` emite «4567890» → partial; verdad «4567890 TJ» (bo:ci-ext).
- `dni-ar` emite «5678901» → partial; verdad «5678901 BN» (bo:ci-ext).
- `dni-ar` emite «6789012» → partial; verdad «6789012 PD» (bo:ci-ext).
- `plate-vieja-ar` emite «ART 123» → fp-neg; sin verdad.

#### AR activo sobre el corpus de AR

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `ar:cbu` | 33 | 0 | 0 | 16 | 17 | dni-ar: 8; phone-landline-ar: 8 |
| `ar:cuit-ar` | 7 | 7 | 0 | 0 | 0 | cuit-ar: 7 |
| `ar:dni-ar` | 5 | 5 | 0 | 0 | 0 | dni-ar: 5 |
| `ar:passport` | 21 | 0 | 0 | 0 | 21 |  |
| `ar:phone-landline-ar` | 2 | 2 | 0 | 0 | 0 | phone-landline-ar: 2 |
| `ar:phone-mobile-ar` | 2 | 2 | 0 | 0 | 0 | phone-mobile-ar: 2 |
| `ar:plate-mercosur-ar` | 2 | 2 | 0 | 0 | 0 | plate-mercosur-ar: 2 |
| `ar:plate-vieja-ar` | 2 | 2 | 0 | 0 | 0 | plate-vieja-ar: 2 |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 1 | 1 | 0 | 0 | 0 | 0 |
| `credit-card` | 2 | 2 | 0 | 0 | 0 | 0 |
| `cuit-ar` | 7 | 7 | 0 | 0 | 0 | 0 |
| `date-ar` | 2 | 2 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 3 | 3 | 0 | 0 | 0 | 0 |
| `dni-ar` | 15 | 5 | 0 | 8 | 2 | 0 |
| `phone-landline-ar` | 11 | 2 | 0 | 8 | 1 | 0 |
| `phone-mobile-ar` | 2 | 2 | 0 | 0 | 0 | 0 |
| `plate-mercosur-ar` | 2 | 2 | 0 | 0 | 0 | 0 |
| `plate-vieja-ar` | 2 | 2 | 0 | 0 | 0 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 10; se listan 10):

- `dni-ar` emite «01400021» → other; verdad «01400021 12345678901233» (ar:cbu).
- `dni-ar` emite «28500010» → other; verdad «28500010-13579246801350» (ar:cbu).
- `dni-ar` emite «02701055» → other; verdad «02701055 50000098765431» (ar:cbu).
- `phone-landline-ar` emite «0720 0014 4000» → other; verdad «0720 0014 4000 0012 3456 72» (ar:cbu).
- `phone-landline-ar` emite «0110 3005 9876» → other; verdad «0110 3005 9876 5432 1098 77» (ar:cbu).
- `phone-landline-ar` emite «0010 1357 9246» → other; verdad «2850 0010 1357 9246 8013 50» (ar:cbu).
- `dni-ar` emite «00004514» → other; verdad «00004514 00000246813578» (ar:cbu).
- `phone-landline-ar` emite «0000 0727 0000» → other; verdad «0000 0727 0000 0112 2334 42» (ar:cbu).
- `dni-ar` emite «20250123» → fp-neg; sin verdad.
- `phone-landline-ar` emite «0001-00001234» → fp-neg; sin verdad.

### 5.2 Las formas nuevas sobre textos argentinos de las fixtures del repo

Textos usados (todos sintéticos, ya en el repo): el **dataset de referencia** de `tests/fixtures/generate.ts` (`buildReferenceDocSpecs()`: 26 documentos, 33 páginas, con sus entidades anotadas: DNI, CUIT, teléfono, email, patente, matrícula, persona, dirección) y las 10 páginas de `TEXT_10P_PAGES` (sin anotar: todo match es un hallazgo a mirar). Total: 43 páginas, 7235 caracteres.

Cada forma corrida sola sobre esos textos (se excluyen las alternativas, que repiten a otra forma):

| Forma | Rol | Matches | Solapan una verdad AR | En texto sin verdad |
|---|---|---|---|---|
| `cl:rut` | núcleo | 1 | 1 | 0 |
| `cl:rut-singuion` | opcional | 1 | 0 | 0 |
| `cl:rut-ctx` | opcional | 0 | 0 | 0 |
| `cl:phone-mobile` | núcleo | 0 | 0 | 0 |
| `cl:phone-mobile-parentesis` | opcional | 0 | 0 | 0 |
| `cl:phone-mobile-pelado` | opcional | 0 | 0 | 0 |
| `cl:phone-landline` | núcleo | 0 | 0 | 0 |
| `cl:plate-4l2d` | núcleo | 0 | 0 | 0 |
| `cl:plate-2l4d` | núcleo | 1 | 0 | 1 |
| `cl:plate-moto-3l2d` | núcleo | 10 | 6 | 4 |
| `cl:plate-moto-2l3d` | núcleo | 4 | 4 | 0 |
| `uy:ci` | núcleo | 0 | 0 | 0 |
| `uy:ci-digitos` | núcleo | 0 | 0 | 0 |
| `uy:ci-guion` | opcional | 0 | 0 | 0 |
| `uy:ci-sindv` | opcional | 10 | 7 | 3 |
| `uy:rut` | núcleo | 0 | 0 | 0 |
| `uy:rut-separado` | núcleo | 0 | 0 | 0 |
| `uy:phone-mobile` | núcleo | 0 | 0 | 0 |
| `uy:phone-landline` | núcleo | 8 | 6 | 2 |
| `uy:phone-landline-pegado` | opcional | 2 | 2 | 0 |
| `uy:plate` | núcleo | 0 | 0 | 0 |
| `uy:plate-moto` | núcleo | 2 | 0 | 0 |
| `uy:account-brou` | núcleo | 0 | 0 | 0 |
| `py:ci` | núcleo | 10 | 7 | 3 |
| `py:ci-ctx` | opcional | 0 | 0 | 0 |
| `py:ruc` | núcleo | 2 | 0 | 2 |
| `py:phone-mobile` | núcleo | 0 | 0 | 0 |
| `py:phone-landline` | núcleo | 4 | 4 | 0 |
| `py:plate-3l3d` | núcleo | 2 | 0 | 0 |
| `py:plate-moto-3d3l` | núcleo | 1 | 1 | 0 |
| `py:plate-mercosur` | núcleo | 0 | 0 | 0 |
| `py:plate-moto-mercosur` | núcleo | 0 | 0 | 0 |
| `bo:ci-ext` | núcleo | 0 | 0 | 0 |
| `bo:ci-ctx` | opcional | 0 | 0 | 0 |
| `bo:nit-ctx` | opcional | 0 | 0 | 0 |
| `bo:phone-mobile` | núcleo | 3 | 3 | 0 |
| `bo:phone-mobile-pegado` | opcional | 0 | 0 | 0 |
| `bo:phone-landline` | núcleo | 0 | 0 | 0 |
| `bo:phone-landline-pegado` | opcional | 2 | 2 | 0 |
| `bo:plate` | núcleo | 1 | 1 | 0 |
| `ar:cbu` | núcleo | 0 | 0 | 0 |
| `ar:passport` | núcleo | 0 | 0 | 0 |

Muestras (hasta 3 por forma):

- `cl:rut` emite «09082125-3» en `doc-005-p0`: solapa «23-09082125-3» (CUIT).
- `cl:rut-singuion` emite «18445212» en `doc-025-p0`: solapa «18445212» (DNI).
- `cl:plate-2l4d` emite «PP-13-00» en `doc-013-p0`: sin verdad.
- `cl:plate-moto-3l2d` emite «DNI 46» en `doc-001-p0`: solapa «46.578.630» (DNI).
- `cl:plate-moto-3l2d` emite «DNI 99» en `doc-002-p0`: solapa «99.548.702» (DNI).
- `cl:plate-moto-3l2d` emite «DNI 15» en `doc-004-p0`: solapa «15.445.309» (DNI).
- `cl:plate-moto-2l3d` emite «DA 004» en `doc-003-p1`: solapa «DA 004 DD» (PLATE).
- `cl:plate-moto-2l3d` emite «VH 765» en `doc-005-p1`: solapa «VH 765 FC» (PLATE).
- `cl:plate-moto-2l3d` emite «AB 123» en `doc-023-p0`: solapa «AB 123 CD» (PLATE).
- `uy:ci-sindv` emite «578.630» en `doc-001-p0`: solapa «46.578.630» (DNI).
- `uy:ci-sindv` emite «548.702» en `doc-002-p0`: solapa «99.548.702» (DNI).
- `uy:ci-sindv` emite «445.309» en `doc-004-p0`: solapa «15.445.309» (DNI).
- `uy:phone-landline` emite «2637-6255» en `doc-005-p0`: solapa «+54 11 2637-6255» (PHONE).
- `uy:phone-landline` emite «4454-3477» en `doc-009-p0`: solapa «+54 11 4454-3477» (PHONE).
- `uy:phone-landline` emite «4532 1234» en `doc-017-p0`: sin verdad.
- `uy:phone-landline-pegado` emite «26139703» en `doc-001-p1`: solapa «20-26139703-0» (CUIT).
- `uy:phone-landline-pegado` emite «49009444» en `doc-004-p0`: solapa «20-49009444-0» (CUIT).
- `uy:plate-moto` emite «ABC 123» en `doc-023-p0`: solapa «ABC 123» (PLATE).
- `uy:plate-moto` emite «ABC-123» en `doc-023-p0`: solapa «ABC-123» (PLATE).
- `py:ci` emite «578.630» en `doc-001-p0`: solapa «46.578.630» (DNI).
- `py:ci` emite «548.702» en `doc-002-p0`: solapa «99.548.702» (DNI).
- `py:ci` emite «445.309» en `doc-004-p0`: solapa «15.445.309» (DNI).
- `py:ruc` emite «12345678-9» en `doc-016-p0`: sin verdad.
- `py:phone-landline` emite «26139703» en `doc-001-p1`: solapa «20-26139703-0» (CUIT).
- `py:phone-landline` emite «49009444» en `doc-004-p0`: solapa «20-49009444-0» (CUIT).
- `py:phone-landline` emite «54 221 456» en `doc-021-p0`: solapa «+54 221 456-7890» (PHONE).
- `py:plate-3l3d` emite «ABC 123» en `doc-023-p0`: solapa «ABC 123» (PLATE).
- `py:plate-3l3d` emite «ABC-123» en `doc-023-p0`: solapa «ABC-123» (PLATE).
- `py:plate-moto-3d3l` emite «123 BCD» en `doc-023-p0`: solapa «A 123 BCD» (PLATE).
- `bo:phone-mobile` emite «7210-3598» en `doc-001-p1`: solapa «+54 11 7210-3598» (PHONE).
- `bo:phone-mobile` emite «7068 9876» en `doc-022-p0`: solapa «ES05 7068 9876 9644 6251 9569» (IBAN).
- `bo:phone-mobile` emite «6251 9569» en `doc-022-p0`: solapa «ES05 7068 9876 9644 6251 9569» (IBAN).
- `bo:phone-landline-pegado` emite «26139703» en `doc-001-p1`: solapa «20-26139703-0» (CUIT).
- `bo:phone-landline-pegado` emite «49009444» en `doc-004-p0`: solapa «20-49009444-0» (CUIT).
- `bo:plate` emite «123 BCD» en `doc-023-p0`: solapa «A 123 BCD» (PLATE).

Todas las formas nuevas juntas (42 formas, con prioridad del match más largo): 47 matches; 32 solapan una verdad argentina; 12 caen en texto sin verdad.

### 5.3 Las formas nuevas de AR (CBU/CVU y pasaporte) junto al catálogo argentino

Con AR activo, las formas nuevas se suman al catálogo. Recall de cada forma sola y con el catálogo argentino al lado (prioridad del match más largo, caso 10):

| Forma | Esperadas | Exactas (sola) | Exactas (con catálogo AR) | Parcial | Otro tipo | Perdidas |
|---|---|---|---|---|---|---|
| `ar:cbu` | 33 | 33 (100.0 %) | 33 (100.0 %) | 0 | 0 | 0 |
| `ar:passport` | 21 | 21 (100.0 %) | 21 (100.0 %) | 0 | 0 | 0 |

Matches (de todo el conjunto AR + nuevas, corpus normal, sin repetir) que no aciertan una verdad: 6.

- `dni-ar` emite «20250123» en `ar-01-transferencia` → fp-neg.
- `ar:passport` emite «NRO 123456» en `ar-02-viaje` → fp-neg.
- `ar:passport` emite «REF 654321» en `ar-02-viaje` → fp-neg.
- `ar:passport` emite «EXP 123456» en `ar-02-viaje` → fp-neg.
- `ar:passport` emite «NRO 654321» en `ar-03-contrato` → fp-neg.
- `phone-landline-ar` emite «0001-00001234» en `ar-03-contrato` → fp-neg.

## 6. Universales sobre cada corpus

Solo los universales de hoy (fecha, fecha en texto, dirección con palabra clave, carátula; más email, IBAN y tarjeta, que corren siempre), sin ningún formato de país. La verdad U son fechas, direcciones y carátulas que anoté en los corpus. **Es un hallazgo, no un ajuste:** ADR-236 §4 pide informar, no corregir en silencio.

### CL

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avda | 1 | 1 | 0 | 0 |
| ADDRESS / avenida | 5 | 5 | 0 | 0 |
| ADDRESS / calle | 2 | 2 | 0 | 0 |
| ADDRESS / camino | 2 | 0 | 0 | 2 |
| ADDRESS / pasaje | 2 | 2 | 0 | 0 |
| ADDRESS / psje | 1 | 1 | 0 | 0 |
| DATE / abreviada | 1 | 0 | 0 | 1 |
| DATE / numerica | 12 | 12 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / numerica-punto | 3 | 0 | 0 | 3 |
| DATE / texto | 9 | 9 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Barría Núñez, Camila» (normal): se detecta «Núñez, Camila» (`caratula-ar`), no el tramo entero.
- DATE / numerica-punto «17.05.2025» (normal): no se detecta.
- DATE / abreviada «17-may-2025» (normal): no se detecta.
- ADDRESS / camino «Camino a Melipilla Km 12» (normal): no se detecta.
- DATE / numerica-punto «01.03.2020» (normal): no se detecta.

Total U: 43; exactas 35 (81.4 %); parcial u otro tipo 2; perdidas 6. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### UY

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avenida | 4 | 4 | 0 | 0 |
| ADDRESS / bv | 3 | 3 | 0 | 0 |
| ADDRESS / calle | 3 | 3 | 0 | 0 |
| ADDRESS / ruta | 2 | 0 | 2 | 0 |
| DATE / numerica | 9 | 9 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / texto | 7 | 7 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / apellido-simple | 2 | 1 | 0 | 1 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Rodríguez Techera, Martín» (normal): se detecta «Techera, Martín» (`caratula-ar`), no el tramo entero.
- ADDRESS / ruta «Ruta 8 km 17» (normal): se detecta «Ruta 8» (`address-keyword-ar`), no el tramo entero.
- PERSON / apellido-simple «GÓMEZ, MARTA» (mayus): no se detecta.

Total U: 35; exactas 30 (85.7 %); parcial u otro tipo 4; perdidas 1. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### PY

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avda | 4 | 4 | 0 | 0 |
| ADDRESS / calle | 4 | 4 | 0 | 0 |
| ADDRESS / esquina | 1 | 0 | 0 | 1 |
| ADDRESS / ruta | 1 | 0 | 0 | 1 |
| DATE / numerica | 8 | 8 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / numerica-punto | 2 | 0 | 0 | 2 |
| DATE / texto | 5 | 5 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Villalba Ortiz, Carlos» (normal): se detecta «Ortiz, Carlos» (`caratula-ar`), no el tramo entero.
- ADDRESS / esquina «Mcal. López c/ Brasil 1234» (normal): no se detecta.
- ADDRESS / ruta «Ruta 2 km 14» (normal): no se detecta.
- DATE / numerica-punto «01.03.2020» (normal): no se detecta.

Total U: 30; exactas 24 (80.0 %); parcial u otro tipo 2; perdidas 4. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### BO

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avenida | 5 | 5 | 0 | 0 |
| ADDRESS / calle | 5 | 5 | 0 | 0 |
| DATE / numerica | 8 | 8 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / texto | 5 | 5 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Choque Vargas, Pedro» (normal): se detecta «Vargas, Pedro» (`caratula-ar`), no el tramo entero.

Total U: 28; exactas 26 (92.9 %); parcial u otro tipo 2; perdidas 0. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### AR

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avenida | 1 | 1 | 0 | 0 |
| CREDIT_CARD / tarjeta | 2 | 2 | 0 | 0 |
| DATE / numerica | 2 | 2 | 0 | 0 |
| DATE / texto | 3 | 3 | 0 | 0 |

Todo lo anotado se detecta entero.

Total U: 8; exactas 8 (100.0 %); parcial u otro tipo 0; perdidas 0. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### Todos los países juntos, por tipo y escritura

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avda | 5 | 5 | 0 | 0 |
| ADDRESS / avenida | 15 | 15 | 0 | 0 |
| ADDRESS / bv | 3 | 3 | 0 | 0 |
| ADDRESS / calle | 14 | 14 | 0 | 0 |
| ADDRESS / camino | 2 | 0 | 0 | 2 |
| ADDRESS / esquina | 1 | 0 | 0 | 1 |
| ADDRESS / pasaje | 2 | 2 | 0 | 0 |
| ADDRESS / psje | 1 | 1 | 0 | 0 |
| ADDRESS / ruta | 3 | 0 | 2 | 1 |
| CREDIT_CARD / tarjeta | 2 | 2 | 0 | 0 |
| DATE / abreviada | 1 | 0 | 0 | 1 |
| DATE / numerica | 39 | 39 | 0 | 0 |
| DATE / numerica-guion | 4 | 4 | 0 | 0 |
| DATE / numerica-punto | 5 | 0 | 0 | 5 |
| DATE / texto | 29 | 29 | 0 | 0 |
| DATE / texto-ordinal | 8 | 8 | 0 | 0 |
| PERSON / apellido-simple | 2 | 1 | 0 | 1 |
| PERSON / dos-apellidos | 8 | 0 | 8 | 0 |

## 7. Agrupación: qué junta y qué separa el normalizador

Con la combinación «completo» de cada país, sobre las entidades que acertó (exactas), se compara la identidad real (`key`, la persona o la cosa) con el `normalizedValue` que emitió la forma. *Separa* = una misma identidad con más de un valor normalizado (queda en dos grupos). *Junta* = un mismo valor normalizado para identidades distintas (queda en un solo grupo).

### CL

Identidades con una entidad acertada: 40. **Separa**: 1. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `rut:14253687` → `14253687-0`, `14253687-1`

### UY

Identidades con una entidad acertada: 34. **Separa**: 5. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `ci:3456789` → `34567894`, `3456789`
- `ci:5123456` → `51234561`, `5123456`
- `ci:2345678` → `23456783`, `2345678`
- `ci:4567890` → `45678908`, `45678905`, `4567890`
- `ci:6789012` → `6789012`, `67890127`

### PY

Identidades con una entidad acertada: 35. **Separa**: 0. **Junta**: 0.

### BO

Identidades con una entidad acertada: 31. **Separa**: 5. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `ci:1234567-LP` → `1234567/LP`, `1234567`
- `ci:7654321-SC` → `7654321/SC`, `7654321-1A`
- `ci:2345678-PT` → `2345678/PT`, `2345678`
- `ci:3456789-CH` → `3456789/CH`, `3456789`
- `ci:4567890-TJ` → `4567890/TJ`, `4567890`

**D-7 (la CI de BO se repite entre personas).** Mismo corpus con un normalizador alternativo que **solo conserva el número** (sin complemento ni extensión). Se compara contra la identidad real número + extensión:

Con el normalizador del Plan §5 (número + complemento + extensión) las personas que comparten número **no se juntan** (junta = 0). Con el alternativo que solo guarda el número, **se juntan 3 números** que son de personas distintas: `1234567` ← `ci:1234567-LP`, `ci:1234567-SC`, `ci:1234567-CB`; `7654321` ← `ci:7654321-SC`, `ci:7654321-LP`; `3456789` ← `ci:3456789-CH`, `ci:3456789-CB`.

### AR

Identidades con una entidad acertada: 21. **Separa**: 0. **Junta**: 0.

## 8. Falsos positivos de cada forma, con su texto

Cada match de una forma corrida sola que cae sobre un negativo o sobre texto sin verdad. Es lo que el mantenedor mira para decidir.

### CL

- `cl:phone-mobile-pelado` (opcional): 3 FP — «987654321» (negativo) ×3
- `cl:plate-4l2d-lax` (opcional): 4 FP — «LOTE 12» (negativo); «ZONA 12» (negativo); «CAJA 15» (negativo); «TOMO 45» (negativo)
- `cl:plate-moto-3l2d` (núcleo): 13 FP — «LEY 18» (negativo) ×2; «ART 15» (negativo) ×2; «IVA 19» (texto); «IVA 19» (negativo); «UTM 60» (negativo); «DEC 30» (negativo); «PAG 12» (negativo); «SRL 12» (negativo) ×2; «DFL 25» (negativo); «PAG 45» (negativo)
- `cl:plate-moto-2l3d` (núcleo): 1 FP — «EN 100» (negativo)

### UY

- `uy:ci-sindv` (opcional): 10 FP — «1.234.567» (negativo) ×3; «125.000» (negativo) ×2; «2.345.678» (negativo) ×2; «1.050.000» (negativo); «2.500.000» (negativo) ×2
- `uy:phone-landline-pegado` (opcional): 2 FP — «20250123» (negativo) ×2
- `uy:plate` (núcleo): 1 FP — «RES 1234» (negativo)
- `uy:plate-moto` (núcleo): 3 FP — «ART 123» (negativo) ×2; «DEC 500» (negativo)

### PY

- `py:ci` (núcleo): 13 FP — «2.500.000» (negativo) ×3; «1.234.567» (negativo) ×3; «345.678» (negativo) ×2; «150.000» (negativo); «450.000» (negativo); «5.000.000» (negativo); «100.000» (negativo) ×2
- `py:ci-ctx` (opcional): 6 FP — «12345» (negativo) ×3; «12345678» (negativo); «54321» (negativo) ×2
- `py:plate-3l3d` (núcleo): 10 FP — «USD 100» (negativo) ×4; «ART 123» (negativo) ×4; «DEC 500» (negativo) ×2
- `py:plate-moto-3d3l` (núcleo): 2 FP — «123 DEL» (negativo); «100 KMS» (negativo)
- `py:plate-mercosur` (núcleo): 5 FP — «LOTE 123» (negativo) ×2; «FOJA 123» (negativo) ×2; «ZONA 123» (negativo)

### BO

- `bo:ci-ctx` (opcional): 4 FP — «123456» (negativo) ×4
- `bo:phone-mobile-pegado` (opcional): 3 FP — «71234567» (negativo) ×3
- `bo:plate` (núcleo): 8 FP — «100 USD» (negativo) ×4; «2024 UFV» (negativo) ×3; «100 KMS» (negativo)

### AR

- `ar:passport` (núcleo): 4 FP — «NRO 123456» (negativo); «REF 654321» (negativo); «EXP 123456» (negativo); «NRO 654321» (negativo)

## 8b. Ruido numérico: cuánto acierta un número cualquiera

El corpus escrito a mano tiene pocos negativos numéricos, y las formas con verificador pasan por azar un número cualquiera con una probabilidad conocida. Para medirla se generaron números **al azar** (PRNG fijo, semilla 20261122, primer dígito 1-9; 2000 de cada largo) y se pusieron en frases neutras. *Tramo entero* = el match cubre el número entero; *Cualquier match* = el match solapa el número (incluye tramos). Sirve para estimar el falso positivo de las formas **sin contexto**; los números de verdad del documento (folios, montos) no son aleatorios.

| Número al azar | Forma | Rol | N | Tramo entero | % entero | Cualquier match | % cualquier |
|---|---|---|---|---|---|---|---|
| 7 dígitos pegados, tras «Folio» | `uy:ci-digitos` | núcleo | 2000 | 227 | 11.3 % | 227 | 11.3 % |
| 8 dígitos pegados, tras «Folio» | `cl:rut-singuion` | opcional | 2000 | 162 | 8.1 % | 162 | 8.1 % |
| 8 dígitos pegados, tras «Folio» | `uy:ci-digitos` | núcleo | 2000 | 208 | 10.4 % | 208 | 10.4 % |
| 8 dígitos pegados, tras «Folio» | `uy:phone-landline-pegado` | opcional | 2000 | 441 | 22.1 % | 441 | 22.1 % |
| 8 dígitos pegados, tras «Folio» | `py:phone-landline` | núcleo | 2000 | 1583 | 79.2 % | 1583 | 79.2 % |
| 8 dígitos pegados, tras «Folio» | `bo:phone-mobile-pegado` | opcional | 2000 | 459 | 22.9 % | 459 | 22.9 % |
| 8 dígitos pegados, tras «Folio» | `bo:phone-landline-pegado` | opcional | 2000 | 689 | 34.5 % | 689 | 34.5 % |
| 9 dígitos pegados, tras «Folio» | `cl:rut-singuion` | opcional | 2000 | 178 | 8.9 % | 178 | 8.9 % |
| 9 dígitos pegados, tras «Folio» | `cl:phone-mobile-pelado` | opcional | 2000 | 237 | 11.8 % | 237 | 11.8 % |
| 9 dígitos pegados, tras «Folio» | `cl:phone-landline` | núcleo | 2000 | 722 | 36.1 % | 722 | 36.1 % |
| 9 dígitos pegados, tras «Folio» | `py:phone-landline` | núcleo | 2000 | 1566 | 78.3 % | 1566 | 78.3 % |
| 12 dígitos pegados, tras «Folio» | `py:phone-landline` | núcleo | 2000 | 1 | 0.1 % | 1 | 0.1 % |
| 22 dígitos pegados, tras «Folio» | `ar:cbu` | núcleo | 2000 | 23 | 1.1 % | 23 | 1.1 % |
| monto con puntos, 7 dígitos («$ 1.234.567») | `uy:ci-sindv` | opcional | 2000 | 2000 | 100.0 % | 2000 | 100.0 % |
| monto con puntos, 7 dígitos («$ 1.234.567») | `py:ci` | núcleo | 2000 | 2000 | 100.0 % | 2000 | 100.0 % |
| monto con puntos, 8 dígitos («$ 12.345.678») | `uy:ci-sindv` | opcional | 2000 | 0 | 0.0 % | 2000 | 100.0 % |
| monto con puntos, 8 dígitos («$ 12.345.678») | `py:ci` | núcleo | 2000 | 0 | 0.0 % | 2000 | 100.0 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 166 | 8.3 % | 166 | 8.3 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `uy:ci` | núcleo | 2000 | 0 | 0.0 % | 1842 | 92.1 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `uy:ci-sindv` | opcional | 2000 | 0 | 0.0 % | 1842 | 92.1 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `py:ci` | núcleo | 2000 | 0 | 0.0 % | 1842 | 92.1 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 185 | 9.3 % | 185 | 9.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 180 | 9.0 % | 180 | 9.0 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `uy:ci` | núcleo | 2000 | 1826 | 91.3 % | 1826 | 91.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `uy:ci-sindv` | opcional | 2000 | 0 | 0.0 % | 1826 | 91.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `py:ci` | núcleo | 2000 | 0 | 0.0 % | 1826 | 91.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 185 | 9.3 % | 185 | 9.3 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 187 | 9.3 % | 187 | 9.3 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `cl:rut-singuion` | opcional | 2000 | 0 | 0.0 % | 157 | 7.8 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `uy:ci-digitos` | núcleo | 2000 | 0 | 0.0 % | 175 | 8.8 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `uy:phone-landline-pegado` | opcional | 2000 | 0 | 0.0 % | 410 | 20.5 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 177 | 8.8 % | 177 | 8.8 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `py:phone-landline` | núcleo | 2000 | 0 | 0.0 % | 1388 | 69.4 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `bo:phone-mobile-pegado` | opcional | 2000 | 0 | 0.0 % | 421 | 21.1 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `bo:phone-landline-pegado` | opcional | 2000 | 0 | 0.0 % | 582 | 29.1 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 186 | 9.3 % | 186 | 9.3 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `uy:ci-digitos` | núcleo | 2000 | 0 | 0.0 % | 176 | 8.8 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `uy:ci-guion` | opcional | 2000 | 188 | 9.4 % | 188 | 9.4 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 186 | 9.3 % | 186 | 9.3 % |
| número de 5 a 8 dígitos tras «Nº» | `cl:rut-singuion` | opcional | 2000 | 52 | 2.6 % | 52 | 2.6 % |
| número de 5 a 8 dígitos tras «Nº» | `uy:ci-digitos` | núcleo | 2000 | 109 | 5.5 % | 109 | 5.5 % |
| número de 5 a 8 dígitos tras «Nº» | `uy:phone-landline-pegado` | opcional | 2000 | 92 | 4.6 % | 92 | 4.6 % |
| número de 5 a 8 dígitos tras «Nº» | `py:ci-ctx` | opcional | 2000 | 2000 | 100.0 % | 2000 | 100.0 % |
| número de 5 a 8 dígitos tras «Nº» | `py:phone-landline` | núcleo | 2000 | 366 | 18.3 % | 366 | 18.3 % |
| número de 5 a 8 dígitos tras «Nº» | `bo:ci-ctx` | opcional | 2000 | 1480 | 74.0 % | 1480 | 74.0 % |
| número de 5 a 8 dígitos tras «Nº» | `bo:phone-mobile-pegado` | opcional | 2000 | 100 | 5.0 % | 100 | 5.0 % |
| número de 5 a 8 dígitos tras «Nº» | `bo:phone-landline-pegado` | opcional | 2000 | 145 | 7.3 % | 145 | 7.3 % |

Las formas que no figuran no matchean ninguno de esos 2000 números.

## 9. Notas de método

- La guarda de corrida (`passesRunGuard`) y la prioridad del match más largo son las del motor: la guarda se importa de `regex-engine/src/run-guard.ts`; la resolución de solapamientos se reimplementa para formatos base (ordenar por largo descendente, inicio, orden de la lista; todo choque descarta), que es lo que hace `resolveOverlaps` cuando todos los formatos son `base`.

- El catálogo argentino se importa de `regex-engine/src/patterns/default-ar.ts` (`DEFAULT_PATTERNS_AR`) por ruta relativa, sin tocar el paquete. El email se corre con su `RegExp` (el motor usa un escáner lineal con la misma salida, ADR-181).

- Las formas con piezas se recorren con un enumerador de finales posibles (no es el autómata de Thompson del motor) con la semántica del spec: más a la izquierda y más largo, bordes de letra o dígito, contexto con `:` opcional.

- Las formas de tipo `control` con `RegExp` llevan los bordes del generador (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`), no `\b`. Con `\b` un RUT pegado a `_` se comportaría distinto; no aparece en el corpus.

- Texto de página: palabras unidas con un espacio, sin saltos de línea, como `Page.text`.
