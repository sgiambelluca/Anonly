# Segunda medición de la tanda 1 (CL, UY, PY, BO y los tipos nuevos de AR)

Campaña 1.1.1, paso 2 de `Plan_1.1.1.md` §2, repetido con las decisiones del mantenedor del 2026-11-22 (`Plan_1.1.1.md` §5, «Sobre la medición de la tanda 1» y «Las propuestas técnicas del planificador»). Prototipos fuera de los motores. **No se implementó nada en `packages/` ni en `apps/`, no se tocó `docs/` y no se commiteó.** Todo lo que se mide es **sintético**: no se usó ninguna variable `ANONLY_REAL_DOC_*` ni ningún documento real. El código vive en `tests/paises/` (sin commitear) y la primera medición, para comparar, en `docs/roadmap/mediciones/regex/Paises_Tanda1_Medicion_2026-11-22.md`.

## 1. Los doce cambios y qué pasó con cada uno

| # | Cambio del Plan §5 | Qué se hizo | Resultado |
|---|---|---|---|
| 1 | Patentes con falsos positivos y `ar:passport`, con palabra antes | `cl:plate-moto-3l2d`, `py:plate-3l3d`, `py:plate-mercosur`, `py:plate-moto-3d3l`, `bo:plate`, `uy:plate` y `uy:plate-moto` llevan «Patente, Placa, Chapa, Dominio» (UY suma «Matrícula»); `ar:passport` lleva «Pasaporte». No cambian las de 0 FP: `cl:plate-4l2d`, `cl:plate-2l4d`, `cl:plate-moto-2l3d`, `py:plate-moto-mercosur`. | Los falsos positivos del corpus anterior bajan a 0 en todas (eran 10, 6, 3, 1, 6, 1, 2 y 4). El recall cae a 0 a 33 % sobre el corpus anterior: el corpus escribe las patentes sin la palabra la mayoría de las veces. Ver §3 de esta cabecera. |
| 2 | Cédulas sin verificador solo con contexto; «Nº» fuera | `py:ci` exige contexto; `uy:ci-sindv` sale y queda `uy:ci-sindv-ctx`; «Nº», «N°» y «C.I. N°» salen de `py:ci-ctx` y `bo:ci-ctx`. | `py:ci` baja de 7 de 36 FP a 0; `py:ci-ctx` de 3 a 0; `bo:ci-ctx` de 2 a 0; `uy:ci-sindv` de 5 de 42 a 0 (`uy:ci-sindv-ctx`). Ruido: `py:ci-ctx` tras «Nº» de 100 % a 0; `bo:ci-ctx` de 74 % a 0; `py:ci` sobre montos con puntos de 100 % a 0. |
| 3 | `cl:rut-singuion` solo con RUT o RUN | **Unificada con `cl:rut-ctx`** (mismo tipo, mismo contexto «RUT, RUN, R.U.T., R.U.N.», sin verificador; solo difieren en el guion, que ahora es opcional: `\d{1,2}\.?\d{3}\.?\d{3}[\s-]?[\dkK]`). `uy:ci-digitos` no se tocó. | Una sola forma, `cl:rut-ctx`. El ruido de `cl:rut-singuion` (8,1 % y 8,9 %) desaparece. Los 4 RUT sin guion y sin la palabra RUT del corpus anterior **quedan sin tapar**, como se decidió. |
| 4 | `py:ruc`, el algoritmo manda | Se corrigieron en `lib/examples.ts` los dos ejemplos del informe que no cerraban: `80012345-7` → `80012345-0` y `2345678-0` → `2345678-7`. El corpus ya los calculaba con el algoritmo. | Los 6 «detectar» y los 4 «no detectar» de `py:ruc` coinciden con el prototipo. |
| 5 | `cl:phone-landline` | Santiago `2` + 8 cifras agrupadas 1+3+4 (ya era así en el regex); `29 345 6789` pasa de «no detectar» a «detectar» (ejemplos y una verdad nueva en el corpus). El prefijo `6[13457]` ya estaba en la lista. Ver la duda 1. | Recall 11/11 (9/9 en el corpus anterior). Ruido sin cambios: 36,1 % de los números de 9 dígitos pegados. |
| 6 | `py:phone-landline` estricta | La estricta (prefijo de país o 0 inicial) toma el nombre `py:phone-landline`; la literal sale. | Ruido de 79,2 % y 78,3 % (8 y 9 dígitos) a 0; sin pérdida de recall (8/8 en el corpus anterior, 10/10 con los casos sumados). |
| 7 | Cédulas de 6 dígitos no empiezan tras «dígito + punto» | Guarda en `uy:ci` y `uy:ci-sindv-ctx` (en el regex) y en `py:ci` (en el recorrido de piezas; ahí vale para las dos variantes). Casos sumados: `12.345.678-5`, `76.123.456-0`, `12.345.678` y `98.765.432`. | Sobre 2000 `12.345.678-X` al azar, el tramo parcial pasa de 1842 (92,1 %) a 0; sobre 2000 montos `$ 12.345.678`, de 2000 a 0. Ningún tramo parcial en el corpus. El número entero **no lo toma ninguna forma** de UY ni de PY (no existe una forma de 8 dígitos con puntos): con AR activo lo toma `dni-ar`. Ver la duda 5. |
| 8 | `cl:plate-4l2d`: lista siempre, otras letras con palabra | `cl:plate-4l2d` (lista de 18, siempre) y `cl:plate-4l2d-ctx` (cualquier letra, con palabra de patente antes; es la forma `lax`). Se suma la grafía `BC.DF.12` a las dos. | `cl:plate-4l2d` recall 13/13 (era 9/11: `BC.DF.12` ya entra); `cl:plate-4l2d-ctx` 6/6 y 0 FP (la `lax` daba 4 de 54). |
| 9 | `bo:nit-ctx` con hasta 3 palabras | Contexto «NIT, N.I.T.» con hasta 3 palabras de relleno sin dígitos (`NIT del emisor: 1234567010`). | Recall 15/16 en el corpus anterior (era 6/16). **Ruido: 2 de 46 negativos** (`NIT vigente, folio 1234567` y `NIT, ver factura 7654321`, dos negativos que sumé a propósito; 4 FP con las copias). 4 palabras entre «NIT» y el número no se detecta, como se pidió. |
| 10 | Fuera los `*-pegado` y `cl:phone-mobile-pelado` sin contexto | Salen `uy:phone-landline-pegado`, `bo:phone-mobile-pegado`, `bo:phone-landline-pegado` y `cl:phone-mobile-pelado`; queda `cl:phone-mobile-ctx` (la `-pelado-ctx` con otro nombre). | Desaparece el ruido de 22 %, 23 % y 35 % (8 dígitos) y el de 11,8 % (9 dígitos). Las 7 verdades pegadas del corpus se quedan: quedan **a la vista** (§3b). |
| 11 | Máximo 5 palabras de contexto | El prototipo falla si un formato trae más de 5. Se recortaron: `cl:rut-ctx` de 7 a 4 (salen «RUT N°», «RUT Nº», «RUN N°»); `cl:phone-mobile-ctx` de 10 a 5 (quedan «Teléfono, Tel., Fono, Celular, Cel.»; salen «Tel», «Cel», «Móvil», «Whatsapp», «Contacto»); `uy:ci-sindv-ctx` de 7 a 5 (salen «Doc.» y «C.I. N°»); `py:ci` y `py:ci-ctx` de 8 a 5 (salen «Nº», «N°», «C.I. N°» y «C.I.C.»; entra «Cédula de identidad»); `bo:ci-ctx` de 7 a 4 (salen las tres de «Nº»); `bo:nit-ctx` de 5 a 2 (el relleno cubre «Nº NIT», «N° NIT» y «N.I.T. N°»). | Las listas ya no son un factor de comparación con la primera medición: parte de lo que cambia en recall viene de recortar. |
| 12 | El complemento de la CI de BO no se mide | Sale de `bo:ci-ext` y de `bo:ci-ctx`; el normalizador queda en número/extensión. Las 3 verdades con complemento del corpus se relabelan `bo:ci-complemento` (sin formato). | `bo:ci-ext` 29/29. **Una CI con complemento no sale tapada ni sin él**: queda entera a la vista aunque lleve palabra de cédula antes (§3b), porque la guarda de corrida (ADR-075 §2) descarta el número `1234567` al ver que su corrida `1234567-1A` tiene letras. El Plan dice «sale tapada sin él»: ver la duda 11. |

## 2. Antes y después, por forma

*Antes* = primera medición (corpus anterior). *Después, corpus anterior* = las formas nuevas sobre los mismos documentos (con las etiquetas de forma renombradas donde la forma cambió de nombre: ver §4). *Después, corpus total* = además los documentos sumados (§4). *FP normal* = matches de la forma, corpus normal, que no son una entidad, sobre el total de negativos anotados. *Ruido* = porcentaje de 2000 números al azar que la forma tapa **entero** por azar, sin contexto (solo se listan los grupos donde la forma acierta alguno; 0 = ningún grupo). Las formas que se fusionaron o renombraron muestran las dos filas de «antes».

