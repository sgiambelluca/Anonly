# Privacidad

_English version below._

Anonly procesa tus documentos **solo en tu computadora**. No hay cuenta, ni
servidor propio, ni telemetría, ni analíticas, ni reporte de errores
automático. El proyecto no recibe ningún dato tuyo.

## Qué sale de tu computadora

Una sola cosa: **la consulta de actualizaciones**. Al abrirse, la app le
pregunta a GitHub Releases si hay una versión nueva y, si la hay, la
descarga. En macOS, mientras la app sigue abierta, repite la consulta una vez
por día. También podés pedirlo a mano desde _Configuración → Actualizaciones
→ Buscar actualizaciones ahora_.

- Como en cualquier conexión, **GitHub ve desde dónde llega la consulta (tu
  IP) y qué versión tenés instalada**. Lo que GitHub hace con eso se rige por
  su [declaración de privacidad](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Nunca** viaja el contenido, el nombre ni ningún metadato de un documento.
  El motor de anonimización no tiene acceso a la red, y un control automático
  del proyecto lo verifica sobre el código en cada cambio.
- Cada actualización se verifica con una clave propia del proyecto antes de
  instalarse. Con _Actualizar automáticamente_ desactivado, la app te avisa y
  vos decidís cuándo instalarla.

La búsqueda automática se apaga en _Configuración → Actualizaciones →
Buscar actualizaciones automáticamente_. Apagada, Anonly no se conecta a
internet salvo que toques _Buscar actualizaciones ahora_; todo lo demás
funciona sin conexión. Ese control existe a partir de la versión siguiente a
la 0.9.2: en la 0.9.2 y anteriores la consulta no se puede apagar desde la
app, y la única forma de cortarla es bloquear Anonly en el firewall del
sistema.

Al abrir un enlace externo desde la app (por ejemplo, el repositorio), se abre
en tu navegador, fuera de Anonly.

## Qué queda en tu computadora

- **Tus documentos**: Anonly los procesa en memoria y no guarda copias. El
  único archivo que escribe es el PDF anonimizado, donde vos elegís.
- **Tu configuración** (las opciones del diálogo _Configuración_ y los
  avisos que cerraste): en la carpeta de datos de la app, dentro de tu perfil de usuario — en
  Windows bajo `%APPDATA%`, en macOS bajo `~/Library/Application Support`.
  Chromium, el motor sobre el que corre la app, guarda en esa misma carpeta
  sus cachés y archivos temporales.
- **La actualización descargada**, hasta que se instala: en Windows, bajo
  `%LOCALAPPDATA%`.

Para borrar todo: desinstalá la app (Windows: _Configuración → Aplicaciones →
Aplicaciones instaladas → Anonly → Desinstalar_; macOS: arrastrá Anonly desde
_Aplicaciones_ a la papelera) y después borrá la carpeta de datos de la app en
las ubicaciones de arriba. El desinstalador de Windows no la borra, para que
una reinstalación conserve tu configuración.

## Cambios

Si alguna versión cambia algo de lo anterior, este archivo se actualiza en el
mismo cambio y la nota de la versión lo dice. El historial completo está en
el [repositorio](https://github.com/sgiambelluca/Anonly/commits/main/PRIVACY.md).

Preguntas o problemas: [`SECURITY.md`](./SECURITY.md).

---

# Privacy (English)

Anonly processes your documents **only on your computer**. There is no
account, no project server, no telemetry, no analytics and no automatic error
reporting. The project receives no data from you.

## What leaves your computer

One thing only: **the update check**. When it starts, the app asks GitHub
Releases whether a new version exists and, if so, downloads it. On macOS,
while the app stays open, it repeats the check once a day. You can also
trigger it from _Configuración → Actualizaciones → Buscar actualizaciones
ahora_ (the app's interface is in Spanish: _Settings → Updates → Check for
updates now_).

- As with any connection, **GitHub sees where the request comes from (your IP
  address) and which version you have installed**. GitHub's handling of that
  is governed by its
  [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- The content, name or metadata of a document is **never** sent. The
  anonymization engine has no network access, and an automated project check
  enforces that on the code with every change.
- Every update is verified with a project key before it is installed. With
  _Actualizar automáticamente_ (update automatically) turned off, the app notifies you and you decide when
  to install it.

Automatic checking is turned off in _Configuración → Actualizaciones →
Buscar actualizaciones automáticamente_ (check for updates automatically).
When it is off, Anonly does not connect to the internet unless you press
_Buscar actualizaciones ahora_; everything else works offline. That control
exists from the version after 0.9.2 onwards: in 0.9.2 and earlier the check
cannot be turned off from the app, and the only way to stop it is to block
Anonly in your system firewall.

Links opened from the app (for example, to the repository) open in your web
browser, outside Anonly.

## What stays on your computer

- **Your documents**: Anonly processes them in memory and keeps no copies.
  The only file it writes is the anonymized PDF, wherever you choose.
- **Your settings** (the options of the _Configuración_ dialog and the hints
  you dismissed): in the app's data
  folder inside your user profile — under `%APPDATA%` on Windows and
  `~/Library/Application Support` on macOS. Chromium, the engine the app runs
  on, keeps its caches and temporary files in that same folder.
- **A downloaded update**, until it is installed: under `%LOCALAPPDATA%` on
  Windows.

To remove everything: uninstall the app (Windows: _Settings → Apps →
Installed apps → Anonly → Uninstall_; macOS: drag Anonly from _Applications_
to the Trash), then delete the app's data folder from the locations above.
The Windows uninstaller keeps it, so that a reinstall keeps your settings.

## Changes

If a version changes any of the above, this file is updated in the same
change and the release notes say so. The full history is in the
[repository](https://github.com/sgiambelluca/Anonly/commits/main/PRIVACY.md).

Questions or problems: [`SECURITY.md`](./SECURITY.md).
