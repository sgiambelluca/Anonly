# Tests Fixtures

Fixtures (PDFs de prueba) para los tests del Core de Anonly.

> Fuente de verdad: `docs/architecture/07_Performance_Strategy.md` §11.2.

---

## Fixtures requeridos (por spec)

| Fixture | Tamaño aprox. | Propósito | Specs que lo usan |
|---|---|---|---|
| `text-10p.pdf` | ~100 KB | PDF con texto, 10 páginas, caso base | PDF Engine, Regex Engine, NER Engine, Grouping Engine, Render Engine, Export Engine, snapshot |
| `text-50p.pdf` | ~500 KB | PDF con texto, 50 páginas, stress | PDF Engine, perf |
| `scanned-10p.pdf` | ~5 MB | PDF escaneado, requiere OCR | OCR Engine |
| `corrupt.pdf` | ~1 KB | header %PDF- válido + cuerpo no-PDF determinista | PDF Engine edge |
| `protected.pdf` | ~100 KB | protegido con password `test1234` | PDF Engine edge |
| `empty.pdf` | ~1 KB | 1 página sin contenido (pdf-lib no permite 0 páginas) | PDF Engine edge |
| `huge-1000p.pdf` | ~10 MB | 1000 páginas, stress extremo | PDF Engine stress (LFS) |
| `mixed-30p.pdf` | ~3 MB | 15 con texto + 15 escaneadas | PDF Engine + OCR integration |

## Contenido conocido de `text-10p.pdf`

Para que los tests de Regex y NER sean deterministas, `text-10p.pdf` debe contener texto conocido en posiciones conocidas:

- **Página 0**: "Juan Pérez vive en Belgrano 1234, DNI 34.567.891, CUIT 20-12345678-9, teléfono +54 11 1234-5678, email juan.perez@example.com."
- **Página 1**: "María Gómez, DNI 18.445.212, trabaja en Empresa S.A. con sede en Rivadavia 455."
- **Página 2**: "Carlos López, DNI 42.998.103, IBAN ES00 1234 5678 9012 3456 7890, tarjeta 4532 1234 5678 9901."
- **Páginas 3-9**: texto neutro sin entidades (para test de "no false positives").

Las entidades esperadas (test de snapshot de Grouping):
- 3 Personas (Juan Pérez, María Gómez, Carlos López)
- 3 DNIs (34.567.891, 18.445.212, 42.998.103)
- 2 Direcciones (Belgrano 1234, Rivadavia 455)
- 1 Organización (Empresa S.A.)
- 1 CUIT (20-12345678-9)
- 1 Teléfono (+54 11 1234-5678)
- 1 Email (juan.perez@example.com)
- 1 IBAN (ES00...)
- 1 Tarjeta (4532...)

## Cómo conseguir los fixtures

### Opción A — Generador (recomendado para Hito 2)

Crear `tests/fixtures/generate.ts` que use `pdf-lib` para generar los PDFs con texto conocido. Ventajas: reproducible, sin datos reales, commiteable.

```bash
pnpm tsx tests/fixtures/generate.ts
```

Genera `text-10p.pdf`, `empty.pdf`, `corrupt.pdf` directamente. Para `protected.pdf`, `scanned-10p.pdf` y `mixed-30p.pdf` se requieren tools externos (ver Opción B).

### Opción B — PDFs públicos + transformación

- `text-10p.pdf`: generar con el script generador.
- `scanned-10p.pdf`: tomar un PDF público (ej. sample de PDF.js), rasterizarlo a imagen con `pdftoppm`, y reconstruirlo como PDF de imágenes con `pdf-lib`.
- `protected.pdf`: generar con `qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf`.
- `corrupt.pdf`: header %PDF- válido + cuerpo no-PDF determinista (e.g. 200 bytes de 0x41).
- `empty.pdf`: `qpdf --empty-pages 0 -- empty.pdf` o generar con pdf-lib sin páginas.
- `huge-1000p.pdf`: generar con el script (loop de 1000 páginas con texto neutro). Va a Git LFS por tamaño.

### Opción C — Descarga con hash verificado (Hito 11)

Para fixtures que no se pueden generar automáticamente y pesan > 5 MB, descargar en `postinstall` con hash verificado:

```json
// tests/fixtures/manifest.json
{
  "scanned-10p.pdf": { "url": "https://anonly.dev/fixtures/scanned-10p.pdf", "sha256": "..." }
}
```

## Storage en git

- Fixtures < 5 MB: commiteados directo en `tests/fixtures/`.
- Fixtures ≥ 5 MB (`scanned-10p.pdf`, `huge-1000p.pdf`): **Git LFS** o descarga con hash (Hito 11).
- Patrones `.gitignore` ya excluyen `tests/fixtures/*.large.pdf` y `tests/fixtures/*.bin`.

## Estado actual

### Generados por script (Hito 2, rama `chore/setup-test-fixtures`)