| País | Forma (después) | Antes: recall | Antes: FP normal | Antes: ruido (tramo entero, 2000 al azar) | Después, corpus anterior: recall | Después, corpus anterior: FP normal | Después, corpus total: recall | Después, corpus total: FP normal | Después: ruido (tramo entero) |
|---|---|---|---|---|---|---|---|---|---|
| CL | `cl:rut` | 34/34 (100.0 %) | 0 de 54 | 8.3 % (cuerpo c/p 8+DV); 9.0 % (cuerpo c/p 7+DV); 9.3 % (cuerpo s/p 8+DV); 9.3 % (cuerpo s/p 7+DV) | 34/34 (100.0 %) | 0 de 54 | 34/34 (100.0 %) | 0 de 59 | 8.3 % (cuerpo c/p 8+DV); 9.0 % (cuerpo c/p 7+DV); 9.3 % (cuerpo s/p 8+DV); 9.3 % (cuerpo s/p 7+DV) |
| CL | `cl:rut-ctx` | `cl:rut-singuion` 4/4 (100.0 %)<br>`cl:rut-ctx` 3/3 (100.0 %) | `cl:rut-singuion` 0 de 54<br>`cl:rut-ctx` 0 de 54 | `cl:rut-singuion` 8.1 % (8 díg.); 8.9 % (9 díg.); 0.0 % (cuerpo s/p 8+DV); 2.6 % (tras Nº)<br>`cl:rut-ctx` 0 | 3/7 (42.9 %) | 0 de 54 | 9/13 (69.2 %) | 0 de 59 | 0 |
| CL | `cl:phone-mobile` | 11/11 (100.0 %) | 0 de 54 | 0 | 11/11 (100.0 %) | 0 de 54 | 11/11 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:phone-mobile-parentesis` | 1/1 (100.0 %) | 0 de 54 | 0 | 1/1 (100.0 %) | 0 de 54 | 1/1 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:phone-mobile-ctx` | `cl:phone-mobile-pelado` 3/3 (100.0 %)<br>`cl:phone-mobile-pelado-ctx` 3/3 (100.0 %) | `cl:phone-mobile-pelado` 1 de 54<br>`cl:phone-mobile-pelado-ctx` 0 de 54 | `cl:phone-mobile-pelado` 11.8 % (9 díg.)<br>`cl:phone-mobile-pelado-ctx` 0 | 3/3 (100.0 %) | 0 de 54 | 7/7 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:phone-landline` | 9/9 (100.0 %) | 0 de 54 | 36.1 % (9 díg.) | 9/9 (100.0 %) | 0 de 54 | 11/11 (100.0 %) | 0 de 59 | 36.1 % (9 díg.) |
| CL | `cl:plate-4l2d` | 9/11 (81.8 %) | 0 de 54 | 0 | 11/11 (100.0 %) | 0 de 54 | 13/13 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:plate-4l2d-ctx` | 9/11 (81.8 %) | 4 de 54 | 0 | n/a | 0 de 54 | 6/6 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:plate-2l4d` | 8/8 (100.0 %) | 0 de 54 | 0 | 8/8 (100.0 %) | 0 de 54 | 8/8 (100.0 %) | 0 de 59 | 0 |
| CL | `cl:plate-moto-3l2d` | 6/6 (100.0 %) | 10 de 54 | 0 | 2/6 (33.3 %) | 0 de 54 | 6/10 (60.0 %) | 0 de 59 | 0 |
| CL | `cl:plate-moto-2l3d` | 6/6 (100.0 %) | 0 de 54 | 0 | 6/6 (100.0 %) | 0 de 54 | 6/6 (100.0 %) | 0 de 59 | 0 |
| UY | `uy:ci` | 19/19 (100.0 %) | 0 de 42 | 0.0 % (cuerpo c/p 8+DV); 91.3 % (cuerpo c/p 7+DV) | 19/19 (100.0 %) | 0 de 42 | 19/19 (100.0 %) | 0 de 48 | 91.3 % (cuerpo c/p 7+DV) |
| UY | `uy:ci-digitos` | 9/9 (100.0 %) | 0 de 42 | 11.3 % (7 díg.); 10.4 % (8 díg.); 0.0 % (cuerpo s/p 8+DV); 0.0 % (cuerpo s/p 7+DV); 5.5 % (tras Nº) | 9/9 (100.0 %) | 0 de 42 | 9/9 (100.0 %) | 0 de 48 | 11.3 % (7 díg.); 10.4 % (8 díg.); 0.0 % (cuerpo s/p 8+DV); 0.0 % (cuerpo s/p 7+DV); 5.5 % (tras Nº) |
| UY | `uy:ci-guion` | 4/4 (100.0 %) | 0 de 42 | 9.4 % (cuerpo s/p 7+DV) | 4/4 (100.0 %) | 0 de 42 | 4/4 (100.0 %) | 0 de 48 | 9.4 % (cuerpo s/p 7+DV) |
| UY | `uy:ci-guion-sc` | 4/4 (100.0 %) | 0 de 42 | 0 | 4/4 (100.0 %) | 0 de 42 | 4/4 (100.0 %) | 0 de 48 | 0 |
| UY | `uy:ci-sindv-ctx` | `uy:ci-sindv` 8/8 (100.0 %)<br>`uy:ci-sindv-ctx` 6/8 (75.0 %) | `uy:ci-sindv` 5 de 42<br>`uy:ci-sindv-ctx` 0 de 42 | `uy:ci-sindv` 100.0 % (monto 7 díg.); 0.0 % (monto 8 díg.); 0.0 % (cuerpo c/p 8+DV); 0.0 % (cuerpo c/p 7+DV)<br>`uy:ci-sindv-ctx` 0 | 6/8 (75.0 %) | 0 de 42 | 14/16 (87.5 %) | 0 de 48 | 0 |
| UY | `uy:rut` | 9/9 (100.0 %) | 0 de 42 | 0 | 9/9 (100.0 %) | 0 de 42 | 9/9 (100.0 %) | 0 de 48 | 0 |
| UY | `uy:rut-separado` | 8/8 (100.0 %) | 0 de 42 | 0 | 8/8 (100.0 %) | 0 de 42 | 8/8 (100.0 %) | 0 de 48 | 0 |
| UY | `uy:phone-mobile` | 14/14 (100.0 %) | 0 de 42 | 0 | 14/14 (100.0 %) | 0 de 42 | 14/14 (100.0 %) | 0 de 48 | 0 |
| UY | `uy:phone-landline` | 10/10 (100.0 %) | 0 de 42 | 0 | 10/10 (100.0 %) | 0 de 42 | 10/10 (100.0 %) | 0 de 48 | 0 |
| UY | `uy:plate` | 13/13 (100.0 %) | 1 de 42 | 0 | 3/13 (23.1 %) | 0 de 42 | 7/17 (41.2 %) | 0 de 48 | 0 |
| UY | `uy:plate-moto` | 6/6 (100.0 %) | 2 de 42 | 0 | 0/6 (0.0 %) | 0 de 42 | 2/8 (25.0 %) | 0 de 48 | 0 |
| UY | `uy:account-brou` | 7/7 (100.0 %) | 0 de 42 | 0 | 7/7 (100.0 %) | 0 de 42 | 7/7 (100.0 %) | 0 de 48 | 0 |
| PY | `py:ci` | 17/17 (100.0 %) | 7 de 36 | 100.0 % (monto 7 díg.); 0.0 % (monto 8 díg.); 0.0 % (cuerpo c/p 8+DV); 0.0 % (cuerpo c/p 7+DV) | 7/17 (41.2 %) | 0 de 36 | 13/23 (56.5 %) | 0 de 43 | 0 |
| PY | `py:ci-ctx` | 12/12 (100.0 %) | 3 de 36 | 100.0 % (tras Nº) | 12/12 (100.0 %) | 0 de 36 | 14/14 (100.0 %) | 0 de 43 | 0 |
| PY | `py:ruc` | 21/21 (100.0 %) | 0 de 36 | 9.3 % (cuerpo c/p 8+DV); 9.3 % (cuerpo c/p 7+DV); 8.8 % (cuerpo s/p 8+DV); 9.3 % (cuerpo s/p 7+DV) | 21/21 (100.0 %) | 0 de 36 | 21/21 (100.0 %) | 0 de 43 | 9.3 % (cuerpo c/p 8+DV); 9.3 % (cuerpo c/p 7+DV); 8.8 % (cuerpo s/p 8+DV); 9.3 % (cuerpo s/p 7+DV) |
| PY | `py:phone-mobile` | 12/14 (85.7 %) | 0 de 36 | 0 | 12/14 (85.7 %) | 0 de 36 | 14/16 (87.5 %) | 0 de 43 | 0 |
| PY | `py:phone-landline` | `py:phone-landline` 8/8 (100.0 %)<br>`py:phone-landline-estricto` 8/8 (100.0 %) | `py:phone-landline` 0 de 36<br>`py:phone-landline-estricto` 0 de 36 | `py:phone-landline` 79.2 % (8 díg.); 78.3 % (9 díg.); 0.1 % (12 díg.); 0.0 % (cuerpo s/p 8+DV); 18.3 % (tras Nº)<br>`py:phone-landline-estricto` 0 | 8/8 (100.0 %) | 0 de 36 | 10/10 (100.0 %) | 0 de 43 | 0.1 % (12 díg.) |
| PY | `py:plate-3l3d` | 4/4 (100.0 %) | 6 de 36 | 0 | 0/4 (0.0 %) | 0 de 36 | 2/6 (33.3 %) | 0 de 43 | 0 |
| PY | `py:plate-moto-3d3l` | 4/4 (100.0 %) | 1 de 36 | 0 | 0/4 (0.0 %) | 0 de 36 | 2/6 (33.3 %) | 0 de 43 | 0 |
| PY | `py:plate-mercosur` | 9/9 (100.0 %) | 3 de 36 | 0 | 3/9 (33.3 %) | 0 de 36 | 5/11 (45.5 %) | 0 de 43 | 0 |
| PY | `py:plate-moto-mercosur` | 4/4 (100.0 %) | 0 de 36 | 0 | 4/4 (100.0 %) | 0 de 36 | 4/4 (100.0 %) | 0 de 43 | 0 |
| BO | `bo:ci-ext` | 31/31 (100.0 %) | 0 de 38 | 0 | 29/29 (100.0 %) | 0 de 38 | 29/29 (100.0 %) | 0 de 46 | 0 |
| BO | `bo:ci-ctx` | 6/6 (100.0 %) | 2 de 38 | 74.0 % (tras Nº) | 4/5 (80.0 %) | 0 de 38 | 8/9 (88.9 %) | 0 de 46 | 0 |
| BO | `bo:nit-ctx` | 6/16 (37.5 %) | 0 de 38 | 0 | 15/16 (93.8 %) | 0 de 38 | 17/20 (85.0 %) | 2 de 46 | 0 |
| BO | `bo:phone-mobile` | 13/13 (100.0 %) | 0 de 38 | 0 | 13/13 (100.0 %) | 0 de 38 | 13/13 (100.0 %) | 0 de 46 | 0 |
| BO | `bo:phone-landline` | 8/8 (100.0 %) | 0 de 38 | 0 | 8/8 (100.0 %) | 0 de 38 | 8/8 (100.0 %) | 0 de 46 | 0 |
| BO | `bo:plate` | 17/17 (100.0 %) | 6 de 38 | 0 | 5/17 (29.4 %) | 0 de 38 | 11/23 (47.8 %) | 0 de 46 | 0 |
| AR | `ar:cbu` | 33/33 (100.0 %) | 0 de 19 | 1.1 % (22 díg.) | 33/33 (100.0 %) | 0 de 19 | 33/33 (100.0 %) | 0 de 21 | 1.1 % (22 díg.) |
| AR | `ar:passport` | 21/21 (100.0 %) | 4 de 19 | 0 | 4/21 (19.0 %) | 0 de 19 | 10/27 (37.0 %) | 1 de 21 | 0 |
| CL | `cl:rut-singuion` | 4/4 (100.0 %) | 0 de 54 | 8.1 % (8 díg.); 8.9 % (9 díg.); 0.0 % (cuerpo s/p 8+DV); 2.6 % (tras Nº) | sale | sale | sale | sale | sale |
| CL | `cl:phone-mobile-pelado` | 3/3 (100.0 %) | 1 de 54 | 11.8 % (9 díg.) | sale | sale | sale | sale | sale |
| UY | `uy:ci-sindv` | 8/8 (100.0 %) | 5 de 42 | 100.0 % (monto 7 díg.); 0.0 % (monto 8 díg.); 0.0 % (cuerpo c/p 8+DV); 0.0 % (cuerpo c/p 7+DV) | sale | sale | sale | sale | sale |
| UY | `uy:phone-landline-pegado` | 2/2 (100.0 %) | 1 de 42 | 22.1 % (8 díg.); 0.0 % (cuerpo s/p 8+DV); 4.6 % (tras Nº) | sale | sale | sale | sale | sale |
| BO | `bo:phone-mobile-pegado` | 4/4 (100.0 %) | 1 de 38 | 22.9 % (8 díg.); 0.0 % (cuerpo s/p 8+DV); 5.0 % (tras Nº) | sale | sale | sale | sale | sale |
| BO | `bo:phone-landline-pegado` | 1/1 (100.0 %) | 0 de 38 | 34.5 % (8 díg.); 0.0 % (cuerpo s/p 8+DV); 7.3 % (tras Nº) | sale | sale | sale | sale | sale |

Lectura rápida:

- **FP del corpus anterior:** de 57 en total (suma de todas las formas) a 0. Los FP que quedan en el corpus total son tres, y salen de lo que sumé: `bo:nit-ctx` 2 de 46 (relleno), `ar:passport` 1 de 21 (`pasaporte NRO 123456`) y, solo en las copias en mayúsculas, `cl:plate-moto-2l3d` («EN 100», sin cambio) y `py:plate-moto-mercosur` («432 OTRO» dentro de «98.765.432 OTRO»).
- **Recall:** sube donde se quitó una pérdida del informe (`cl:plate-4l2d` 100 %, `bo:nit-ctx` 94 % sobre el corpus anterior) y **baja donde se exigió una palabra**: patentes 0 a 33 % sobre el corpus anterior, `py:ci` 41 %, `ar:passport` 19 %, `cl:rut-ctx` 43 %. Es el precio que el mantenedor eligió; el corpus lo exagera porque escribe las patentes sueltas en los listados de vehículos. Lo que se pierde se ve forma por forma en §4 de las tablas («entidades P que no se tapan enteras»).

## 3. Casos sumados al corpus

Los documentos anteriores no se tocaron: no se agregó ni se quitó ninguna verdad ni ningún negativo. **Solo se cambió la etiqueta de forma** de las verdades cuyo formato cambió de nombre o dejó de existir: `cl:rut-singuion` → `cl:rut-ctx` (4), `cl:phone-mobile-pelado` → `cl:phone-mobile-ctx` (2), `uy:ci-sindv` → `uy:ci-sindv-ctx` (6), y las 3 CI con complemento de BO → `bo:ci-complemento` (sin formato). Las verdades de los `*-pegado` siguen con su etiqueta (sin formato). Cada país suma un documento nuevo (con copia en mayúsculas o minúsculas en algunos):

| País | Documento | Entidades (forma ×N) | Negativos (clase ×N) |
|---|---|---|---|
| CL | cl-09-segunda-medicion | cl:phone-landline ×1; cl:phone-mobile-ctx ×2; cl:plate-4l2d ×1; cl:plate-4l2d-ctx ×3; cl:plate-moto-3l2d ×2; cl:rut-ctx ×3 | art ×1; codigo ×1; folio ×1; ley ×1; monto ×1 |
| UY | uy-09-segunda-medicion | uy:ci-sindv-ctx ×4; uy:plate ×2; uy:plate-moto ×1 | codigo-3l3d ×1; codigo-3l4d ×1; dni-ar ×2; rut-chileno ×2 |
| PY | py-07-segunda-medicion | py:ci ×3; py:ci-ctx ×1; py:phone-landline ×1; py:phone-mobile ×1; py:plate-3l3d ×1; py:plate-mercosur ×1; py:plate-moto-3d3l ×1 | dni-8-digitos ×2; factura ×1; monto ×1; sigla-3d3l ×1; sigla-3l3d ×1; sigla-4l3d ×1 |
| BO | bo-07-segunda-medicion | bo:ci-ctx ×2; bo:nit-ctx ×2; bo:plate ×3 | carnet-nro ×1; factura ×1; factura-cerca-nit ×1; factura-lejos-nit ×1; folio-cerca-nit ×1; nro ×1; sigla-3d3l ×1; sigla-4d3l ×1 |
| AR | ar-04-segunda-medicion | ar:passport ×3; ar:phone-landline-ar ×1 | nro-tras-pasaporte ×1; ref ×1 |

Qué prueba cada uno: RUT y RUN sin guion (con y sin espacio antes del DV) y un número de 9 dígitos sin la palabra; patentes de 4 letras con otras letras (`MNQA-12`, `AEIO 34`, `ABCD.56`) y con las de la lista (`BC.DF.12` con «patente»); motos con «dominio» y «placa»; `29 345 6789`; celulares pelados con «Tel.» y «Cel.»; cédulas con «cédula de identidad», «Documento», «CI», «C.I.», «CIC»; los negativos `12.345.678-5`, `76.123.456-0`, `12.345.678` y `98.765.432` (un RUT chileno y un DNI argentino dentro de documentos de UY y PY); matrículas con «patente» y «placa» y palabras sueltas sin contexto (`REF 1234`, `USD 250`); NIT con 2 palabras de relleno, con 4 (no se detecta) y tres negativos con «NIT» cerca (dos le cuestan un FP al relleno, el de 4 palabras no); placas con «placa», «patente» y «dominio»; pasaportes con «Pasaporte» y el negativo `pasaporte NRO 123456`.

## 4. Choques con AR activo y sobre las fixtures argentinas

**§5.1, AR activo sobre cada corpus** (detalle en §5.1 de las tablas). Casi no cambia, porque `dni-ar` sigue tapando el cuerpo de las cédulas y el catálogo argentino no se tocó:

- `cl:rut`: `dni-ar` tapa el cuerpo y deja el DV a la vista en 24 de 34 (10 sin nada), igual que antes. `cl:rut-ctx`: `dni-ar` toca 10 de 13 (3 exactos, 7 parciales).
- `uy:ci`: 17 de 19 parciales (igual que antes); `uy:ci-guion`: 4 de 4 parciales. `uy:ci-digitos` y `uy:ci-sindv-ctx`: `dni-ar` las cubre exactas (9 de 9 y 14 de 16: mismo tipo, mismo tramo).
- `py:ci` y `py:ci-ctx`: `dni-ar` exacta 19 de 23 y 12 de 14. `py:ruc` (CUIT) contra `dni-ar` (DNI): 20 de 21, **conflicto de tipo**, sin cambio.
- `bo:ci-ext`: 27 de 29 parciales (tapa el número y deja la extensión). `bo:nit-ctx` contra `phone-mobile-ar`: 17 de 20 (eran 13 de 16), conflicto de tipo; `uy:account-brou` contra `phone-landline-ar`: 7 de 7.
- El negativo `12.345.678` que sumé a UY y PY: lo emite `dni-ar` (fp-neg, como en la primera medición para el corpus de CL). **Con AR activo es el único que tapa ese número entero.**
- `ar:cbu` 33/33 también con el catálogo al lado (16 de 33 en grafías `8+14` y de a cuatro pasan por `dni-ar` y `phone-landline-ar`, y gana el CBU entero por largo). `ar:passport`: 10/27 con y sin catálogo; suma 1 FP (el `pasaporte NRO 123456` que puse a propósito).

**§5.2, las formas nuevas sobre las 43 páginas de fixtures argentinas** (todas juntas, con match más largo): **de 47 matches a 20, de 32 que pisan una entidad argentina a 14, de 12 en texto sin verdad a 5.** Lo que queda, por forma: `cl:plate-moto-2l3d` 4 (toma las 2 letras y los 3 dígitos del medio de patentes argentinas `AB 123 CD`: una forma sin contexto que no cambió), `uy:phone-landline` 8 (6 dentro de teléfonos argentinos, 2 en texto), `bo:phone-mobile` 3 (dos dentro de un IBAN español), `py:ruc` 2 y `cl:plate-2l4d` 1 en texto, `cl:rut` 1 (el DV coincide con el CUIT `23-09082125-3`; el match más largo del CUIT lo resuelve) y, con palabra, `uy:plate-moto` 1 y `py:plate-3l3d` 1 (la misma patente argentina `ABC 123` precedida de «patente»: mismo tipo y mismo tramo, no daña). Salieron de la lista: `cl:plate-moto-3l2d` (10), `uy:ci-sindv` (10) y `py:ci` (10), que eran los más ruidosos.

## 5. La tabla final propuesta de la tanda 1

Lista para llevar al mantenedor. *Clase*: `structure` = se arma con las piezas del generador; `control` = RegExp con control propio. *Control*: el verificador, la lista o el patrón de prefijos; «patrón» no es un verificador. El prototipo es la referencia: varias formas `structure` están hechas con RegExp porque las piezas no las alcanzan (ver las dudas 3 y 4). *Estado*: «decidida» = el Plan §5 la lleva a la tanda; «sin decidir» = el Plan no se pronunció. Para los controles sin fuente (python-stdnum, lista de letras, Subtel 2006) ver el informe de investigación.

| País | Forma | Tipo | Clase | Control | Contexto | Máscara | Normalizador | Estado |
|---|---|---|---|---|---|---|---|---|
| CL | `cl:rut` | DNI | control | dígito verificador, módulo 11 | - | `XX.XXX.XXX-X` | cuerpo-DV (DV en mayúscula, sin puntos ni espacios) | decidida |
| CL | `cl:rut-ctx` | DNI | structure | - | «RUT», «RUN», «R.U.T.», «R.U.N.» | `XX.XXX.XXX-X` | cuerpo-DV (DV en mayúscula, sin puntos ni espacios) | decidida |
| CL | `cl:phone-mobile` | PHONE | structure | - | - | `+XX X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:phone-mobile-parentesis` | PHONE | structure | - | - | `(+XX) X XXXX XXXX` | dígitos con prefijo 56 | sin decidir |
| CL | `cl:phone-mobile-ctx` | PHONE | structure | - | «Teléfono», «Tel.», «Fono», «Celular», «Cel.» | `X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:phone-landline` | PHONE | control | lista de 23 códigos de zona (Subtel 2006) y Santiago `2` | - | `+XX X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:plate-4l2d` | PLATE | control | lista de 18 letras (sin fuente primaria) | - | `XXXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-4l2d-ctx` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-2l4d` | PLATE | structure | - | - | `XX-XXXX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-moto-3l2d` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-moto-2l3d` | PLATE | structure | - | - | `XX-XXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:ci` | DNI | structure | - | - | `X.XXX.XXX-X` | solo dígitos | decidida |
| UY | `uy:ci-digitos` | DNI | control | dígito verificador de python-stdnum (sin fuente oficial) | - | `XXXXXXXX` | solo dígitos | decidida |
| UY | `uy:ci-guion` | DNI | control | dígito verificador de python-stdnum (sin fuente oficial) | - | `XXXXXXX-X` | solo dígitos | sin decidir |
| UY | `uy:ci-guion-sc` | DNI | structure | - | - | `XXXXXXX-X` | solo dígitos | sin decidir |
| UY | `uy:ci-sindv-ctx` | DNI | structure | - | «CI», «C.I.», «Cédula», «Cédula de identidad», «Documento» | `X.XXX.XXX` | solo dígitos | decidida |
| UY | `uy:rut` | CUIT | control | dígito verificador módulo 11 (sin fuente oficial), serie 01-22, tipo 001 | - | `XXXXXXXXXXXX` | solo dígitos | decidida |
| UY | `uy:rut-separado` | CUIT | structure | - | - | `XXXXXXXXXXXX` | solo dígitos | decidida |
| UY | `uy:phone-mobile` | PHONE | control | prefijos 091-099 (patrón) | - | `0XX XXX XXX` | dígitos con prefijo 598 (sin el 0 inicial) | decidida |
| UY | `uy:phone-landline` | PHONE | control | primer dígito 2 o 4 (patrón) | - | `XXXX XXXX` | dígitos con prefijo 598 (sin el 0 inicial) | decidida |
| UY | `uy:plate` | PLATE | structure | - | «Matrícula», «Patente», «Placa», «Chapa», «Dominio» | `XXX XXXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:plate-moto` | PLATE | structure | - | «Matrícula», «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:account-brou` | BANK_ACCOUNT | structure | - | - | `XXXXXXXXX-XXXXX` | solo dígitos | decidida |
| PY | `py:ci` | DNI | structure | - | «C.I.», «CI», «CIC», «Cédula», «Cédula de identidad» | `X.XXX.XXX` | solo dígitos | decidida |
| PY | `py:ci-ctx` | DNI | structure | - | «C.I.», «CI», «CIC», «Cédula», «Cédula de identidad» | `XXXXXXX` | solo dígitos | decidida |
| PY | `py:ruc` | CUIT | control | dígito verificador módulo 11 de la DNIT (el algoritmo manda) | - | `XXXXXXXX-X` | cuerpo-DV, sin puntos | decidida |
| PY | `py:phone-mobile` | PHONE | control | prefijo 09XX (patrón) | - | `09XX XXX XXX` | dígitos con prefijo 595 (sin el 0 inicial) | decidida |
| PY | `py:phone-landline` | PHONE | control | prefijo de país o 0 inicial + código 2-8 (patrón) | - | `0XX XXX XXXX` | dígitos con prefijo 595 (sin el 0 inicial) | decidida |
| PY | `py:plate-3l3d` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-moto-3d3l` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-mercosur` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-moto-mercosur` | PLATE | structure | - | - | `XXX XXXX` | mayúsculas, sin separadores | decidida |
| BO | `bo:ci-ext` | DNI | control | lista de 9 extensiones departamentales | - | `XXXXXXX XX` | número/extensión (extensión en mayúscula, sin puntos) | decidida |
| BO | `bo:ci-ctx` | DNI | structure | - | «C.I.», «CI», «Cédula», «Cédula de identidad» | `XXXXXXX` | solo dígitos | decidida |
| BO | `bo:nit-ctx` | CUIT | structure | - | «NIT», «N.I.T.» (hasta 3 palabras de relleno) | `XXXXXXXXXX` | solo dígitos | decidida |
| BO | `bo:phone-mobile` | PHONE | control | primer dígito 6 o 7 (patrón) | - | `XXXX XXXX` | dígitos con prefijo 591 | decidida |
| BO | `bo:phone-landline` | PHONE | control | código de área 2, 3 o 4 (patrón) | - | `X XXX XXXX` | dígitos con prefijo 591 | decidida |
| BO | `bo:plate` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX XXX` | mayúsculas, sin separadores | decidida |
| AR | `ar:cbu` | BANK_ACCOUNT | control | dos dígitos verificadores del BCRA | - | `XXXXXXXXXXXXXXXXXXXXXX` | solo dígitos | decidida |
| AR | `ar:passport` | PASSPORT | structure | - | «Pasaporte» | `XXX XXXXXX` | mayúsculas, sin separadores | decidida |

