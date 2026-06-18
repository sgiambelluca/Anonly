<!-- CONTEXT: scope=adr | dependencias=00_Project_Vision.md,08_Security_Model.md | audiencia=humanos+IA | fase=2 -->

# ADR-002 — No Backend para Procesamiento

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

El producto procesa documentos confidenciales (legal, salud, RRHH). Cualquier envío del documento a un servidor —aunque sea "para procesarlo y borrarlo"— es un bloqueador de adopción en estos sectores y una responsabilidad de seguridad y compliance que no queremos asumir en MVP.

Tecnológicamente, hoy es viable hacer todo el procesamiento en el navegador: PDF.js, Tesseract.js y ONNX Runtime Web funcionan en WASM con performance razonable.

## Decisión

**No existe backend de procesamiento.** Toda la lógica de anonimización corre en el navegador del usuario vía Web Workers. El único "backend" es un CDN estático que sirve HTML, JS, wasm y modelos, sin endpoints que reciban documentos.

El Core **no hace network** (regla R-10 de `ai/AI_Development_Guide.md`). Solo `apps/react-client` hace requests para cargar assets estáticos, restringidas por CSP.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Backend con borrado inmediato** | Requiere confianza del usuario, logs, compliance. No resuelve el problema central: el usuario no quiere que el documento salga de su dispositivo. |
| **Backend opcional (hybrid)** | Duplica la lógica del Core en server. Mantiene el problema de confianza. Complejidad de mantener dos runtimes. |
| **Backend solo para OCR/NER pesado** | OCR y NER locales ya son viables con Tesseract.js + ONNX. No justifica el costo de confianza. |
| **Edge functions (Cloudflare/Vercel)** | Sigue siendo "el documento sale del dispositivo". Misma objeción. |

## Consecuencias

**Positivas**:
- Sin responsabilidad de custodia de documentos confidenciales.
- Sin infra server que escalar, monitorear, asegurar.
- Sin GDPR/HIPAA compliance sobre datos en tránsito (no hay tránsito).
- Costo de hosting = solo CDN estático, bajísimo.
- Trust story clara para marketing y ventas.

**Negativas**:
- Performance limitada por el dispositivo del usuario (móvil = más lento).
- Modelos IA deben descargar al cliente (lazy + cache mitigado).
- Sin capacidad de batch en servidor (futuro producto separado, ver `roadmap/Future_Ideas.md`).
- No podemos "arreglar" un PDF problemático server-side; todo debe manejarse en cliente.

**Neutras**:
- Futuro producto server-side sería un paquete separado que reutiliza el Core (sin reescribir), vía un runtime Node. No se descarta, pero es otro producto con su propio ADR.

## Validación

- Test `no-network-from-core` en CI (ver `08_Security_Model.md` §11).
- CSP `connect-src 'self'` en la app.
- Audit de network en E2E: ninguna request a un endpoint que no sea first-party CDN.

## Referencias

- `00_Project_Vision.md` §2 (filosofía local-first)
- `08_Security_Model.md` §3, §11
- `ai/AI_Development_Guide.md` §2.2 R-10
- `roadmap/Future_Ideas.md` (producto server futuro)