| Fixture | Generador | Test que lo valida | Descripción |
|---|---|---|---|
| `text-10p.pdf` | `pnpm fixtures:generate` → `generateText10p()` | `generate.test.ts` → "generate.ts — text-10p.pdf" | 10 páginas, texto con entidades conocidas para Regex/NER/Grouping |
| `empty.pdf` | `pnpm fixtures:generate` → `generateEmpty()` | `generate.test.ts` → "generate.ts — empty.pdf" | 1 página vacía sin contenido. El nombre "empty" es histórico: pdf-lib no permite PDFs con 0 páginas. Equivalente a "página textless" para el PDF Engine. |
| `corrupt.pdf` | `pnpm fixtures:generate` → `generateCorrupt()` | `generate.test.ts` → "generate.ts — corrupt.pdf" | Header %PDF- válido + cuerpo no-PDF determinista (200 bytes de 0x41). No parseable por PDF.js pero con header que pasa la heurística inicial. |

### Pendientes (requieren tools externos)

| Fixture | Cómo generarlo | Hito |
|---|---|---|
| `protected.pdf` | `qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf` | 2b (cuando se necesite password test) |
| `text-50p.pdf` | Extender `generate.ts` con `generateText50p()` | 11 (perf) |
| `huge-1000p.pdf` | Extender `generate.ts` (Git LFS) | 11 (stress) |
| `scanned-10p.pdf` | `pdftoppm` + `pdf-lib` | 3 (OCR) |
| `mixed-30p.pdf` | Combinar text + scanned | 3 (OCR integration) |

### Flujo de trabajo

```bash
# 1. Instalar deps (incluye pdf-lib y tsx)
pnpm install

# 2. Generar los fixtures commiteables
pnpm fixtures:generate

# 3. Verificar con tests (los tests validan el output del script en memoria;
#    no leen los archivos commiteados)
pnpm test

# 4. Commitear los PDFs
git add tests/fixtures/*.pdf
git commit -m "test: add generated PDF fixtures"
```

**Importante**: el test `generate.test.ts` valida las funciones del script **en memoria** (no los archivos commiteados). Esto permite que el test pase aunque los PDFs aún no estén commiteados. Una vez commiteados, el CI también puede validar que existen.

## Dataset de referencia (recall / precision)

Las métricas contractuales de detección (`00_Project_Vision.md` §7, `roadmap/MVP.md` §5) se miden contra un **dataset de referencia etiquetado** que vive en `tests/fixtures/reference/`. Sin este dataset, los gates de recall/precision no son ejecutables.

### Estructura

```
tests/fixtures/reference/
├── manifest.json          # índice: documento → ground truth
├── doc-001.pdf            # PDF sintético generado
├── doc-001.truth.json     # entidades esperadas del doc-001
├── doc-002.pdf
├── doc-002.truth.json
└── ...
```

### Formato del ground truth (`*.truth.json`)

```json
{
  "documentId": "doc-001",
  "entities": [
    { "entityType": "DNI", "value": "34.567.891", "pageIndex": 0, "detector": "regex" },
    { "entityType": "PERSON", "value": "Juan Pérez", "pageIndex": 0, "detector": "ner" }
  ]
}
```

- `entityType`: valor del enum `EntityType` (`core/Contracts.md` §5).
- `detector`: qué detector debería encontrarla (`regex` | `ner`), para separar las métricas de Regex de las de NER.
- Un documento puede tener cero entidades (mide falsos positivos).

### Construcción

- **Generado por script**: extender `generate.ts` con `generateReferenceDataset()`, que produce los PDFs y sus `truth.json` desde la misma fuente (imposible que se desincronicen).
- **Composición inicial** (mínimo para que las métricas sean significativas): ~20 documentos sintéticos con densidad variada — documentos "densos" (muchas entidades por página), "ralos" (1–2 entidades), "trampa" (textos que parecen entidades pero no lo son: números de expediente, códigos postales, fechas inválidas) y "vacíos" (sin entidades).
- **Sin datos reales**: nombres, DNIs, CUITs y direcciones se generan con el mismo pool sintético de `shared/synthesizer.ts`.

### Cuándo se necesita

| Hito | Uso |
|---|---|
| Hito 4 (Regex) | recall/precision Regex — **gate MVP** |
| Hito 5 (NER) | recall/precision NER — informativa en MVP, gate en v1.0 |
| Hito 11 (Hardening) | gates de CI (`pnpm test:perf`) |

El dataset debe existir **antes de cerrar el Hito 4**.

## Reglas

- **NUNCA** commitear PDFs con datos personales reales. Los fixtures son sintéticos o públicos.
- **NUNCA** commitear PDFs con passwords reales. `protected.pdf` usa `test1234` (documentado acá y en el test).
- Cualquier fixture nuevo debe documentarse en esta tabla.
- Si un fixture se usa en un test, el test debe fallar claro si el fixture no existe (no ignorarse silenciosamente).
