<!-- CONTEXT: scope=roadmap-release | dependencias=CODE_SIGNING.md,PRIVACY.md,SECURITY.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-137-Windows-Verifica-Actualizaciones-Con-Clave-Ed25519-Propia.md,adr/ADR-187-La-Integridad-De-Los-Assets-No-Se-Verifica-En-Runtime.md,architecture/08_Security_Model.md,roadmap/MVP.md | audiencia=humanos+IA | fase=11.5 (preparado 2026-09-26; postulación pendiente del humano) -->

# Firma de código de Windows con SignPath Foundation — postulación

SignPath Foundation firma gratis los binarios de proyectos open source con un
certificado propio. Es la única vía gratuita para que el instalador de
Windows tenga Authenticode. Con esa firma, Windows muestra un editor
verificado en la primera instalación, y la app empieza a ganar reputación
ante SmartScreen. ADR-137 ya cubre las **actualizaciones** con la clave
Ed25519 propia. Lo que queda sin cubrir es la **primera instalación**, y eso
solo lo cubre Authenticode (MVP.md, Hito 11.5).

Este documento reúne cuatro cosas: qué pide SignPath, cómo lo cumple Anonly,
qué responder en el formulario y qué hay que hacer después de la aprobación.
No cambia código ni contratos. La integración en el workflow pide su propio
ADR cuando llegue la aprobación (§5).