Formas que pasan a ser iguales con el contexto, o que lo comparten (para que el planificador decida si se fusionan en un solo formato con variantes; no las fusioné):

- `uy:plate` y `uy:plate-moto`: mismo tipo, mismo contexto (5 palabras) y solo difieren en 4 contra 3 dígitos (y la máscara).
- `py:plate-3l3d`, `py:plate-moto-3d3l` y `py:plate-mercosur`: mismo contexto (4 palabras). `cl:plate-moto-3l2d` y `cl:plate-4l2d-ctx`: mismo contexto y mismo tipo (3 o 4 letras y 2 dígitos).
- `py:ci` y `py:ci-ctx`: **mismo contexto exacto**, mismo tipo, mismo normalizador. Solo difieren en la variante (`1.234.567` con puntos o 5 a 8 dígitos pelados): serían un formato con tres variantes.
- `cl:plate-4l2d-ctx` **incluye** a `cl:plate-4l2d` (con palabra, las dos tapan el mismo tramo): la de la lista no es redundante porque tapa sin palabra.
- Entre países: `py:plate-3l3d`, `uy:plate-moto` y `ar:plate-vieja-ar` son la misma forma (3 letras y 3 dígitos), solo `ar:plate-vieja-ar` sin contexto.

## 6. Dudas para el mantenedor (no elegí: las anoto)

1. **El «prefijo celular `6[13457]`» del Plan.** Los celulares chilenos empiezan en 9; `6[13457]` son los códigos de zona fijos 61, 63, 64, 65 y 67 (el informe los trae como `6[1345 7]`, con un espacio). Leí que se refiere a ese prefijo dentro de `cl:phone-landline` y lo dejé como estaba en la lista de 23 códigos. Si quería otra cosa, no cambió nada.
2. **«Matrícula» en Uruguay.** El Plan nombra «patente, placa, chapa, dominio». En Uruguay la matrícula es la patente y el corpus la escribe así; con las cuatro palabras del Plan, `uy:plate` tapa 0 de 13 en el corpus anterior (11,8 % con los casos sumados), contra 3 de 13 (23,1 %; 41,2 % con los sumados) con «Matrícula». La sumé como quinta palabra de `uy:plate` y `uy:plate-moto`. ¿Se acepta, o se queda en cuatro?
3. **El relleno del NIT no existe en ADR-220.** El contexto del spec es «justo antes, con espacios y como mucho un `:`». Para «hasta 3 palabras entre NIT y el número» el prototipo suma un parámetro (palabras sin dígitos, con letras, puntos y `°`). «En el mismo renglón» no se puede ejercer: el texto de página del prototipo no tiene saltos de línea (son las palabras unidas con un espacio). Hay que decidir cómo se escribe en el spec, y si el límite de renglón existe en `Page.text`.
4. **«No empieza justo después de un dígito y un punto» no tiene pieza.** Para `py:ci` (pieza) lo implementé como una guarda sobre los dos caracteres previos; para `uy:ci` y `uy:ci-sindv-ctx` (RegExp) es una mirada hacia atrás. Es una regla que ADR-220 no trae. Además se vio el mismo hueco en otra forma: `py:plate-moto-mercosur` (sin contexto, sin cambios) tapa `432 OTRO` dentro de `98.765.432 OTRO` (solo en la copia en mayúsculas). ¿La guarda es una regla general de las formas `structure` o solo de las cédulas?
5. **Cédula de 8 dígitos con puntos.** El cambio 7 dice «el número entero lo toma la forma de 8 dígitos», pero ni UY ni PY tienen una forma de 8 dígitos con puntos (la CI uruguaya es de 7 dígitos más DV; la paraguaya se escribe con 7 a lo sumo con puntos). Lo leí como «no queda ningún tramo parcial» y lo verifiqué así. Con AR activo `dni-ar` lo toma entero; sin AR, `12.345.678` queda sin tapar en UY y PY. ¿Es lo querido?
6. **La palabra «cédula de identidad» y «Nº» en Paraguay y Bolivia.** Con el máximo de 5 palabras elegí, en PY, `C.I., CI, CIC, Cédula, Cédula de identidad` (sale «C.I.C.»). Sin «Nº», `C.I. N° 1.234.567` ya no se tapa (el contexto debe estar justo antes): lo mismo con `carnet Nº 2345678` en BO. Si se quiere recuperarlas, el relleno del NIT (duda 3) lo permitiría: una palabra de relleno después de «C.I.».
7. **`cl:phone-landline` sigue sin exigir separadores:** 36,1 % de los números de 9 dígitos pegados (Santiago `2` + 8 y los 23 códigos). El Plan dice «agrupadas 1+3+4» y lo leí como el agrupado de las 8 cifras, con separadores opcionales (los ejemplos `22 345 6789` y `+56 2 2345 6789` los traen). Exigir al menos un separador cuando falta el prefijo de país (como UY y BO) bajaría el ruido y perdería los pegados. ¿Se pide?
8. **Formas sin decidir.** El Plan no dice nada de `uy:ci-guion` (con verificador; 9,4 % de ruido), `uy:ci-guion-sc` y `cl:phone-mobile-parentesis`: siguen «opcional» en la tabla.
9. **`cl:rut-ctx` unificada.** Quedó una sola forma sin verificador (DV mal tipeado entra, y cualquier número de 8 o 9 dígitos tras «RUT»/«RUN» también). Si se prefiere una con verificador para el RUT sin guion y otra sin él para el guion, son dos formas.
10. **Los números de la medición del NIT dependen de dos negativos míos.** `NIT vigente, folio 1234567` y `NIT, ver factura 7654321` están escritos para pegarle al relleno; el FP de 2 de 46 mide si se escribe así, no cuánto pasa en documentos reales.

11. **La CI de Bolivia con complemento no sale tapada.** El Plan dice que sale «tapada sin él». Con la guarda de corrida de ADR-075 §2 (la misma función del motor) no pasa: el número `1234567` dentro de `1234567-1A` se descarta porque su corrida tiene letras, y la CI con complemento queda entera a la vista (3 de 3, las tres con palabra de cédula antes). Para que salga tapada sin él, el formato tendría que aceptar el complemento como parte del match, y el Plan dijo que no se mide. Va a las limitaciones conocidas como «sale a la vista», no como «sale tapada sin complemento». ¿Se acepta?

## 7. Límites

- **Todo sale de sintéticos.** Nada sale de documentos reales; los números, nombres, patentes y las frases son inventados o calculados. Cuánto se escribe en la realidad una patente con y sin la palabra, o un RUT sin guion tras «RUT», **no está medido**: la caída de recall de las patentes (0 a 33 % sobre el corpus anterior) se debe a cómo escribí los listados de vehículos, y una medición que decide producto debería sumar documentos reales por `ANONLY_REAL_DOC_*` (fuera del alcance).
- **El recall sigue siendo optimista** en lo que no cambió (el corpus lo escribí con las formas que se proponen). Lo que discrimina son los FP, las pérdidas, los choques y el ruido (§8b). Los 5 casos nuevos por país (§3) son pocos para estimar tasas.
- **El ruido numérico no sirve para las formas con contexto:** las formas con palabra delante (casi todas ahora) dan 0 de ruido por construcción; lo que importa de ellas es cuánto se pierde y qué palabra comun les pega un número.
- **No se midió tiempo ni peor caso** y no se tocó `tests/perf`. El enumerador de piezas no es el autómata del motor; el resolvedor de solapamientos es el de formatos base. Las guardas nuevas (relleno, «no después de dígito y punto») son del prototipo.
- **Los universales no se tocaron.** Sus hallazgos de la primera medición (fecha con punto, mes abreviado, `Camino`, `c/`, carátula con dos apellidos) siguen ahí; es el frente U1 (§6 de las tablas).

## 8. Cómo reproducirla

```bash
pnpm exec vitest run --config tests/paises/vitest.paises.config.ts
```

Variable `PAISES_OUT` (directorio de salida; por defecto el temporal del sistema). Escribe `medicion-tablas.md` (las tablas de abajo) y `medicion-datos.json`. Dura unos 3 segundos. **No entra en `pnpm test`:** el `include` del `vitest.config.ts` de la raíz es `tests/**/*.test.ts` y el archivo es `medicion.spec.ts`, con config propio; `pnpm exec vitest list` no lo ve. Verificaciones del trabajo: `pnpm exec prettier --check tests/paises`, `pnpm exec eslint tests/paises` y `pnpm exec tsc -p tests/tsconfig.json --noEmit`, los tres limpios.

Archivos (todo bajo `tests/paises/`, sin commitear): `medicion.spec.ts`, `vitest.paises.config.ts`, `corpus/{cl,uy,py,bo,ar}.ts`, `lib/{types,checks,gen,pieces,engine,formats,dsl,measure,examples,fixtures-ar,report}.ts`. Las tablas «antes y después» de §2 salen de unir el JSON de las dos mediciones (el de la primera se corrió con el código anterior, copiado aparte).

---

# Tablas (generadas por el comando de arriba)


## 0. Resumen por forma

Cada forma corrida sola sobre el corpus de su país (detalle en §3). *Rol*: «núcleo» = lo que el Plan §5 manda llevar a la tanda; «opcional» = el Plan todavía no lo decide; «alternativa» = reemplaza a otra forma. *Recall* = exactas / esperadas, sobre todas las copias del corpus (normal, MAYÚS, minús), con los casos sumados en la segunda medición. *Corpus anterior* = lo mismo sin los documentos sumados (comparable con la primera medición, salvo el relleno de las etiquetas de forma). *FP corpus normal* = matches de la forma en los documentos normales que no son una entidad (caen sobre un negativo anotado o en texto corriente), de cuántos negativos anotados hay. *FP todas* = lo mismo sobre todas las copias (las copias en mayúsculas repiten los negativos).

