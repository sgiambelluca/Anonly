<!-- CONTEXT: scope=adr | dependencias=adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md | audiencia=humanos+IA | fase=11.6 -->

# ADR-138 — Un instalador universal de macOS

- **Estado**: Accepted
- **Fecha**: 2026-09-05
- **Decidido por**: El humano, al corregir el primer release con Sparkle.
- **Relacionado con**: ADR-130 (contenedor), ADR-131 (distribución y Sparkle), ADR-132 (seguridad del shell)
- **Parte de**: Hito 11.6 — verificación de actualizaciones

## Contexto

Electron Builder producía dos ZIP de macOS para una misma versión:
`Anonly-<version>-arm64-mac.zip` y `Anonly-<version>-mac.zip`. Sparkle no
permite dos entradas con el mismo `CFBundleVersion` dentro de un appcast: no
puede decidir entre dos archivos que anuncian la misma actualización. El
primer intento de release quedó bloqueado exactamente por esa condición.

Además, el bridge N-API de Sparkle se compilaba una sola vez, con la
arquitectura del runner. En un runner Apple Silicon, ese `.node` arm64 podía
terminar dentro también del paquete x64.

La aplicación tiene un solo `SUFeedURL` horneado en `Info.plist`. Mantener dos
feeds exigiría selección de arquitectura en runtime, dos appcasts y dos
variantes de configuración. No existe esa política en los contratos ni en la
documentación actual.

## Decisión

macOS se publica como **un único instalador universal**:

1. Electron Builder genera un bundle `universal` con slices `arm64` y `x86_64`.
2. El bridge `sparkle_bridge.node` se compila para ambas arquitecturas y se
   combina con `lipo`; el framework Sparkle ya es universal. Electron
   Builder lo excluye de una segunda combinación mediante `x64ArchFiles`.
3. Se genera un único ZIP actualizable y un único `appcast.xml` firmado con la
   clave EdDSA existente.
4. El sistema operativo elige el slice correcto al iniciar la aplicación; no
   hay detección de arquitectura ni selección de versión en JavaScript.
5. El pipeline falla si el bundle o el bridge no contienen exactamente ambas
   arquitecturas, antes de subir artefactos.

Windows conserva su instalador y su verificación Ed25519 sin cambios.

## Alternativa descartada

Dos instaladores macOS (arm64/x64) con feeds separados producirían artefactos
más pequeños, pero obligarían a publicar y mantener dos appcasts y a cambiar
la configuración estática de Sparkle por una selección de feed por
arquitectura. Se descarta por complejidad y por el riesgo de que una
instalación consulte el feed equivocado.

## Consecuencias

**A favor**

- Una descarga inicial sirve para Macs Apple Silicon e Intel.
- Sparkle tiene una sola entrada por versión y puede verificarla sin
  ambigüedad.
- El usuario no necesita conocer su arquitectura.
- El bridge nativo funciona en las dos arquitecturas.

**En contra**

- El paquete universal contiene dos slices del ejecutable y del addon, por lo
  que pesa algo más que cada paquete individual.
- El pipeline debe compilar y validar dos arquitecturas, aunque el runner sea
  Apple Silicon.