Fuente de las condiciones: [signpath.org/terms](https://signpath.org/terms),
consultada el 2026-09-26.

## 1. Requisitos y cumplimiento

| Condición de SignPath | Cómo la cumple Anonly | Estado |
|---|---|---|
| Sin malware ni software no deseado | App de anonimización local; sin telemetría ni instaladores de terceros | ✔ |
| Licencia OSI, sin doble licencia comercial | MIT (`LICENSE`) | ✔ |
| Sin código propietario | Dependencias OSS. Del instalador: Electron (MIT), Tesseract/tesseract.js (Apache-2.0), ONNX Runtime (MIT), modelo NER `Davlan/bert-base-multilingual-cased-ner-hrl` (AFL-3.0, OSI) en su conversión ONNX de `Xenova`. Datos: léxico de nombres CC-BY-2.5-AR, acreditado en `NOTICE` | ✔ — la conversión `Xenova` no declara licencia propia; hereda la del original. Mencionarlo si lo preguntan |
| Mantenido activamente | Historial de commits continuo | ✔ |
| **Ya publicado en la forma que se firma** | `v0.9.2` en GitHub Releases, con `Anonly.Setup.0.9.2.exe` (NSIS) | ✔ — marcado *Pre-release* |
| Funcionalidad documentada en la página de descarga | README y notas de cada release | ✔ |
| Página con la política de firma (título *Code signing policy*, frase de SignPath, roles, privacidad) | `CODE_SIGNING.md` | ✔ en la branch; **falta que esté en `main`** (§2) |
| Política de privacidad | `PRIVACY.md`. La frase corta de SignPath («no transfiere información salvo pedido expreso») **no aplica**: la app consulta actualizaciones sola al abrir (desactivable desde ADR-188). Por eso se enlaza una política propia | ✔ en la branch; ver §2, punto 3 |
| Desinstalación | Desinstalador NSIS; pasos y datos que quedan, en `PRIVACY.md` | ✔ |
| No modifica la configuración del sistema sin avisar | Instalación por usuario (`perMachine: false`), sin servicios ni cambios de sistema | ✔ |
| Roles: *committers and reviewers*, *approvers* | Una sola persona, con los tres roles (`CODE_SIGNING.md`) | ✔ |
| MFA en GitHub y en SignPath para todo el equipo | — | **Acción del humano** (§2) |
| Binarios construidos desde el código de forma verificable | `release.yml` en runners de GitHub, solo desde tag en `main` con CI verde; atestación de procedencia | ✔ — la integración de SignPath va en ese mismo workflow (§5) |
| Metadatos de producto (nombre y versión) fijados y exigidos | El `.exe` de 0.9.2 declara `ProductName` Anonly y `ProductVersion` 0.9.2 | ✔ — ver §2, punto 4 sobre `FileDescription` |
| Aprobación manual de cada firma | Política *release-signing* con aprobador (§5) | Se configura al integrar |

## 2. Qué falta antes de postular

Son acciones del humano, o decisiones suyas. Ninguna la ejecuta el agente.

1. **Activar 2FA en GitHub** si todavía no está activo. SignPath lo exige a
   todo el equipo, y después también en la cuenta de SignPath.
2. **Llevar `CODE_SIGNING.md` y `PRIVACY.md` a `main`.** Quien revisa la
   postulación mira el repo público, y hoy esos archivos solo están en
   `hardening/plan-2026-09`. Hay dos caminos: esperar al PR de la branch, o
   llevar a `main` solo el commit de estos documentos en un PR chico. Las URLs
   del formulario (§3) apuntan a `main`.
3. **Apagado del chequeo de actualizaciones: decidido, en implementación
   (ADR-188).** ADR-131 §5 lo declaraba desactivable y el código no lo
   permitía. ADR-188 agrega la preferencia «Buscar actualizaciones
   automáticamente». Queda por delante implementarla, revisarla y verificarla
   sobre el instalador en Windows y en macOS. `PRIVACY.md` ya describe las dos
   situaciones: la 0.9.2 y anteriores, y las versiones que traigan el control.
   Conviene postular cuando esa versión esté publicada o a punto de salir.
4. **Corregir `FileDescription` del ejecutable** (recomendado antes de la
   primera versión firmada). electron-builder lo toma del `description` de
   `apps/desktop-shell/package.json`. Hoy el `.exe` muestra «Contenedor de
   escritorio (Electron). Sirve el build de @anonly/react-client por el
   protocolo app://…». Es lo que Windows muestra como nombre del programa en
   el Administrador de tareas y en los avisos de seguridad. Alcanza con un
   texto corto del estilo «Anonly — anonimización local de documentos».
5. **Opcional:** agregar un `CODE_OF_CONDUCT.md`. SignPath no lo exige, pero
   otras postulaciones lo incluyen y suma a la impresión de proyecto mantenido.

## 3. Borrador del formulario

El formulario de [signpath.org/apply](https://signpath.org/apply) pide URLs,
una descripción corta, reputación y sistema de build. Las respuestas van en
inglés.

| Campo | Respuesta |
|---|---|
| Project name | Anonly |
| Repository | https://github.com/sgiambelluca/Anonly |
| Homepage | https://github.com/sgiambelluca/Anonly (no hay sitio aparte; el README es la página del proyecto) |
| Download page | https://github.com/sgiambelluca/Anonly/releases |
| Code signing policy | https://github.com/sgiambelluca/Anonly/blob/main/CODE_SIGNING.md |
| Privacy policy | https://github.com/sgiambelluca/Anonly/blob/main/PRIVACY.md |
| License | MIT |
| Short description | Desktop app that anonymizes PDF documents entirely on the user's computer: it detects personal data with OCR, a local NER model and patterns, lets the user review it, and exports a new PDF where the original data cannot be recovered. |
| Build system | GitHub Actions on GitHub-hosted runners (`windows-latest`). Electron app packaged with electron-builder as an NSIS installer. Releases are built only from version tags on `main` with passing CI, and every release carries a build provenance attestation. |
| Artifacts to sign | The NSIS installer (`Anonly Setup <version>.exe`) and the application executable it installs. |
| Reputation | *(completar el humano, sin inflar)*. Datos verificables: proyecto de una sola persona, primera versión pública v0.9.2 (septiembre de 2026), CI y builds públicos, atestación de procedencia en cada release, política de seguridad con reporte privado, modelo de seguridad y decisiones documentadas en ADRs. Sumar estrellas, descargas o usuarios reales solo si existen. |

Riesgo a tener presente: SignPath revisa a mano y valora la reputación. Un
proyecto nuevo, de una persona y con pocas descargas puede recibir preguntas
o una negativa. Si lo rechazan, no hay otra vía gratuita. Las alternativas
(Azure Trusted Signing, certificados OV/EV, el certificado OSS de Certum)
son pagas y quedan fuera de alcance. Windows seguiría sin Authenticode, como
hoy, y eso pasaría a figurar como riesgo aceptado en `08_Security_Model.md`
§2.3, junto al de macOS.

## 4. Versión

A SignPath no le importa el número. Le importa que exista una versión
publicada en la forma que se va a firmar, y `v0.9.2` ya cumple eso. Conviene
postular **ahora**, sin esperar al próximo release. La revisión es manual y
suele tardar una o dos semanas. Si la aprobación llega antes, el próximo
release sale firmado. Si llega después, ese release sale sin firma como los
anteriores, y la firma empieza en el siguiente. El cambio es compatible en
los dos sentidos (§5, punto 5).

## 5. Después de la aprobación (necesita ADR)

Lo que sigue queda para cuando SignPath entregue la organización y el
proyecto. Se registra acá para no redescubrirlo, y pide un ADR antes de tocar
`release.yml` (R-19).

1. **Configuración en SignPath.** Conector de *trusted build system* para
   GitHub.com, con verificación de origen: solo se firman artefactos subidos
   por un workflow de este repo, desde `main` o un tag. Además, una
   *artifact configuration* para el instalador y el ejecutable, con
   restricciones de metadatos: `ProductName` = Anonly y `ProductVersion` =
   versión del tag. Dos políticas: `test-signing`, para validar el circuito
   con `workflow_dispatch` sin certificado real, y `release-signing`, con
   aprobación manual.
2. **Secret nuevo** de Actions con el token de la API de SignPath, en el
   entorno `release`, igual que las claves de actualización.
3. **Orden de los pasos en `release.yml`.** Es el punto delicado. La firma
   Authenticode **cambia los bytes del instalador**, y ADR-137 ata la firma
   Ed25519 al SHA-512 del instalador que figura en `latest.yml`. El orden
   tiene que ser este:
   1. empaquetar;
   2. firmar con SignPath;
   3. recalcular el `sha512`, el tamaño y el `.blockmap` de `latest.yml` sobre
      el instalador ya firmado;
   4. firmar con Ed25519;
   5. generar `SHA256SUMS.txt`;
   6. emitir la atestación.

   Firmar después de Ed25519 dejaría cada actualización rechazada por la
   propia app.
4. **Ejecutable interno.** Firmar solo el instalador deja sin firmar el
   `Anonly.exe` instalado. Para firmarlo, el camino habitual con
   electron-builder tiene dos fases: primero se empaqueta el directorio
   (`--win dir`) y SignPath firma el `.exe`; después se arma el NSIS desde
   ese directorio ya firmado (`--prepackaged`) y SignPath firma el
   instalador. Hay que decidir en el ADR si se hace, y qué pasa con el
   desinstalador.
5. **`publisherName`.** Hay que reemplazar el valor reservado
   `__ANONLY_ED25519_ONLY__` de `electron-builder.yml` por el CN del
   certificado, tal como figura en el primer binario firmado (se espera
   *SignPath Foundation*; confirmarlo, no asumirlo). Las instalaciones
   anteriores tienen horneado el valor reservado y siguen aceptando la
   actualización solo con Ed25519. Las nuevas exigen Ed25519 y después
   Authenticode (ADR-137). No hace falta ningún paso manual del usuario.
6. **Documentación a actualizar en el mismo cambio:**
   - `CODE_SIGNING.md`: sacar el aviso de estado;
   - `README.md`: la frase sobre el editor no verificado;
   - `08_Security_Model.md` §2.3;
   - el ítem SignPath del Hito 11.5 en `MVP.md`;
   - `RELEASING.md`: la aprobación manual pasa a ser un paso del release.