| País | Forma | Tipo | Rol | Esperadas | Exactas | Recall | FP corpus normal | FP todas | Recall (corpus anterior) | FP normal (corpus anterior) |
|---|---|---|---|---|---|---|---|---|---|---|
| CL | `cl:rut` | DNI | núcleo | 34 | 34 | 100.0 % | 0 de 59 | 0 | 34/34 (100.0 %) | 0 de 54 |
| CL | `cl:rut-ctx` | DNI | núcleo | 13 | 9 | 69.2 % | 0 de 59 | 0 | 3/7 (42.9 %) | 0 de 54 |
| CL | `cl:phone-mobile` | PHONE | núcleo | 11 | 11 | 100.0 % | 0 de 59 | 0 | 11/11 (100.0 %) | 0 de 54 |
| CL | `cl:phone-mobile-parentesis` | PHONE | opcional | 1 | 1 | 100.0 % | 0 de 59 | 0 | 1/1 (100.0 %) | 0 de 54 |
| CL | `cl:phone-mobile-ctx` | PHONE | núcleo | 7 | 7 | 100.0 % | 0 de 59 | 0 | 3/3 (100.0 %) | 0 de 54 |
| CL | `cl:phone-landline` | PHONE | núcleo | 11 | 11 | 100.0 % | 0 de 59 | 0 | 9/9 (100.0 %) | 0 de 54 |
| CL | `cl:plate-4l2d` | PLATE | núcleo | 13 | 13 | 100.0 % | 0 de 59 | 0 | 11/11 (100.0 %) | 0 de 54 |
| CL | `cl:plate-4l2d-ctx` | PLATE | núcleo | 6 | 6 | 100.0 % | 0 de 59 | 0 | n/a | 0 de 54 |
| CL | `cl:plate-2l4d` | PLATE | núcleo | 8 | 8 | 100.0 % | 0 de 59 | 0 | 8/8 (100.0 %) | 0 de 54 |
| CL | `cl:plate-moto-3l2d` | PLATE | núcleo | 10 | 6 | 60.0 % | 0 de 59 | 0 | 2/6 (33.3 %) | 0 de 54 |
| CL | `cl:plate-moto-2l3d` | PLATE | núcleo | 6 | 6 | 100.0 % | 0 de 59 | 1 | 6/6 (100.0 %) | 0 de 54 |
| UY | `uy:ci` | DNI | núcleo | 19 | 19 | 100.0 % | 0 de 48 | 0 | 19/19 (100.0 %) | 0 de 42 |
| UY | `uy:ci-digitos` | DNI | núcleo | 9 | 9 | 100.0 % | 0 de 48 | 0 | 9/9 (100.0 %) | 0 de 42 |
| UY | `uy:ci-guion` | DNI | opcional | 4 | 4 | 100.0 % | 0 de 48 | 0 | 4/4 (100.0 %) | 0 de 42 |
| UY | `uy:ci-guion-sc` | DNI | alternativa | 4 | 4 | 100.0 % | 0 de 48 | 0 | 4/4 (100.0 %) | 0 de 42 |
| UY | `uy:ci-sindv-ctx` | DNI | núcleo | 16 | 14 | 87.5 % | 0 de 48 | 0 | 6/8 (75.0 %) | 0 de 42 |
| UY | `uy:rut` | CUIT | núcleo | 9 | 9 | 100.0 % | 0 de 48 | 0 | 9/9 (100.0 %) | 0 de 42 |
| UY | `uy:rut-separado` | CUIT | núcleo | 8 | 8 | 100.0 % | 0 de 48 | 0 | 8/8 (100.0 %) | 0 de 42 |
| UY | `uy:phone-mobile` | PHONE | núcleo | 14 | 14 | 100.0 % | 0 de 48 | 0 | 14/14 (100.0 %) | 0 de 42 |
| UY | `uy:phone-landline` | PHONE | núcleo | 10 | 10 | 100.0 % | 0 de 48 | 0 | 10/10 (100.0 %) | 0 de 42 |
| UY | `uy:plate` | PLATE | núcleo | 17 | 7 | 41.2 % | 0 de 48 | 0 | 3/13 (23.1 %) | 0 de 42 |
| UY | `uy:plate-moto` | PLATE | núcleo | 8 | 2 | 25.0 % | 0 de 48 | 0 | 0/6 (0.0 %) | 0 de 42 |
| UY | `uy:account-brou` | BANK_ACCOUNT | núcleo | 7 | 7 | 100.0 % | 0 de 48 | 0 | 7/7 (100.0 %) | 0 de 42 |
| PY | `py:ci` | DNI | núcleo | 23 | 13 | 56.5 % | 0 de 43 | 0 | 7/17 (41.2 %) | 0 de 36 |
| PY | `py:ci-ctx` | DNI | núcleo | 14 | 14 | 100.0 % | 0 de 43 | 0 | 12/12 (100.0 %) | 0 de 36 |
| PY | `py:ruc` | CUIT | núcleo | 21 | 21 | 100.0 % | 0 de 43 | 0 | 21/21 (100.0 %) | 0 de 36 |
| PY | `py:phone-mobile` | PHONE | núcleo | 16 | 14 | 87.5 % | 0 de 43 | 0 | 12/14 (85.7 %) | 0 de 36 |
| PY | `py:phone-landline` | PHONE | núcleo | 10 | 10 | 100.0 % | 0 de 43 | 0 | 8/8 (100.0 %) | 0 de 36 |
| PY | `py:plate-3l3d` | PLATE | núcleo | 6 | 2 | 33.3 % | 0 de 43 | 0 | 0/4 (0.0 %) | 0 de 36 |
| PY | `py:plate-moto-3d3l` | PLATE | núcleo | 6 | 2 | 33.3 % | 0 de 43 | 0 | 0/4 (0.0 %) | 0 de 36 |
| PY | `py:plate-mercosur` | PLATE | núcleo | 11 | 5 | 45.5 % | 0 de 43 | 0 | 3/9 (33.3 %) | 0 de 36 |
| PY | `py:plate-moto-mercosur` | PLATE | núcleo | 4 | 4 | 100.0 % | 0 de 43 | 1 | 4/4 (100.0 %) | 0 de 36 |
| BO | `bo:ci-ext` | DNI | núcleo | 29 | 29 | 100.0 % | 0 de 46 | 0 | 29/29 (100.0 %) | 0 de 38 |
| BO | `bo:ci-ctx` | DNI | núcleo | 9 | 8 | 88.9 % | 0 de 46 | 0 | 4/5 (80.0 %) | 0 de 38 |
| BO | `bo:nit-ctx` | CUIT | núcleo | 20 | 17 | 85.0 % | 2 de 46 | 4 | 15/16 (93.8 %) | 0 de 38 |
| BO | `bo:phone-mobile` | PHONE | núcleo | 13 | 13 | 100.0 % | 0 de 46 | 0 | 13/13 (100.0 %) | 0 de 38 |
| BO | `bo:phone-landline` | PHONE | núcleo | 8 | 8 | 100.0 % | 0 de 46 | 0 | 8/8 (100.0 %) | 0 de 38 |
| BO | `bo:plate` | PLATE | núcleo | 23 | 11 | 47.8 % | 0 de 46 | 0 | 5/17 (29.4 %) | 0 de 38 |
| AR | `ar:cbu` | BANK_ACCOUNT | núcleo | 33 | 33 | 100.0 % | 0 de 21 | 0 | 33/33 (100.0 %) | 0 de 19 |
| AR | `ar:passport` | PASSPORT | núcleo | 27 | 10 | 37.0 % | 1 de 21 | 2 | 4/21 (19.0 %) | 0 de 19 |

## 1. Tamaño del corpus

| País | Docs normal | Docs MAYÚS | Docs minús | Caracteres | Entidades P (normal) | Entidades P (total) | Negativos (normal) | Negativos (total) | Universales U (normal) |
|---|---|---|---|---|---|---|---|---|---|
| CL | 9 | 4 | 3 | 10028 | 69 | 120 | 59 | 107 | 24 |
| UY | 9 | 3 | 4 | 8060 | 73 | 123 | 48 | 92 | 20 |
| PY | 7 | 4 | 2 | 6733 | 62 | 111 | 43 | 83 | 17 |
| BO | 7 | 3 | 3 | 6580 | 63 | 110 | 46 | 90 | 16 |
| AR | 4 | 2 | 1 | 3857 | 44 | 82 | 21 | 37 | 5 |

«Normal» son los documentos escritos; «MAYÚS» son copias de algunos pasadas a mayúsculas (todo el texto y las entidades); «minús» son copias con el texto de contexto en minúsculas (las entidades quedan como están, los negativos van en minúscula). Las copias repiten las mismas entidades, por eso se cuenta aparte lo «normal».

Entidades por forma (P):

| País | Forma | Tipo | Normal | Total |
|---|---|---|---|---|
| CL | cl:phone-landline | PHONE | 8 | 11 |
| CL | cl:phone-mobile | PHONE | 7 | 11 |
| CL | cl:phone-mobile-ctx | PHONE | 4 | 7 |
| CL | cl:phone-mobile-parentesis | PHONE | 1 | 1 |
| CL | cl:plate-2l4d | PLATE | 4 | 8 |
| CL | cl:plate-4l2d | PLATE | 6 | 13 |
| CL | cl:plate-4l2d-ctx | PLATE | 3 | 6 |
| CL | cl:plate-moto-2l3d | PLATE | 3 | 6 |
| CL | cl:plate-moto-3l2d | PLATE | 5 | 10 |
| CL | cl:rut | DNI | 18 | 34 |
| CL | cl:rut-ctx | DNI | 10 | 13 |
| UY | uy:account-brou | BANK_ACCOUNT | 4 | 7 |
| UY | uy:ci | DNI | 10 | 19 |
| UY | uy:ci-digitos | DNI | 6 | 9 |
| UY | uy:ci-guion | DNI | 4 | 4 |
| UY | uy:ci-sindv-ctx | DNI | 10 | 16 |
| UY | uy:phone-landline | PHONE | 7 | 10 |
| UY | uy:phone-landline-pegado | PHONE | 2 | 2 |
| UY | uy:phone-mobile | PHONE | 9 | 14 |
| UY | uy:plate | PLATE | 8 | 17 |
| UY | uy:plate-moto | PLATE | 4 | 8 |
| UY | uy:rut | CUIT | 5 | 9 |
| UY | uy:rut-separado | CUIT | 4 | 8 |
| PY | py:ci | DNI | 11 | 23 |
| PY | py:ci-ctx | DNI | 7 | 14 |
| PY | py:phone-landline | PHONE | 8 | 10 |
| PY | py:phone-mobile | PHONE | 10 | 16 |
| PY | py:plate-3l3d | PLATE | 3 | 6 |
| PY | py:plate-mercosur | PLATE | 5 | 11 |
| PY | py:plate-moto-3d3l | PLATE | 3 | 6 |
| PY | py:plate-moto-mercosur | PLATE | 2 | 4 |
| PY | py:ruc | CUIT | 13 | 21 |
| BO | bo:ci-complemento | DNI | 2 | 3 |
| BO | bo:ci-ctx | DNI | 6 | 9 |
| BO | bo:ci-ext | DNI | 14 | 29 |
| BO | bo:nit-ctx | CUIT | 13 | 20 |
| BO | bo:phone-landline | PHONE | 6 | 8 |
| BO | bo:phone-landline-pegado | PHONE | 1 | 1 |
| BO | bo:phone-mobile | PHONE | 8 | 13 |
| BO | bo:phone-mobile-pegado | PHONE | 2 | 4 |
| BO | bo:plate | PLATE | 11 | 23 |
| AR | ar:cbu | BANK_ACCOUNT | 18 | 33 |
| AR | ar:cuit-ar | CUIT | 4 | 7 |
| AR | ar:dni-ar | DNI | 3 | 5 |
| AR | ar:passport | PASSPORT | 14 | 27 |
| AR | ar:phone-landline-ar | PHONE | 2 | 4 |
| AR | ar:phone-mobile-ar | PHONE | 1 | 2 |
| AR | ar:plate-mercosur-ar | PLATE | 1 | 2 |
| AR | ar:plate-vieja-ar | PLATE | 1 | 2 |

Negativos por clase (corpus normal):

| País | Clases |
|---|---|
| CL | art: 2; bloque: 1; boleta: 1; caja: 1; causa: 1; cert: 1; codigo: 3; cp: 2; cuotas: 1; dec: 1; depto: 1; dfl: 1; est: 1; expediente: 1; factura: 2; fojas: 2; folio: 3; iva: 1; ley: 3; lote: 1; monto: 11; n: 2; numero: 1; oc: 1; oficio: 1; pag: 2; piso: 1; planta: 1; ref: 1; rol: 1; rol-avaluo: 1; ruc: 1; serie: 1; sociedad: 1; tomo: 1; utm: 1; zona: 1 |
| UY | apto: 1; art: 1; caja: 1; casa: 1; casilla: 1; codigo: 2; codigo-3l3d: 1; codigo-3l4d: 1; contrato: 1; cp: 2; dec: 1; dni-ar: 2; est: 1; exp: 1; expediente: 1; fojas: 1; folio: 1; iue: 1; iva: 1; ley: 1; lote: 1; monto: 10; n: 2; oc: 1; op: 1; orden: 1; padron: 2; pag: 1; piso: 1; ref: 1; res: 1; rut-chileno: 2; serie: 1 |
| PY | art: 2; casa: 1; codigo: 1; cp: 2; cuenta: 1; dec: 1; dni-8-digitos: 2; est: 1; exp: 1; factura: 3; finca: 2; fojas: 1; folio: 1; iva: 1; km: 1; ley: 1; lote: 1; monto: 8; n: 1; oc: 1; piso: 1; ref: 1; sigla-3d3l: 1; sigla-3l3d: 1; sigla-4l3d: 1; timbrado: 1; usd: 3; zona: 1 |
| BO | art: 2; carnet-nro: 1; casa: 1; codigo: 2; cp: 1; ctrl: 1; cuf: 1; dec: 1; detalle: 1; est: 1; exp: 2; factura: 3; factura-cerca-nit: 1; factura-lejos-nit: 1; fojas: 2; folio: 1; folio-cerca-nit: 1; iva: 1; km: 1; ley: 2; lote: 1; monto: 5; n: 1; nit-sin-etiqueta: 1; nro: 1; pago: 1; piso: 1; sigla-3d3l: 1; sigla-4d3l: 1; ufv: 2; usd: 3; zona: 1 |
| AR | alias: 1; cbu-21: 1; cbu-23: 1; cbu-dv1: 1; cbu-dv2: 2; contrato: 1; corto: 1; cuatro-letras: 1; dos-letras: 1; exp: 2; factura: 1; inversa: 1; lote: 1; monto: 1; nro: 1; nro-tras-pasaporte: 1; orden: 1; ref: 2 |

Universales anotados (verdad U, corpus normal):

| País | Tipos |
|---|---|
| CL | ADDRESS: 7; DATE: 16; PERSON: 1 |
| UY | ADDRESS: 7; DATE: 11; PERSON: 2 |
| PY | ADDRESS: 6; DATE: 10; PERSON: 1 |
| BO | ADDRESS: 6; DATE: 9; PERSON: 1 |
| AR | ADDRESS: 1; CREDIT_CARD: 1; DATE: 3 |

### Casos sumados al corpus en la segunda medición

