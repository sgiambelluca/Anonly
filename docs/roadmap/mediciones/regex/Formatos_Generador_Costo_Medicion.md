<!-- CONTEXT: scope=roadmap-medicion | dependencias=core/Regex_Engine.md,roadmap/Plan_1.1.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,tests/perf/README.md,roadmap/mediciones/ner/Hilos_NER_Medicion.md | audiencia=humanos+IA | fase=1.1 (frente F1, medición que decide si hace falta un tope de formatos propios) -->

# Formatos del generador: costo con 10, 50 y 200 formatos

## Resultado

**El costo crece lineal con la cantidad de formatos prendidos**: unos 11 ms
por formato cada 100 000 caracteres, igual con 10, 50 y 200. Con eso, el
mantenedor decidió el 2026-11-20 que **no hay tope de cantidad**
(`Regex_Engine.md` §12, `Plan_1.1.md` §7). Se revisa si aparece un caso real
lento.

El recorrido del autómata es lineal en el largo de la página, como pide el
caso 43. La página «words» del arnés sale marcada superlineal, pero eso no es
del autómata: está explicado en «Lectura».

## Protocolo

- **Arnés:** `tests/perf/regex-worst-case.ts` con
  `ANONLY_REGEX_WORST_LABELS=formats` (`tests/perf/README.md`). Corre en el
  mismo proceso, con la mediana de cinco repeticiones por punto.
- **Máquina:** Windows nativo, Node 22, sin otra suite corriendo.
- **Código:** branch `feat/1.1-contrato-y-generador`, con F1 implementado.
- **Tres corridas seguidas** el 2026-11-20, de unos 29 s cada una.
- **Texto de la medición de costo:** una página sintética de 100 000
  caracteres, densa en números con formas parecidas a las de los formatos.
- **Formatos:** `count` formatos distintos de cuatro piezas (dígitos,
  separador opcional, dígitos y una parte opcional); uno de cada tres lleva
  contexto.

## Datos

Costo con N formatos prendidos, sobre la página de 100 000 caracteres. Cada
celda dice cuánto suman los formatos sobre lo que cuestan los base solos, y en
la columna de detecciones están las ocurrencias de toda la página.

| Formatos | Corrida 1 | Corrida 2 | Corrida 3 | Por formato | Detecciones |
|---:|---:|---:|---:|---:|---:|
| 0 (solo base) | 3,77 ms | 3,80 ms | 3,62 ms | — | — |
| 10 | +111 ms | +116 ms | +110 ms | 11,0 a 11,6 ms | 2.778 |
| 50 | +557 ms | +547 ms | +554 ms | 10,9 a 11,1 ms | 5.556 |
| 200 | +2.231 ms | +2.199 ms | +2.166 ms | 10,8 a 11,2 ms | 5.556 |

Caso 43: lo que suma el formato de ocho piezas `digit 1..8` pegadas, por
largo de página.

| Página | 25 000 car. | 50 000 car. | 100 000 car. | 200 000 car. | Al duplicar |
|---|---:|---:|---:|---:|---|
| «digits», corridas 1 a 3 | 1,3 a 2,4 ms | 2,8 a 3,0 ms | 5,2 a 6,1 ms | 11,0 a 11,9 ms | ×2,0 a ×2,1 |
| «near-miss», corridas 1 a 3 | 13,2 a 14,2 ms | 23,1 a 23,9 ms | 45,8 a 46,3 ms | 92,3 a 106,4 ms | ×1,7 a ×2,3 |
| «words», corrida 1 | 6,6 ms | 31,3 ms | 27,3 ms | 107,0 ms | ×4,7, ×0,9 y ×3,9 |
| «words», corrida 2 | 5,8 ms | 32,0 ms | 34,4 ms | 33,2 ms | ×5,5, ×1,1 y ×1,0 |
| «words», corrida 3 | 1,5 ms | 34,2 ms | 39,8 ms | 390,1 ms | ruido, ×1,2 y ×9,8 |

El arnés sale con código 1 en las tres corridas, por la marca de «words».

## Lectura

**Proyección a documentos reales.** De los documentos reales se usan solo los
tamaños (`mediciones/ner/Hilos_NER_Medicion.md`): R1 tiene 51 páginas y
69 486 caracteres, y R2 20 páginas y 28 109 caracteres. Con 11 ms por formato
cada 100 000 caracteres:

| Formatos | R1 | R2 | Por página de R1 (mediana 1 372 car.) |
|---:|---:|---:|---:|
| 10 | 0,08 s | 0,03 s | 1,5 ms |
| 50 | 0,38 s | 0,15 s | 7,5 ms |
| 200 | 1,53 s | 0,62 s | 30 ms |

Regex corre en el main thread (`Regex_Engine.md` §12). Con 200 formatos, cada
página lo ocupa unos 30 ms.

**La página «words» no mide el autómata.** Cada una de sus unas 22 000
palabras de ocho dígitos es un match de `dni-ar` y del formato. Después del
recorrido, dos pasos del motor son cuadráticos en la cantidad de matches de
una página, desde la 1.0:
- `resolveOverlaps` compara cada match contra todos los aceptados;
- `mapSpanToWords` recorre las palabras desde el principio por cada match.

El arnés le resta al total el tiempo de los base, que también pasan por esos
pasos, así que la diferencia es la resta de dos números grandes y ruidosos.
Por eso las tres curvas no se parecen. Las páginas «digits» y «near-miss» no
tienen matches y miden solo el recorrido: duplican el tiempo al duplicar el
largo. En documentos reales la cantidad de matches por página es chica: R1
tuvo 298 ocurrencias en sus 51 páginas.

## Qué no cubre

- **El texto es sintético.** El costo por carácter de un texto real, con menos
  números, puede ser menor; la proyección usa solo los tamaños de R1 y R2.
- **No corre formatos sobre documentos reales.** El arnés no tiene modo real.
- **No se midió en macOS.**
- **La marca de «words» sigue haciendo fallar al arnés.** Hay dos arreglos
  posibles, que van aparte de F2:
  - que el arnés mida esa página por pasos del autómata (`ScanStats`) y no por
    reloj;
  - que `resolveOverlaps` y `mapSpanToWords` dejen de ser cuadráticos.