Documentos nuevos (los anteriores no se tocaron, salvo la etiqueta de forma de las verdades cuyo formato cambió de nombre o dejó de existir: ver la cabecera). Entidades y negativos que traen:

| País | Documento | Entidades (forma ×N) | Negativos (clase ×N) |
|---|---|---|---|
| CL | cl-09-segunda-medicion | cl:phone-landline ×1; cl:phone-mobile-ctx ×2; cl:plate-4l2d ×1; cl:plate-4l2d-ctx ×3; cl:plate-moto-3l2d ×2; cl:rut-ctx ×3 | art ×1; codigo ×1; folio ×1; ley ×1; monto ×1 |
| UY | uy-09-segunda-medicion | uy:ci-sindv-ctx ×4; uy:plate ×2; uy:plate-moto ×1 | codigo-3l3d ×1; codigo-3l4d ×1; dni-ar ×2; rut-chileno ×2 |
| PY | py-07-segunda-medicion | py:ci ×3; py:ci-ctx ×1; py:phone-landline ×1; py:phone-mobile ×1; py:plate-3l3d ×1; py:plate-mercosur ×1; py:plate-moto-3d3l ×1 | dni-8-digitos ×2; factura ×1; monto ×1; sigla-3d3l ×1; sigla-3l3d ×1; sigla-4l3d ×1 |
| BO | bo-07-segunda-medicion | bo:ci-ctx ×2; bo:nit-ctx ×2; bo:plate ×3 | carnet-nro ×1; factura ×1; factura-cerca-nit ×1; factura-lejos-nit ×1; folio-cerca-nit ×1; nro ×1; sigla-3d3l ×1; sigla-4d3l ×1 |
| AR | ar-04-segunda-medicion | ar:passport ×3; ar:phone-landline-ar ×1 | nro-tras-pasaporte ×1; ref ×1 |

## 2. Los ejemplos del informe contra los prototipos

Cada «Detectar» y «No detectar» de `Paises_Tanda1_Investigacion_2026-11-22.md`, corridos tal cual contra su prototipo (solo esas formas, con guarda de corrida). Un desacuerdo es una duda, no un fallo: puede ser un error del informe, uno del prototipo o una decisión posterior del Plan §5.

| Familia de formas | Informe | Detecta (de los «detectar») | No detecta (de los «no detectar») |
|---|---|---|---|
| cl:rut | §1.2 | 8/8 | 6/6 |
| cl:rut-ctx | Plan §5 (RUT sin guion y DV mal tipeado, con RUT o RUN antes) | 5/5 | 4/4 |
| cl:phone-mobile | §1.3 | 5/5 | 5/5 |
| cl:phone-mobile-ctx | Plan §5 (celular sin prefijo, con palabra de teléfono antes) | 4/4 | 4/4 |
| cl:phone-landline | §1.3 y Plan §5 (`29 345 6789` se detecta) | 5/5 | 3/3 |
| cl:plate-4l2d (letras de la lista) | §1.4 | 5/5 | 5/5 |
| cl:plate-4l2d + cl:plate-4l2d-ctx | Plan §5 (otras letras, solo con palabra de patente antes) | 5/5 | 5/5 |
| cl:plate-2l4d | §1.4 | 4/4 | 4/4 |
| cl:plate-moto-3l2d | §1.4 y Plan §5 (con palabra de patente antes) | 3/3 | 5/5 |
| cl:plate-moto-2l3d | §1.4 | 3/3 | 3/3 |
| uy:ci (tres formas) | §2.2 y Plan §5 (con puntos y guion se tapa siempre) | 7/7 | 3/3 |
| uy:ci-sindv-ctx | Plan §5 (CI sin verificador, con palabra de documento antes) | 4/4 | 5/5 |
| uy:rut (continuo y separado) | §2.3 | 4/4 | 4/4 |
| uy:phone-mobile | §2.4 | 4/4 | 4/4 |
| uy:phone-landline | §2.4 | 4/4 | 3/3 |
| uy:plate | §2.5 y Plan §5 (con palabra de matrícula o patente antes) | 4/4 | 4/4 |
| uy:account-brou | §2.6 | 3/3 | 3/3 |
| py:ci | §3.2 y Plan §5 (con palabra de cédula antes) | 4/4 | 6/6 |
| py:ci-ctx | §3.2 y Plan §5 («Nº» sale de la lista) | 3/3 | 5/5 |
| py:ruc | §3.3 y Plan §5 (el algoritmo manda: dos ejemplos corregidos) | 6/6 | 4/4 |
| py:phone-mobile | §3.4 | 4/4 | 3/3 |
| py:phone-landline (estricto) | §3.4, §11.8 y Plan §5 (prefijo de país o 0 inicial) | 4/4 | 3/3 |
| py:plate (cuatro formas) | §3.5 y Plan §5 (las tres con falsos positivos llevan palabra antes) | 6/6 | 6/6 |
| bo:ci-ext | §4.2 (sin complemento, Plan §5) | 3/3 | 4/4 |
| bo:ci-ctx | §4.2 y Plan §5 («Nº» sale de la lista) | 3/3 | 3/3 |
| bo:nit-ctx | §4.3 y Plan §5 (hasta 3 palabras entre NIT y el número) | 5/5 | 4/4 |
| bo:phone-mobile | §4.4 | 4/4 | 3/3 |
| bo:phone-landline | §4.4 | 3/3 | 2/2 |
| bo:plate | §4.5 y Plan §5 (con palabra de placa antes) | 4/4 | 5/5 |
| ar:cbu | §5.1 y §11.6 | 9/9 | 5/5 |
| ar:passport | §5.3 y Plan §5 (con «pasaporte» antes) | 4/4 | 5/5 |

Desacuerdos:

(ninguno)

## 3. Medición por forma

**Método.** Cada forma se corre **sola** (con la guarda de corrida de ADR-075 §2 y el control propio) sobre todos los documentos de su país, y se compara con la verdad anotada. *Esperadas* = entidades P cuya forma es esa (o la que esa forma reemplaza). *Exactas* = el match tiene el mismo tramo y el mismo tipo que la verdad. *Parcial* = solapa una verdad del mismo tipo con otro tramo. *Otro tipo* = solapa una verdad de otro tipo. *FP negativo* = el match cae sobre un negativo anotado; *FP texto* = cae en texto corriente sin verdad ni negativo. *Solapa* = match parcial o de otro tipo sobre una verdad.

### CL

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cl:rut` | DNI | control | núcleo | 34 | 34 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 0 | 18/18 | 10/10 | 6/6 |
| `cl:rut-ctx` | DNI | structure+context | núcleo | 13 | 9 | 69.2 % | 0 | 0 | 4 | 0 | 0 de 59 | 0 | 21 | 6/10 | 3/3 | - |
| `cl:phone-mobile` | PHONE | structure | núcleo | 11 | 11 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 1 | 0 | 7/7 | 2/2 | 2/2 |
| `cl:phone-mobile-parentesis` | PHONE | structure | opcional | 1 | 1 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 0 | 1/1 | - | - |
| `cl:phone-mobile-ctx` | PHONE | structure+context | núcleo | 7 | 7 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 0 | 4/4 | 2/2 | 1/1 |
| `cl:phone-landline` | PHONE | control | núcleo | 11 | 11 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 0 | 8/8 | 2/2 | 1/1 |
| `cl:plate-4l2d` | PLATE | control | núcleo | 13 | 13 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 0 | 6/6 | 2/2 | 5/5 |
| `cl:plate-4l2d-ctx` | PLATE | structure+context | núcleo | 6 | 6 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 0 | 9 | 3/3 | 3/3 | - |
| `cl:plate-2l4d` | PLATE | structure | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 59 | 3 | 0 | 4/4 | - | 4/4 |
| `cl:plate-moto-3l2d` | PLATE | structure+context | núcleo | 10 | 6 | 60.0 % | 0 | 0 | 4 | 0 | 0 de 59 | 0 | 0 | 3/5 | 2/4 | 1/1 |
| `cl:plate-moto-2l3d` | PLATE | structure | núcleo | 6 | 6 | 100.0 % | 0 | 0 | 0 | 1 | 0 de 59 | 0 | 0 | 3/3 | 2/2 | 1/1 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `cl:rut` | cuerpo 7 dígitos | 2 | 2 | 0 | 0 |
| `cl:rut` | dv-K | 2 | 2 | 0 | 0 |
| `cl:rut` | dv-k-minuscula | 2 | 2 | 0 | 0 |
| `cl:rut` | empresa | 3 | 3 | 0 | 0 |
| `cl:rut` | puntos+guion | 15 | 15 | 0 | 0 |
| `cl:rut` | sin puntos | 10 | 10 | 0 | 0 |
| `cl:rut-ctx` | dv-errado | 3 | 3 | 0 | 0 |
| `cl:rut-ctx` | espacio-DV con RUN | 2 | 2 | 0 | 0 |
| `cl:rut-ctx` | espacio-DV | 2 | 0 | 0 | 2 |
| `cl:rut-ctx` | pegado | 2 | 0 | 0 | 2 |
| `cl:rut-ctx` | sin guion con RUT | 2 | 2 | 0 | 0 |
| `cl:rut-ctx` | sin guion con RUT: | 2 | 2 | 0 | 0 |
| `cl:phone-mobile` | +56 9 4+4 | 3 | 3 | 0 | 0 |
| `cl:phone-mobile` | +569 8 | 2 | 2 | 0 | 0 |
| `cl:phone-mobile` | +56987654321 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile` | 56 9 4+4 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile` | 9 4+4 | 3 | 3 | 0 | 0 |
| `cl:phone-mobile` | 9-4-4 | 1 | 1 | 0 | 0 |
| `cl:phone-mobile-parentesis` | (+56) | 1 | 1 | 0 | 0 |
| `cl:phone-mobile-ctx` | pelado con Cel. | 2 | 2 | 0 | 0 |
| `cl:phone-mobile-ctx` | pelado con Tel. | 2 | 2 | 0 | 0 |
| `cl:phone-mobile-ctx` | pelado | 3 | 3 | 0 | 0 |
| `cl:phone-landline` | (02) | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | (32) 7 | 5 | 5 | 0 | 0 |
| `cl:phone-landline` | +56 41 7 | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | 2+8 con prefijo | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | 22 3+4 | 1 | 1 | 0 | 0 |
| `cl:phone-landline` | 29 345 6789 (2+9, 1+3+4) | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d` | 4l2d con punto | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d` | 4l2d | 7 | 7 | 0 | 0 |
| `cl:plate-4l2d` | BC.DF.12 con patente | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d` | BC.DF.12 | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d-ctx` | otras letras (A, E, I, O) | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d-ctx` | otras letras (M, N, Q, A) | 2 | 2 | 0 | 0 |
| `cl:plate-4l2d-ctx` | otras letras con punto | 2 | 2 | 0 | 0 |
| `cl:plate-2l4d` | 2l4d con puntos | 2 | 2 | 0 | 0 |
| `cl:plate-2l4d` | 2l4d | 6 | 6 | 0 | 0 |
| `cl:plate-moto-3l2d` | moto 3l2d con dominio | 2 | 2 | 0 | 0 |
| `cl:plate-moto-3l2d` | moto 3l2d con placa | 2 | 2 | 0 | 0 |
| `cl:plate-moto-3l2d` | moto 3l2d | 6 | 2 | 0 | 4 |
| `cl:plate-moto-2l3d` | moto 2l3d | 6 | 6 | 0 | 0 |

### UY

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `uy:ci` | DNI | structure | núcleo | 19 | 19 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 10/10 | 5/5 | 4/4 |
| `uy:ci-digitos` | DNI | control | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 6/6 | 1/1 | 2/2 |
| `uy:ci-guion` | DNI | control | opcional | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 4/4 | - | - |
| `uy:ci-guion-sc` | DNI | structure | alternativa de `uy:ci-guion` | 4 | 4 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 4/4 | - | - |
| `uy:ci-sindv-ctx` | DNI | structure+context | núcleo | 16 | 14 | 87.5 % | 0 | 0 | 2 | 0 | 0 de 48 | 18 | 0 | 8/10 | 2/2 | 4/4 |
| `uy:rut` | CUIT | control | núcleo | 9 | 9 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 5/5 | 3/3 | 1/1 |
| `uy:rut-separado` | CUIT | structure | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 4/4 | 3/3 | 1/1 |
| `uy:phone-mobile` | PHONE | control | núcleo | 14 | 14 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 9/9 | 2/2 | 3/3 |
| `uy:phone-landline` | PHONE | control | núcleo | 10 | 10 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 7/7 | 1/1 | 2/2 |
| `uy:plate` | PLATE | structure+context | núcleo | 17 | 7 | 41.2 % | 0 | 0 | 10 | 0 | 0 de 48 | 0 | 0 | 3/8 | 1/2 | 3/7 |
| `uy:plate-moto` | PLATE | structure+context | núcleo | 8 | 2 | 25.0 % | 0 | 0 | 6 | 0 | 0 de 48 | 0 | 0 | 1/4 | - | 1/4 |
| `uy:account-brou` | BANK_ACCOUNT | structure | núcleo | 7 | 7 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 48 | 0 | 0 | 4/4 | 2/2 | 1/1 |

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
| `uy:ci-sindv-ctx` | 6 dígitos sin DV con Documento | 2 | 2 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV con C.I. | 2 | 2 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV con CI | 2 | 2 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV con contexto | 6 | 6 | 0 | 0 |
| `uy:ci-sindv-ctx` | sin DV con cédula de identidad | 2 | 2 | 0 | 0 |
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
| `uy:plate` | 3l4d con matrícula | 2 | 2 | 0 | 0 |
| `uy:plate` | 3l4d con patente | 2 | 2 | 0 | 0 |
| `uy:plate` | 3l4d | 13 | 3 | 0 | 10 |
| `uy:plate-moto` | 3l3d con placa | 2 | 2 | 0 | 0 |
| `uy:plate-moto` | 3l3d | 6 | 0 | 0 | 6 |
| `uy:account-brou` | 9+5 | 7 | 7 | 0 | 0 |

### PY

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `py:ci` | DNI | structure+context | núcleo | 23 | 13 | 56.5 % | 0 | 0 | 10 | 0 | 0 de 43 | 0 | 0 | 6/11 | 5/9 | 2/3 |
| `py:ci-ctx` | DNI | structure+context | núcleo | 14 | 14 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 43 | 0 | 0 | 7/7 | 6/6 | 1/1 |
| `py:ruc` | CUIT | control | núcleo | 21 | 21 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 43 | 0 | 0 | 13/13 | 6/6 | 2/2 |
| `py:phone-mobile` | PHONE | control | núcleo | 16 | 14 | 87.5 % | 0 | 0 | 2 | 0 | 0 de 43 | 0 | 0 | 9/10 | 2/2 | 3/4 |
| `py:phone-landline` | PHONE | control | núcleo | 10 | 10 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 43 | 0 | 0 | 8/8 | 2/2 | - |
| `py:plate-3l3d` | PLATE | structure+context | núcleo | 6 | 2 | 33.3 % | 0 | 0 | 4 | 0 | 0 de 43 | 0 | 0 | 1/3 | 1/1 | 0/2 |
| `py:plate-moto-3d3l` | PLATE | structure+context | núcleo | 6 | 2 | 33.3 % | 0 | 0 | 4 | 0 | 0 de 43 | 0 | 0 | 1/3 | 1/1 | 0/2 |
| `py:plate-mercosur` | PLATE | structure+context | núcleo | 11 | 5 | 45.5 % | 0 | 0 | 6 | 0 | 0 de 43 | 0 | 0 | 2/5 | 2/2 | 1/4 |
| `py:plate-moto-mercosur` | PLATE | structure | núcleo | 4 | 4 | 100.0 % | 0 | 0 | 0 | 1 | 0 de 43 | 0 | 0 | 2/2 | - | 2/2 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `py:ci` | 6 dígitos con Cédula | 2 | 2 | 0 | 0 |
| `py:ci` | 6 dígitos | 2 | 0 | 0 | 2 |
| `py:ci` | con CIC | 2 | 2 | 0 | 0 |
| `py:ci` | con puntos | 17 | 9 | 0 | 8 |
| `py:ci-ctx` | C.I. + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | C.I.: + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | CI: + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | CIC + número | 2 | 2 | 0 | 0 |
| `py:ci-ctx` | cédula + número | 4 | 4 | 0 | 0 |
| `py:ci-ctx` | cédula de identidad + número | 2 | 2 | 0 | 0 |
| `py:ruc` | 6 dígitos | 1 | 1 | 0 | 0 |
| `py:ruc` | cuerpo-DV | 7 | 7 | 0 | 0 |
| `py:ruc` | cédula con puntos + DV | 4 | 4 | 0 | 0 |
| `py:ruc` | empresa | 1 | 1 | 0 | 0 |
| `py:ruc` | persona física | 8 | 8 | 0 | 0 |
| `py:phone-mobile` | (0981) | 2 | 2 | 0 | 0 |
| `py:phone-mobile` | +595 3+3 | 2 | 2 | 0 | 0 |
| `py:phone-mobile` | +595 981 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | +595 sin sep | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0981 3+3 | 5 | 5 | 0 | 0 |
| `py:phone-mobile` | 0981-123-456 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0981123456 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | 0991-3+3 | 1 | 1 | 0 | 0 |
| `py:phone-mobile` | sin 0 | 2 | 0 | 0 | 2 |
| `py:phone-landline` | (021) | 1 | 1 | 0 | 0 |
| `py:phone-landline` | +595 21 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | +595 61 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | 021 3+4 | 5 | 5 | 0 | 0 |
| `py:phone-landline` | 0541 3+3 | 1 | 1 | 0 | 0 |
| `py:phone-landline` | 061 3+4 | 1 | 1 | 0 | 0 |
| `py:plate-3l3d` | 3l3d con chapa | 2 | 2 | 0 | 0 |
| `py:plate-3l3d` | 3l3d | 4 | 0 | 0 | 4 |
| `py:plate-moto-3d3l` | 3d3l con guion | 2 | 0 | 0 | 2 |
| `py:plate-moto-3d3l` | 3d3l con patente | 2 | 2 | 0 | 0 |
| `py:plate-moto-3d3l` | 3d3l | 2 | 0 | 0 | 2 |
| `py:plate-mercosur` | 4l3d con placa | 2 | 2 | 0 | 0 |
| `py:plate-mercosur` | 4l3d sin sep | 2 | 0 | 0 | 2 |
| `py:plate-mercosur` | 4l3d | 7 | 3 | 0 | 4 |
| `py:plate-moto-mercosur` | 3d4l con guion | 2 | 2 | 0 | 0 |
| `py:plate-moto-mercosur` | 3d4l | 2 | 2 | 0 | 0 |

### BO

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `bo:ci-ext` | DNI | control | núcleo | 29 | 29 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 46 | 0 | 0 | 14/14 | 12/12 | 3/3 |
| `bo:ci-ctx` | DNI | structure+context | núcleo | 9 | 8 | 88.9 % | 0 | 0 | 1 | 0 | 0 de 46 | 16 | 0 | 5/6 | - | 3/3 |
| `bo:nit-ctx` | CUIT | structure+context | núcleo | 20 | 17 | 85.0 % | 0 | 0 | 3 | 4 | 2 de 46 | 0 | 0 | 11/13 | 4/4 | 2/3 |
| `bo:phone-mobile` | PHONE | control | núcleo | 13 | 13 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 46 | 0 | 0 | 8/8 | 1/1 | 4/4 |
| `bo:phone-landline` | PHONE | control | núcleo | 8 | 8 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 46 | 0 | 0 | 6/6 | 2/2 | - |
| `bo:plate` | PLATE | structure+context | núcleo | 23 | 11 | 47.8 % | 0 | 0 | 12 | 0 | 0 de 46 | 0 | 0 | 5/11 | 1/2 | 5/10 |

Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):

| Forma | Escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|---|
| `bo:ci-ext` | 6 dígitos | 2 | 2 | 0 | 0 |
| `bo:ci-ext` | extensión con puntos | 1 | 1 | 0 | 0 |
| `bo:ci-ext` | mismo número que otra persona | 4 | 4 | 0 | 0 |
| `bo:ci-ext` | número + extensión | 22 | 22 | 0 | 0 |
| `bo:ci-ctx` | pelado con C.I. | 2 | 2 | 0 | 0 |
| `bo:ci-ctx` | pelado con contexto | 5 | 4 | 0 | 1 |
| `bo:ci-ctx` | pelado con cédula de identidad | 2 | 2 | 0 | 0 |
| `bo:nit-ctx` | N.I.T. + número | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | NIT + 2 palabras | 2 | 2 | 0 | 0 |
| `bo:nit-ctx` | NIT + 4 palabras (más de 3) | 2 | 0 | 0 | 2 |
| `bo:nit-ctx` | NIT + número | 3 | 3 | 0 | 0 |
| `bo:nit-ctx` | NIT + palabras + número | 7 | 7 | 0 | 0 |
| `bo:nit-ctx` | NIT 12 dígitos + palabras | 2 | 2 | 0 | 0 |
| `bo:nit-ctx` | NIT corto (5) | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | NIT: + número | 1 | 1 | 0 | 0 |
| `bo:nit-ctx` | segundo NIT de una lista | 1 | 0 | 0 | 1 |
| `bo:phone-mobile` | (591) | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | +591 7 3+4 | 1 | 1 | 0 | 0 |
| `bo:phone-mobile` | +591 71234567 | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 591- | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 6234 5678 | 2 | 2 | 0 | 0 |
| `bo:phone-mobile` | 7123 4567 | 4 | 4 | 0 | 0 |
| `bo:phone-landline` | (2) 3+4 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | (4) 3+4 | 3 | 3 | 0 | 0 |
| `bo:phone-landline` | +591 2 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | +591 3 | 1 | 1 | 0 | 0 |
| `bo:phone-landline` | 2 7 | 2 | 2 | 0 | 0 |
| `bo:plate` | 3d3l con patente | 2 | 2 | 0 | 0 |
| `bo:plate` | 3d3l sin sep | 2 | 0 | 0 | 2 |
| `bo:plate` | 3d3l | 2 | 0 | 0 | 2 |
| `bo:plate` | 4d3l con dominio | 2 | 2 | 0 | 0 |
| `bo:plate` | 4d3l con placa | 2 | 2 | 0 | 0 |
| `bo:plate` | 4d3l sin sep | 2 | 0 | 0 | 2 |
| `bo:plate` | 4d3l | 11 | 5 | 0 | 6 |

### AR

| Forma | Tipo | Clase | Rol | Esperadas | Exactas | Recall | Parcial | Otro tipo | Perdidas | FP (todas las copias) | FP (corpus normal) de negativos | Solapa | TP de otra forma | Exactas normal | Exactas MAYÚS | Exactas minús |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ar:cbu` | BANK_ACCOUNT | control | núcleo | 33 | 33 | 100.0 % | 0 | 0 | 0 | 0 | 0 de 21 | 0 | 0 | 18/18 | 15/15 | - |
| `ar:passport` | PASSPORT | structure+context | núcleo | 27 | 10 | 37.0 % | 0 | 0 | 17 | 2 | 1 de 21 | 0 | 0 | 5/14 | 3/3 | 2/10 |

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
| `ar:passport` | 3l6d con Pasaporte | 2 | 2 | 0 | 0 |
| `ar:passport` | 3l6d con Pasaporte: | 2 | 2 | 0 | 0 |
| `ar:passport` | 3l6d con espacio | 7 | 2 | 0 | 5 |
| `ar:passport` | 3l6d con guion | 6 | 2 | 0 | 4 |
| `ar:passport` | 3l6d pegado con pasaporte | 2 | 2 | 0 | 0 |
| `ar:passport` | 3l6d pegado | 6 | 0 | 0 | 6 |
| `ar:passport` | ZZX (refugiados, sin confirmar) | 2 | 0 | 0 | 2 |

## 3b. Verdades cuya forma ya no existe (decisiones del mantenedor)

Las formas `*-pegado` (teléfonos de 8 dígitos sin separadores de UY y BO) y el complemento de la CI boliviana no entran (Plan §5). Las verdades del corpus que las escribían **se quedan** y se miden contra las formas que sí entran: lo que tapan por casualidad y lo que dejan a la vista.

| País | Forma (sin formato) | N | Tapadas enteras | Parcial u otro tipo | A la vista | Ejemplos |
|---|---|---|---|---|---|---|
| UY | `uy:phone-landline-pegado` | 2 | 0 | 0 | 2 | «29012345», «43321234» |
| BO | `bo:ci-complemento` | 3 | 0 | 0 | 3 | «1234567-1A CB», «7654321-1A» |
| BO | `bo:phone-landline-pegado` | 1 | 0 | 0 | 1 | «22123456» |
| BO | `bo:phone-mobile-pegado` | 4 | 0 | 0 | 4 | «71234567», «62345678» |

## 4. Combinaciones: núcleo, núcleo más cada forma opcional, completo

País activo = las formas del país más los universales (email, IBAN, tarjeta, fecha, fecha en texto, carátula, dirección), con control, guarda y prioridad del match más largo entre formatos base (caso 10). *Núcleo* = las formas no opcionales. *Alcance* = las verdades cuya forma está en la combinación. FP país / FP universal se separan por el origen del match. Δ = cambio contra el núcleo (exactas y FP del país). La fila «en lugar de» reemplaza la forma que dice la alternativa.

### CL

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 119 | 111 | 93.3 % | 0 | 8 | 1 | 0 | 0 | 0 | 3 | 0/1 | +0 | +0 |
| núcleo + `cl:phone-mobile-parentesis` | 120 | 112 | 93.3 % | 0 | 8 | 1 | 0 | 0 | 0 | 2 | 0/0 | +1 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 120 | 112 | 93.3 % | 0 | 8 | 1 | 0 | 0 | 0 | 2 | 0/0 | +1 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Núñez, Camila» sobre «Barría Núñez, Camila» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): ninguno.

Con «completo»: entidades P que no se tapan enteras (corpus normal): «PRS 45» (cl:plate-moto-3l2d, moto 3l2d; nada); «JKL90» (cl:plate-moto-3l2d, moto 3l2d; nada); «135792462» (cl:rut-ctx, pegado; nada); «76543216» (cl:rut-ctx, pegado; nada); «18.437.210 K» (cl:rut-ctx, espacio-DV; nada); «24.581.396 1» (cl:rut-ctx, espacio-DV; nada).

### UY

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 117 | 99 | 84.6 % | 0 | 18 | 0 | 0 | 0 | 0 | 4 | 0/6 | +0 | +0 |
| núcleo + `uy:ci-guion` | 121 | 103 | 85.1 % | 0 | 18 | 0 | 0 | 0 | 0 | 4 | 0/2 | +4 | +0 |
| núcleo con `uy:ci-guion-sc` en lugar de `uy:ci-guion` | 121 | 103 | 85.1 % | 0 | 18 | 0 | 0 | 0 | 0 | 4 | 0/2 | +4 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 121 | 103 | 85.1 % | 0 | 18 | 0 | 0 | 0 | 0 | 4 | 0/2 | +4 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Techera, Martín» sobre «Rodríguez Techera, Martín» (universal); `address-keyword-ar` «Ruta 8» sobre «Ruta 8 km 17» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): ninguno.

Con «completo»: entidades P que no se tapan enteras (corpus normal): «HAA1000» (uy:plate, 3l4d; nada); «ABC-1234» (uy:plate, 3l4d; nada); «BAE 567» (uy:plate-moto, 3l3d; nada); «SDE 4321» (uy:plate, 3l4d; nada); «KLM9087» (uy:plate, 3l4d; nada); «ABC 123» (uy:plate-moto, 3l3d; nada); «XYZ-456» (uy:plate-moto, 3l3d; nada); «SBC 4567» (uy:plate, 3l4d; nada); «5.678.901» (uy:ci-sindv-ctx, sin DV sin contexto; nada); «6.789.012» (uy:ci-sindv-ctx, sin DV sin contexto; nada).

### PY

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 111 | 85 | 76.6 % | 0 | 26 | 1 | 0 | 0 | 0 | 2 | 0/0 | +0 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 111 | 85 | 76.6 % | 0 | 26 | 1 | 0 | 0 | 0 | 2 | 0/0 | +0 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Ortiz, Carlos» sobre «Villalba Ortiz, Carlos» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): ninguno.

Con «completo»: entidades P que no se tapan enteras (corpus normal): «1.234.567» (py:ci, con puntos; nada); «2.345.678» (py:ci, con puntos; nada); «987.654» (py:ci, 6 dígitos; nada); «ABC 123» (py:plate-3l3d, 3l3d; nada); «HJK-456» (py:plate-3l3d, 3l3d; nada); «ABCD 123» (py:plate-mercosur, 4l3d; nada); «BCDF123» (py:plate-mercosur, 4l3d sin sep; nada); «HJKL 456» (py:plate-mercosur, 4l3d; nada); «123 ABC» (py:plate-moto-3d3l, 3d3l; nada); «456-DEF» (py:plate-moto-3d3l, 3d3l con guion; nada); «981 123 456» (py:phone-mobile, sin 0; nada); «5.123.456» (py:ci, con puntos; nada); «6.123.450» (py:ci, con puntos; nada).

### BO

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 102 | 86 | 84.3 % | 0 | 16 | 4 | 0 | 0 | 0 | 2 | 0/8 | +0 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 102 | 86 | 84.3 % | 0 | 16 | 4 | 0 | 0 | 0 | 2 | 0/8 | +0 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): `caratula-ar` «Vargas, Pedro» sobre «Choque Vargas, Pedro» (universal).

Con «completo»: falsos positivos (corpus normal, sin repetir): `bo:nit-ctx` «1234567»; `bo:nit-ctx` «7654321».

Con «completo»: entidades P que no se tapan enteras (corpus normal): «6400-DEF» (bo:plate, 4d3l; nada); «2345 XYZ» (bo:plate, 4d3l; nada); «1234ABC» (bo:plate, 4d3l sin sep; nada); «123-ABC» (bo:plate, 3d3l; nada); «987ABC» (bo:plate, 3d3l sin sep; nada); «2345678» (bo:ci-ctx, pelado con contexto; nada); «4012345679» (bo:nit-ctx, segundo NIT de una lista; nada); «4567-KLM» (bo:plate, 4d3l; nada); «1020304051» (bo:nit-ctx, NIT + 4 palabras (más de 3); nada).

### AR

| Combinación | En alcance | Exactas | Recall | Parcial u otro tipo | Perdidas | FP país neg. | FP país texto | FP univ. neg. | FP univ. texto | Matches que solapan una verdad sin acertar | Fuera de alcance (exactas/total) | Δ exactas | Δ FP país |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| núcleo | 60 | 43 | 71.7 % | 0 | 17 | 2 | 0 | 0 | 0 | 0 | 0/22 | +0 | +0 |
| completo (núcleo + todas las opcionales, sin alternativas) | 60 | 43 | 71.7 % | 0 | 17 | 2 | 0 | 0 | 0 | 0 | 0/22 | +0 | +0 |

Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): ninguno.

Con «completo»: falsos positivos (corpus normal, sin repetir): `ar:passport` «NRO 123456».

Con «completo»: entidades P que no se tapan enteras (corpus normal): «ABC987654» (ar:passport, 3l6d pegado; nada); «ZZX000123» (ar:passport, ZZX (refugiados, sin confirmar); nada); «MNP 112233» (ar:passport, 3l6d con espacio; nada); «RST-445566» (ar:passport, 3l6d con guion; nada); «HJK778899» (ar:passport, 3l6d pegado; nada); «DEF 123456» (ar:passport, 3l6d con espacio; nada); «GHI-654321» (ar:passport, 3l6d con guion; nada); «PQR246810» (ar:passport, 3l6d pegado; nada); «STU 335577» (ar:passport, 3l6d con espacio; nada).

## 5. Choques

### 5.1 El catálogo argentino vigente (AR activo) sobre cada corpus

Se corren los quince patrones de `DEFAULT_PATTERNS_AR` (`BASE_CATALOG` del motor) tal como están, con su checksum, la guarda de corrida y el match más largo. Lo que importa: qué tapa AR de los datos del país (y si lo tapa entero), y qué tapa de más.

#### AR activo sobre el corpus de CL

Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.

| Forma de la verdad | N | AR exacta | AR parcial | AR otro tipo | AR no emite | Patrones AR que intervienen |
|---|---|---|---|---|---|---|
| `cl:phone-landline` | 11 | 0 | 0 | 4 | 7 | dni-ar: 4 |
| `cl:phone-mobile` | 11 | 0 | 0 | 2 | 9 | dni-ar: 2 |
| `cl:phone-mobile-ctx` | 7 | 0 | 0 | 0 | 7 |  |
| `cl:phone-mobile-parentesis` | 1 | 0 | 0 | 0 | 1 |  |
| `cl:plate-2l4d` | 8 | 0 | 0 | 0 | 8 |  |
| `cl:plate-4l2d` | 13 | 0 | 0 | 0 | 13 |  |
| `cl:plate-4l2d-ctx` | 6 | 0 | 0 | 0 | 6 |  |
| `cl:plate-moto-2l3d` | 6 | 0 | 0 | 0 | 6 |  |
| `cl:plate-moto-3l2d` | 10 | 0 | 0 | 0 | 10 |  |
| `cl:rut` | 34 | 0 | 24 | 0 | 10 | dni-ar: 24 |
| `cl:rut-ctx` | 13 | 3 | 7 | 0 | 3 | dni-ar: 10 |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `cuit-ar` | 2 | 0 | 0 | 0 | 2 | 0 |
| `date-ar` | 15 | 15 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `dni-ar` | 63 | 3 | 31 | 6 | 23 | 0 |
| `phone-mobile-ar` | 1 | 0 | 0 | 0 | 1 | 0 |
| `plate-vieja-ar` | 1 | 0 | 0 | 0 | 1 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 39; se listan 14):

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
| `uy:ci-sindv-ctx` | 16 | 14 | 0 | 0 | 2 | dni-ar: 14 |
| `uy:phone-landline` | 10 | 0 | 0 | 0 | 10 |  |
| `uy:phone-landline-pegado` | 2 | 0 | 0 | 2 | 0 | dni-ar: 2 |
| `uy:phone-mobile` | 14 | 4 | 0 | 0 | 10 | phone-landline-ar: 4 |
| `uy:plate` | 17 | 0 | 0 | 0 | 17 |  |
| `uy:plate-moto` | 8 | 8 | 0 | 0 | 0 | plate-vieja-ar: 8 |
| `uy:rut` | 9 | 0 | 0 | 0 | 9 |  |
| `uy:rut-separado` | 8 | 0 | 0 | 0 | 8 |  |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 12 | 10 | 2 | 0 | 0 | 0 |
| `caratula-ar` | 3 | 1 | 2 | 0 | 0 | 0 |
| `date-ar` | 12 | 12 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 9 | 9 | 0 | 0 | 0 | 0 |
| `dni-ar` | 77 | 23 | 21 | 2 | 31 | 0 |
| `phone-landline-ar` | 11 | 4 | 0 | 7 | 0 | 0 |
| `plate-vieja-ar` | 12 | 8 | 0 | 0 | 4 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 34; se listan 14):

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
| `py:ci` | 23 | 19 | 0 | 0 | 4 | dni-ar: 19 |
| `py:ci-ctx` | 14 | 12 | 0 | 0 | 2 | dni-ar: 12 |
| `py:phone-landline` | 10 | 6 | 0 | 0 | 4 | phone-mobile-ar: 6 |
| `py:phone-mobile` | 16 | 1 | 0 | 0 | 15 | phone-mobile-ar: 1 |
| `py:plate-3l3d` | 6 | 6 | 0 | 0 | 0 | plate-vieja-ar: 6 |
| `py:plate-mercosur` | 11 | 0 | 0 | 0 | 11 |  |
| `py:plate-moto-3d3l` | 6 | 0 | 0 | 0 | 6 |  |
| `py:plate-moto-mercosur` | 4 | 0 | 0 | 0 | 4 |  |
| `py:ruc` | 21 | 0 | 0 | 20 | 1 | dni-ar: 20 |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 8 | 8 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `date-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 7 | 7 | 0 | 0 | 0 | 0 |
| `dni-ar` | 76 | 31 | 0 | 20 | 25 | 0 |
| `phone-mobile-ar` | 10 | 7 | 0 | 0 | 3 | 0 |
| `plate-vieja-ar` | 18 | 6 | 0 | 0 | 12 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 26; se listan 14):

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
| `bo:ci-complemento` | 3 | 0 | 0 | 0 | 3 |  |
| `bo:ci-ctx` | 9 | 9 | 0 | 0 | 0 | dni-ar: 9 |
| `bo:ci-ext` | 29 | 0 | 27 | 0 | 2 | dni-ar: 27 |
| `bo:nit-ctx` | 20 | 0 | 0 | 17 | 3 | phone-mobile-ar: 17 |
| `bo:phone-landline` | 8 | 0 | 0 | 6 | 2 | dni-ar: 6 |
| `bo:phone-landline-pegado` | 1 | 0 | 0 | 1 | 0 | dni-ar: 1 |
| `bo:phone-mobile` | 13 | 0 | 0 | 2 | 11 | dni-ar: 2 |
| `bo:phone-mobile-pegado` | 4 | 0 | 0 | 4 | 0 | dni-ar: 4 |
| `bo:plate` | 23 | 0 | 0 | 0 | 23 |  |

Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):

| Patrón AR | Emite | TP exacto | Parcial | Otro tipo | FP negativo | FP texto |
|---|---|---|---|---|---|---|
| `address-keyword-ar` | 10 | 10 | 0 | 0 | 0 | 0 |
| `caratula-ar` | 2 | 0 | 2 | 0 | 0 | 0 |
| `date-ar` | 11 | 11 | 0 | 0 | 0 | 0 |
| `date-textual-ar` | 7 | 7 | 0 | 0 | 0 | 0 |
| `dni-ar` | 70 | 9 | 27 | 13 | 21 | 0 |
| `phone-mobile-ar` | 18 | 0 | 0 | 17 | 1 | 0 |
| `plate-vieja-ar` | 6 | 0 | 0 | 0 | 6 | 0 |

Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: 39; se listan 14):

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
| `ar:passport` | 27 | 0 | 0 | 0 | 27 |  |
| `ar:phone-landline-ar` | 4 | 4 | 0 | 0 | 0 | phone-landline-ar: 4 |
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
| `phone-landline-ar` | 13 | 4 | 0 | 8 | 1 | 0 |
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
| `cl:rut-ctx` | núcleo | 0 | 0 | 0 |
| `cl:phone-mobile` | núcleo | 0 | 0 | 0 |
| `cl:phone-mobile-parentesis` | opcional | 0 | 0 | 0 |
| `cl:phone-mobile-ctx` | núcleo | 0 | 0 | 0 |
| `cl:phone-landline` | núcleo | 0 | 0 | 0 |
| `cl:plate-4l2d` | núcleo | 0 | 0 | 0 |
| `cl:plate-4l2d-ctx` | núcleo | 0 | 0 | 0 |
| `cl:plate-2l4d` | núcleo | 1 | 0 | 1 |
| `cl:plate-moto-3l2d` | núcleo | 0 | 0 | 0 |
| `cl:plate-moto-2l3d` | núcleo | 4 | 4 | 0 |
| `uy:ci` | núcleo | 0 | 0 | 0 |
| `uy:ci-digitos` | núcleo | 0 | 0 | 0 |
| `uy:ci-guion` | opcional | 0 | 0 | 0 |
| `uy:ci-sindv-ctx` | núcleo | 0 | 0 | 0 |
| `uy:rut` | núcleo | 0 | 0 | 0 |
| `uy:rut-separado` | núcleo | 0 | 0 | 0 |
| `uy:phone-mobile` | núcleo | 0 | 0 | 0 |
| `uy:phone-landline` | núcleo | 8 | 6 | 2 |
| `uy:plate` | núcleo | 0 | 0 | 0 |
| `uy:plate-moto` | núcleo | 1 | 0 | 0 |
| `uy:account-brou` | núcleo | 0 | 0 | 0 |
| `py:ci` | núcleo | 0 | 0 | 0 |
| `py:ci-ctx` | núcleo | 0 | 0 | 0 |
| `py:ruc` | núcleo | 2 | 0 | 2 |
| `py:phone-mobile` | núcleo | 0 | 0 | 0 |
| `py:phone-landline` | núcleo | 0 | 0 | 0 |
| `py:plate-3l3d` | núcleo | 1 | 0 | 0 |
| `py:plate-moto-3d3l` | núcleo | 0 | 0 | 0 |
| `py:plate-mercosur` | núcleo | 0 | 0 | 0 |
| `py:plate-moto-mercosur` | núcleo | 0 | 0 | 0 |
| `bo:ci-ext` | núcleo | 0 | 0 | 0 |
| `bo:ci-ctx` | núcleo | 0 | 0 | 0 |
| `bo:nit-ctx` | núcleo | 0 | 0 | 0 |
| `bo:phone-mobile` | núcleo | 3 | 3 | 0 |
| `bo:phone-landline` | núcleo | 0 | 0 | 0 |
| `bo:plate` | núcleo | 0 | 0 | 0 |
| `ar:cbu` | núcleo | 0 | 0 | 0 |
| `ar:passport` | núcleo | 0 | 0 | 0 |

Muestras (hasta 3 por forma):

- `cl:rut` emite «09082125-3» en `doc-005-p0`: solapa «23-09082125-3» (CUIT).
- `cl:plate-2l4d` emite «PP-13-00» en `doc-013-p0`: sin verdad.
- `cl:plate-moto-2l3d` emite «DA 004» en `doc-003-p1`: solapa «DA 004 DD» (PLATE).
- `cl:plate-moto-2l3d` emite «VH 765» en `doc-005-p1`: solapa «VH 765 FC» (PLATE).
- `cl:plate-moto-2l3d` emite «AB 123» en `doc-023-p0`: solapa «AB 123 CD» (PLATE).
- `uy:phone-landline` emite «2637-6255» en `doc-005-p0`: solapa «+54 11 2637-6255» (PHONE).
- `uy:phone-landline` emite «4454-3477» en `doc-009-p0`: solapa «+54 11 4454-3477» (PHONE).
- `uy:phone-landline` emite «4532 1234» en `doc-017-p0`: sin verdad.
- `uy:plate-moto` emite «ABC 123» en `doc-023-p0`: solapa «ABC 123» (PLATE).
- `py:ruc` emite «12345678-9» en `doc-016-p0`: sin verdad.
- `py:plate-3l3d` emite «ABC 123» en `doc-023-p0`: solapa «ABC 123» (PLATE).
- `bo:phone-mobile` emite «7210-3598» en `doc-001-p1`: solapa «+54 11 7210-3598» (PHONE).
- `bo:phone-mobile` emite «7068 9876» en `doc-022-p0`: solapa «ES05 7068 9876 9644 6251 9569» (IBAN).
- `bo:phone-mobile` emite «6251 9569» en `doc-022-p0`: solapa «ES05 7068 9876 9644 6251 9569» (IBAN).

Todas las formas nuevas juntas (39 formas, con prioridad del match más largo): 20 matches; 14 solapan una verdad argentina; 5 caen en texto sin verdad.

### 5.3 Las formas nuevas de AR (CBU/CVU y pasaporte) junto al catálogo argentino

Con AR activo, las formas nuevas se suman al catálogo. Recall de cada forma sola y con el catálogo argentino al lado (prioridad del match más largo, caso 10):

| Forma | Esperadas | Exactas (sola) | Exactas (con catálogo AR) | Parcial | Otro tipo | Perdidas |
|---|---|---|---|---|---|---|
| `ar:cbu` | 33 | 33 (100.0 %) | 33 (100.0 %) | 0 | 0 | 0 |
| `ar:passport` | 27 | 10 (37.0 %) | 10 (37.0 %) | 0 | 0 | 17 |

Matches (de todo el conjunto AR + nuevas, corpus normal, sin repetir) que no aciertan una verdad: 3.

- `dni-ar` emite «20250123» en `ar-01-transferencia` → fp-neg.
- `phone-landline-ar` emite «0001-00001234» en `ar-03-contrato` → fp-neg.
- `ar:passport` emite «NRO 123456» en `ar-04-segunda-medicion` → fp-neg.

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
| DATE / numerica | 14 | 14 | 0 | 0 |
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

Total U: 45; exactas 37 (82.2 %); parcial u otro tipo 2; perdidas 6. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### UY

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avenida | 4 | 4 | 0 | 0 |
| ADDRESS / bv | 3 | 3 | 0 | 0 |
| ADDRESS / calle | 3 | 3 | 0 | 0 |
| ADDRESS / ruta | 2 | 0 | 2 | 0 |
| DATE / numerica | 11 | 11 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / texto | 7 | 7 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / apellido-simple | 2 | 1 | 0 | 1 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Rodríguez Techera, Martín» (normal): se detecta «Techera, Martín» (`caratula-ar`), no el tramo entero.
- ADDRESS / ruta «Ruta 8 km 17» (normal): se detecta «Ruta 8» (`address-keyword-ar`), no el tramo entero.
- PERSON / apellido-simple «GÓMEZ, MARTA» (mayus): no se detecta.

Total U: 37; exactas 32 (86.5 %); parcial u otro tipo 4; perdidas 1. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### PY

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avda | 4 | 4 | 0 | 0 |
| ADDRESS / calle | 4 | 4 | 0 | 0 |
| ADDRESS / esquina | 1 | 0 | 0 | 1 |
| ADDRESS / ruta | 1 | 0 | 0 | 1 |
| DATE / numerica | 10 | 10 | 0 | 0 |
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

Total U: 32; exactas 26 (81.3 %); parcial u otro tipo 2; perdidas 4. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

### BO

| Tipo / escritura | N | Exactas | Parcial u otro tipo | Perdidas |
|---|---|---|---|---|
| ADDRESS / avenida | 5 | 5 | 0 | 0 |
| ADDRESS / calle | 5 | 5 | 0 | 0 |
| DATE / numerica | 10 | 10 | 0 | 0 |
| DATE / numerica-guion | 1 | 1 | 0 | 0 |
| DATE / texto | 5 | 5 | 0 | 0 |
| DATE / texto-ordinal | 2 | 2 | 0 | 0 |
| PERSON / dos-apellidos | 2 | 0 | 2 | 0 |

Lo que no se detecta entero (único por texto y rendering):
- PERSON / dos-apellidos «Choque Vargas, Pedro» (normal): se detecta «Vargas, Pedro» (`caratula-ar`), no el tramo entero.

Total U: 30; exactas 28 (93.3 %); parcial u otro tipo 2; perdidas 0. Matches universales sin verdad (FP): 0. Matches universales que pisan una entidad P de un formato del país: 0.

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
| DATE / numerica | 47 | 47 | 0 | 0 |
| DATE / numerica-guion | 4 | 4 | 0 | 0 |
| DATE / numerica-punto | 5 | 0 | 0 | 5 |
| DATE / texto | 29 | 29 | 0 | 0 |
| DATE / texto-ordinal | 8 | 8 | 0 | 0 |
| PERSON / apellido-simple | 2 | 1 | 0 | 1 |
| PERSON / dos-apellidos | 8 | 0 | 8 | 0 |

## 7. Agrupación: qué junta y qué separa el normalizador

Con la combinación «completo» de cada país, sobre las entidades que acertó (exactas), se compara la identidad real (`key`, la persona o la cosa) con el `normalizedValue` que emitió la forma. *Separa* = una misma identidad con más de un valor normalizado (queda en dos grupos). *Junta* = un mismo valor normalizado para identidades distintas (queda en un solo grupo).

### CL

Identidades con una entidad acertada: 45. **Separa**: 1. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `rut:14253687` → `14253687-0`, `14253687-1`

### UY

Identidades con una entidad acertada: 28. **Separa**: 6. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `ci:1234567` → `12345672`, `1234567`
- `ci:3456789` → `34567894`, `3456789`
- `ci:5123456` → `51234561`, `5123456`
- `ci:2345678` → `23456783`, `2345678`
- `ci:4567890` → `45678908`, `45678905`, `4567890`
- `ci:987654` → `9876549`, `987654`

### PY

Identidades con una entidad acertada: 33. **Separa**: 0. **Junta**: 0.

### BO

Identidades con una entidad acertada: 34. **Separa**: 4. **Junta**: 0.

Separa (identidad → valores normalizados distintos):

- `ci:1234567-LP` → `1234567/LP`, `1234567`
- `ci:3456789-CH` → `3456789/CH`, `3456789`
- `ci:4567890-TJ` → `4567890/TJ`, `4567890`
- `ci:9234567-SC` → `9234567/SC`, `9234567`

**D-7 (la CI de BO se repite entre personas).** Mismo corpus con un normalizador alternativo que **solo conserva el número** (sin extensión). Se compara contra la identidad real número + extensión:

Con el normalizador del Plan §5 (número + extensión; el complemento no se mide) las personas que comparten número **no se juntan** (junta = 0). Con el alternativo que solo guarda el número, **se juntan 4 números** que son de personas distintas: `1234567` ← `ci:1234567-LP`, `ci:1234567-SC`; `7654321` ← `ci:7654321-SC`, `ci:7654321-LP`; `3456789` ← `ci:3456789-CH`, `ci:3456789-CB`; `8123456` ← `ci:8123456-CB`, `ci:8123456-LP`.

### AR

Identidades con una entidad acertada: 15. **Separa**: 0. **Junta**: 0.

## 8. Falsos positivos de cada forma, con su texto

Cada match de una forma corrida sola que cae sobre un negativo o sobre texto sin verdad. Es lo que el mantenedor mira para decidir.

### CL

- `cl:plate-moto-2l3d` (núcleo): 1 FP — «EN 100» (negativo)

### UY

(ninguna forma tiene falsos positivos)

### PY

- `py:plate-moto-mercosur` (núcleo): 1 FP — «432 OTRO» (negativo)

### BO

- `bo:nit-ctx` (núcleo): 4 FP — «1234567» (negativo) ×2; «7654321» (negativo) ×2

### AR

- `ar:passport` (núcleo): 2 FP — «NRO 123456» (negativo) ×2

## 8b. Ruido numérico: cuánto acierta un número cualquiera

El corpus escrito a mano tiene pocos negativos numéricos, y las formas con verificador pasan por azar un número cualquiera con una probabilidad conocida. Para medirla se generaron números **al azar** (PRNG fijo, semilla 20261122, primer dígito 1-9; 2000 de cada largo) y se pusieron en frases neutras. *Tramo entero* = el match cubre el número entero; *Cualquier match* = el match solapa el número (incluye tramos). Sirve para estimar el falso positivo de las formas **sin contexto**; los números de verdad del documento (folios, montos) no son aleatorios.

| Número al azar | Forma | Rol | N | Tramo entero | % entero | Cualquier match | % cualquier |
|---|---|---|---|---|---|---|---|
| 7 dígitos pegados, tras «Folio» | `uy:ci-digitos` | núcleo | 2000 | 227 | 11.3 % | 227 | 11.3 % |
| 8 dígitos pegados, tras «Folio» | `uy:ci-digitos` | núcleo | 2000 | 208 | 10.4 % | 208 | 10.4 % |
| 9 dígitos pegados, tras «Folio» | `cl:phone-landline` | núcleo | 2000 | 722 | 36.1 % | 722 | 36.1 % |
| 12 dígitos pegados, tras «Folio» | `py:phone-landline` | núcleo | 2000 | 1 | 0.1 % | 1 | 0.1 % |
| 22 dígitos pegados, tras «Folio» | `ar:cbu` | núcleo | 2000 | 23 | 1.1 % | 23 | 1.1 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 166 | 8.3 % | 166 | 8.3 % |
| cuerpo con puntos de 8 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 185 | 9.3 % | 185 | 9.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 180 | 9.0 % | 180 | 9.0 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `uy:ci` | núcleo | 2000 | 1826 | 91.3 % | 1826 | 91.3 % |
| cuerpo con puntos de 7 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 185 | 9.3 % | 185 | 9.3 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 187 | 9.3 % | 187 | 9.3 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `uy:ci-digitos` | núcleo | 2000 | 0 | 0.0 % | 175 | 8.8 % |
| cuerpo sin puntos de 8 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 177 | 8.8 % | 177 | 8.8 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `cl:rut` | núcleo | 2000 | 186 | 9.3 % | 186 | 9.3 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `uy:ci-digitos` | núcleo | 2000 | 0 | 0.0 % | 176 | 8.8 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `uy:ci-guion` | opcional | 2000 | 188 | 9.4 % | 188 | 9.4 % |
| cuerpo sin puntos de 7 dígitos y guion + DV al azar | `py:ruc` | núcleo | 2000 | 186 | 9.3 % | 186 | 9.3 % |
| número de 5 a 8 dígitos tras «Nº» | `uy:ci-digitos` | núcleo | 2000 | 109 | 5.5 % | 109 | 5.5 % |

Las formas que no figuran no matchean ninguno de esos 2000 números.

## 9. Notas de método

- La guarda de corrida (`passesRunGuard`) y la prioridad del match más largo son las del motor: la guarda se importa de `regex-engine/src/run-guard.ts`; la resolución de solapamientos se reimplementa para formatos base (ordenar por largo descendente, inicio, orden de la lista; todo choque descarta), que es lo que hace `resolveOverlaps` cuando todos los formatos son `base`.

- El catálogo argentino se importa de `regex-engine/src/patterns/default-ar.ts` (`DEFAULT_PATTERNS_AR`) por ruta relativa, sin tocar el paquete. El email se corre con su `RegExp` (el motor usa un escáner lineal con la misma salida, ADR-181).

- Las formas con piezas se recorren con un enumerador de finales posibles (no es el autómata de Thompson del motor) con la semántica del spec: más a la izquierda y más largo, bordes de letra o dígito, contexto con `:` opcional.

- Las formas de tipo `control` con `RegExp` llevan los bordes del generador (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`), no `\b`. Con `\b` un RUT pegado a `_` se comportaría distinto; no aparece en el corpus.

- Texto de página: palabras unidas con un espacio, sin saltos de línea, como `Page.text`.

## 10. Tabla final propuesta de la tanda 1

Las formas que quedan por país, con su tipo, su clase (*structure*: piezas del generador; *control*: RegExp con un control propio, sea un verificador, una lista de códigos o un patrón de prefijos), el control, el contexto (máximo 5 palabras por formato), la máscara y el normalizador. *Estado*: «decidida» = el Plan §5 la lleva a la tanda; «sin decidir» = el Plan no se pronunció. Un control «patrón» no es un verificador: la forma es una RegExp y en los motores sería un `control` trivial (o `structure`, si las piezas la alcanzan).

| País | Forma | Tipo | Clase | Control | Contexto | Máscara | Normalizador | Estado |
|---|---|---|---|---|---|---|---|---|
| CL | `cl:rut` | DNI | control | dígito verificador, módulo 11 | - | `XX.XXX.XXX-X` | cuerpo-DV (DV en mayúscula, sin puntos ni espacios) | decidida |
| CL | `cl:rut-ctx` | DNI | structure | - | «RUT», «RUN», «R.U.T.», «R.U.N.» | `XX.XXX.XXX-X` | cuerpo-DV (DV en mayúscula, sin puntos ni espacios) | decidida |
| CL | `cl:phone-mobile` | PHONE | structure | - | - | `+XX X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:phone-mobile-parentesis` | PHONE | structure | - | - | `(+XX) X XXXX XXXX` | dígitos con prefijo 56 | sin decidir |
| CL | `cl:phone-mobile-ctx` | PHONE | structure | - | «Teléfono», «Tel.», «Fono», «Celular», «Cel.» | `X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:phone-landline` | PHONE | control | lista de 23 códigos de zona (Subtel 2006) y Santiago `2` | - | `+XX X XXXX XXXX` | dígitos con prefijo 56 | decidida |
| CL | `cl:plate-4l2d` | PLATE | control | lista de 18 letras (sin fuente primaria) | - | `XXXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-4l2d-ctx` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-2l4d` | PLATE | structure | - | - | `XX-XXXX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-moto-3l2d` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX-XX` | mayúsculas, sin separadores | decidida |
| CL | `cl:plate-moto-2l3d` | PLATE | structure | - | - | `XX-XXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:ci` | DNI | structure | - | - | `X.XXX.XXX-X` | solo dígitos | decidida |
| UY | `uy:ci-digitos` | DNI | control | dígito verificador de python-stdnum (sin fuente oficial) | - | `XXXXXXXX` | solo dígitos | decidida |
| UY | `uy:ci-guion` | DNI | control | dígito verificador de python-stdnum (sin fuente oficial) | - | `XXXXXXX-X` | solo dígitos | sin decidir |
| UY | `uy:ci-guion-sc` | DNI | structure | - | - | `XXXXXXX-X` | solo dígitos | sin decidir |
| UY | `uy:ci-sindv-ctx` | DNI | structure | - | «CI», «C.I.», «Cédula», «Cédula de identidad», «Documento» | `X.XXX.XXX` | solo dígitos | decidida |
| UY | `uy:rut` | CUIT | control | dígito verificador módulo 11 (sin fuente oficial), serie 01-22, tipo 001 | - | `XXXXXXXXXXXX` | solo dígitos | decidida |
| UY | `uy:rut-separado` | CUIT | structure | - | - | `XXXXXXXXXXXX` | solo dígitos | decidida |
| UY | `uy:phone-mobile` | PHONE | control | prefijos 091-099 (patrón) | - | `0XX XXX XXX` | dígitos con prefijo 598 (sin el 0 inicial) | decidida |
| UY | `uy:phone-landline` | PHONE | control | primer dígito 2 o 4 (patrón) | - | `XXXX XXXX` | dígitos con prefijo 598 (sin el 0 inicial) | decidida |
| UY | `uy:plate` | PLATE | structure | - | «Matrícula», «Patente», «Placa», «Chapa», «Dominio» | `XXX XXXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:plate-moto` | PLATE | structure | - | «Matrícula», «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| UY | `uy:account-brou` | BANK_ACCOUNT | structure | - | - | `XXXXXXXXX-XXXXX` | solo dígitos | decidida |
| PY | `py:ci` | DNI | structure | - | «C.I.», «CI», «CIC», «Cédula», «Cédula de identidad» | `X.XXX.XXX` | solo dígitos | decidida |
| PY | `py:ci-ctx` | DNI | structure | - | «C.I.», «CI», «CIC», «Cédula», «Cédula de identidad» | `XXXXXXX` | solo dígitos | decidida |
| PY | `py:ruc` | CUIT | control | dígito verificador módulo 11 de la DNIT (el algoritmo manda) | - | `XXXXXXXX-X` | cuerpo-DV, sin puntos | decidida |
| PY | `py:phone-mobile` | PHONE | control | prefijo 09XX (patrón) | - | `09XX XXX XXX` | dígitos con prefijo 595 (sin el 0 inicial) | decidida |
| PY | `py:phone-landline` | PHONE | control | prefijo de país o 0 inicial + código 2-8 (patrón) | - | `0XX XXX XXXX` | dígitos con prefijo 595 (sin el 0 inicial) | decidida |
| PY | `py:plate-3l3d` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-moto-3d3l` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-mercosur` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX XXX` | mayúsculas, sin separadores | decidida |
| PY | `py:plate-moto-mercosur` | PLATE | structure | - | - | `XXX XXXX` | mayúsculas, sin separadores | decidida |
| BO | `bo:ci-ext` | DNI | control | lista de 9 extensiones departamentales | - | `XXXXXXX XX` | número/extensión (extensión en mayúscula, sin puntos) | decidida |
| BO | `bo:ci-ctx` | DNI | structure | - | «C.I.», «CI», «Cédula», «Cédula de identidad» | `XXXXXXX` | solo dígitos | decidida |
| BO | `bo:nit-ctx` | CUIT | structure | - | «NIT», «N.I.T.» (hasta 3 palabras de relleno) | `XXXXXXXXXX` | solo dígitos | decidida |
| BO | `bo:phone-mobile` | PHONE | control | primer dígito 6 o 7 (patrón) | - | `XXXX XXXX` | dígitos con prefijo 591 | decidida |
| BO | `bo:phone-landline` | PHONE | control | código de área 2, 3 o 4 (patrón) | - | `X XXX XXXX` | dígitos con prefijo 591 | decidida |
| BO | `bo:plate` | PLATE | structure | - | «Patente», «Placa», «Chapa», «Dominio» | `XXXX XXX` | mayúsculas, sin separadores | decidida |
| AR | `ar:cbu` | BANK_ACCOUNT | control | dos dígitos verificadores del BCRA | - | `XXXXXXXXXXXXXXXXXXXXXX` | solo dígitos | decidida |
| AR | `ar:passport` | PASSPORT | structure | - | «Pasaporte» | `XXX XXXXXX` | mayúsculas, sin separadores | decidida |
