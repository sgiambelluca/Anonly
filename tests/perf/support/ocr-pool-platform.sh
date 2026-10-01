#!/usr/bin/env bash
# Funciones por plataforma de run-ocr-pool.sh (macOS y Windows nativo con Git Bash).
# Se carga con `source`; no ejecuta nada por sí sola ni cambia opciones de la shell.

# detect_platform [uname -s]  ->  darwin | windows | unsupported
detect_platform() {
  case "${1:-$(uname -s)}" in
    Darwin) echo darwin ;;
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    *) echo unsupported ;;
  esac
}

# Ruta absoluta de POSIX (/x) o de Windows (C:\x, C:/x). No mira el sistema de archivos.
is_abs_path() {
  case "${1:-}" in
    /* | [A-Za-z]:[\\/]*) return 0 ;;
  esac
  return 1
}

# Convierte a forma de shell (/c/...) si hay cygpath; si no, devuelve la ruta tal cual.
to_shell_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi
}

# Forma que entiende un proceso nativo de Windows (C:/...): Node no lee /c/... .
to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# Forma con barras invertidas (C:\x), la que aparece en la línea de comandos de un proceso.
to_win_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# find y sort: en Windows, System32 puede ir antes que /usr/bin en el PATH y resolver a las
# utilidades de Windows (distintas, y con digests vacíos y constantes). Se fijan las de MSYS.
msys_tool() {
  if [[ "${PLATFORM:-}" == "windows" && -x "/usr/bin/$1" ]]; then printf '%s' "/usr/bin/$1"; else printf '%s' "$1"; fi
}

digest_dir() {
  local find_bin sort_bin
  find_bin="$(msys_tool find)"
  sort_bin="$(msys_tool sort)"
  (cd "$1" && "$find_bin" . -type f | LC_ALL=C "$sort_bin" | while IFS= read -r file; do sha "$file"; done) | sha
}

# Un directorio con archivos nunca puede dar el digest de la entrada vacía: si lo da, find/sort no
# son los esperados. Distinto de cero en ese caso.
digest_is_plausible() {
  [[ -n "$1" && "$1" != "$(printf '' | sha)" ]]
}

readable_abs_file() {
  is_abs_path "${1:-}" && [[ -r "$(to_shell_path "$1")" ]]
}

# sha [archivo...]  ->  solo el hash (o los hashes); sin argumentos lee stdin.
sha() {
  if [[ "${PLATFORM:-}" == "windows" ]] && command -v sha256sum >/dev/null 2>&1; then
    LC_ALL=C sha256sum "$@" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    LC_ALL=C shasum -a 256 "$@" 2>/dev/null | awk '{print $1}'
  else
    LC_ALL=C sha256sum "$@" 2>/dev/null | awk '{print $1}'
  fi
}

# ─── PowerShell (solo Windows) ───
# Los scripts van a archivos .ps1 y se invocan con -File: pasar código con comillas dobles por
# la línea de comandos de un .exe nativo es frágil. Salida sin \r (PowerShell termina en \r\n).

# ps_init se llama una vez en la shell principal: las funciones corren dentro de $(...), y un
# directorio creado ahí se perdería (y filtraría uno por llamada).
PS_DIR=""
ps_init() {
  PS_DIR="$(mktemp -d)"
}

ps_dir() {
  [[ -n "$PS_DIR" ]] || return 1
  printf '%s' "$PS_DIR"
}

# ps_run <nombre> <función que imprime el script>: escribe el .ps1 una vez, lo ejecuta y limpia \r.
# El script sale de una función y no de un heredoc dentro de $(...): bash 3.2 (macOS) interpreta mal
# los paréntesis de un heredoc ahí adentro. Devuelve el código de salida de PowerShell.
ps_run() {
  local name="$1" source_fn="$2" dir file out rc
  dir="$(ps_dir)" || return 1
  file="$dir/$name.ps1"
  [[ -f "$file" ]] || "$source_fn" >"$file" || return 1
  out="$(powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(to_native_path "$file")" 2>"$dir/last-error.txt")"
  rc=$?
  printf '%s\n' "$out" | tr -d '\r'
  return "$rc"
}

# Causa del último fallo de PowerShell, en una línea y sin rutas de documentos reales. Con $1, ese
# texto sale cuando no hay causa (stderr vacío): "sin detalle" tiene que aparecer de verdad.
ps_last_error() {
  local text=""
  [[ -n "$PS_DIR" && -s "$PS_DIR/last-error.txt" ]] && text="$(tr -d '\r' <"$PS_DIR/last-error.txt" | head -n 3 | tr '\n' ' ')"
  local var value
  for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
    value="${!var:-}"
    [[ -n "$value" ]] && text="${text//"$value"/<ruta-redactada>}" && text="${text//"$(to_shell_path "$value")"/<ruta-redactada>}"
  done
  text="${text:0:300}"
  printf '%s' "${text:-${1:-}}"
}

ps_cleanup() {
  if [[ -n "$PS_DIR" ]]; then rm -rf "$PS_DIR"; PS_DIR=""; fi
}

# Snapshot de memoria del sistema: física total/libre y archivo de paginación.
ps_src_pressure() {
  cat <<'PS'
$ErrorActionPreference = "Stop"
$o = Get-CimInstance Win32_OperatingSystem
"TotalVisibleMemoryKB=$($o.TotalVisibleMemorySize)"
"FreePhysicalMemoryKB=$($o.FreePhysicalMemory)"
"TotalVirtualMemoryKB=$($o.TotalVirtualMemorySize)"
"FreeVirtualMemoryKB=$($o.FreeVirtualMemory)"
foreach ($p in @(Get-CimInstance Win32_PageFileUsage)) {
  "PageFile=$($p.Name) AllocatedMB=$($p.AllocatedBaseSize) CurrentUsageMB=$($p.CurrentUsage) PeakUsageMB=$($p.PeakUsage)"
}
PS
}
capture_pressure_windows() { ps_run pressure ps_src_pressure; }

# Digest de los últimos eventos de suspensión y reanudación (Kernel-Power 42/107 y, en Modern
# Standby, 506/507; Power-Troubleshooter 1). "Sin eventos" no es un error y da un digest constante.
# El script termina con una línea QUERY_OK: sin ella (el script no llegó al final) o con cualquier
# fallo (permisos, log no disponible) se devuelve distinto de cero, y eso NO es "sin suspensión".
ps_src_sleepwake() {
  cat <<'PS'
$ErrorActionPreference = "Stop"
function Get-PowerEvents($filter) {
  try { @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop) }
  catch {
    if ($_.FullyQualifiedErrorId -like "NoMatchingEventsFound*") { @() } else { throw }
  }
}
try {
  $k = @(Get-PowerEvents @{ LogName = "System"; ProviderName = "Microsoft-Windows-Kernel-Power"; Id = 42, 107, 506, 507 })
  $t = @(Get-PowerEvents @{ LogName = "System"; ProviderName = "Microsoft-Windows-Power-Troubleshooter"; Id = 1 })
  $all = @($k + $t) | Sort-Object TimeCreated, RecordId | Select-Object -Last 10
  foreach ($e in $all) {
    "{0}|{1}|{2}|{3}" -f $e.ProviderName, $e.Id, $e.RecordId, $e.TimeCreated.ToUniversalTime().ToString("o")
  }
  "QUERY_OK"
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 3
}
PS
}
sleep_wake_digest_windows() {
  local out last body
  out="$(ps_run sleepwake ps_src_sleepwake)" || return 1
  last="${out##*$'\n'}"
  [[ "$last" == "QUERY_OK" ]] || return 1
  body="${out%QUERY_OK}"
  printf '%s' "$body" | sha
}

# Cuenta procesos cuya línea de comandos coincide con una regex de PowerShell Y menciona el repo
# (así no atrapa, p. ej., la extensión de Vitest de un IDE abierto sobre otro proyecto).
# windows_process_count <regex> <raíz del repo>. Imprime el número; distinto de cero si no se pudo
# consultar o si la salida no es un número.
ps_src_proccount() {
  cat <<'PS'
$ErrorActionPreference = "Stop"
$pattern = $env:ANONLY_PROC_PATTERN
$root = $env:ANONLY_PROC_ROOT.Replace("/", "\")
$hits = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.ProcessId -ne $PID -and
  $_.CommandLine -match $pattern -and
  $_.CommandLine.Replace("/", "\").IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
$hits.Count
PS
}
windows_process_count() {
  local out root
  root="$(to_win_path "$2")"
  out="$(ANONLY_PROC_PATTERN="$1" ANONLY_PROC_ROOT="$root" ps_run proccount ps_src_proccount)" || return 1
  [[ "$out" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$out"
}

# ─── Prevención de suspensión (Windows) ───
# Un powershell de fondo mantiene ES_CONTINUOUS | ES_SYSTEM_REQUIRED mientras vive (el estado es
# por hilo). Vence solo a las 24 h por si el kill falla. No impide el cierre de tapa.
# Señal positiva: el script escribe un archivo marcador DESPUÉS de que SetThreadExecutionState
# devuelva distinto de cero. Que el proceso siga vivo no cuenta: puede estar mudo tras un error.
KEEP_AWAKE_PID=""
KEEP_AWAKE_WAIT_S="${KEEP_AWAKE_WAIT_S:-15}"
start_keep_awake_windows() {
  local dir file marker waited=0
  dir="$(ps_dir)" || return 1
  file="$dir/keepawake.ps1"
  marker="$dir/keepawake.ok"
  rm -f "$marker"
  cat >"$file" <<'PS' || return 1
$ErrorActionPreference = "Stop"
Add-Type -Namespace Anonly -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED = 0x80000001; como literal es Int32 negativo en PowerShell 5.1.
$previous = [Anonly.Power]::SetThreadExecutionState([uint32]2147483649)
if ($previous -eq 0) { [Console]::Error.WriteLine("SetThreadExecutionState devolvio 0"); exit 4 }
Set-Content -Path $env:ANONLY_KEEPAWAKE_MARKER -Value "OK"
$deadline = (Get-Date).AddHours(24)
while ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 30 }
PS
  ANONLY_KEEPAWAKE_MARKER="$(to_native_path "$marker")" \
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(to_native_path "$file")" >/dev/null 2>"$dir/keepawake-error.txt" &
  KEEP_AWAKE_PID=$!
  disown "$KEEP_AWAKE_PID" 2>/dev/null || true
  while [[ "$waited" -lt $((KEEP_AWAKE_WAIT_S * 2)) ]]; do
    [[ -f "$marker" ]] && return 0
    kill -0 "$KEEP_AWAKE_PID" 2>/dev/null || break
    sleep 0.5
    waited=$((waited + 1))
  done
  [[ -f "$marker" ]] && return 0
  stop_keep_awake
  return 1
}

# 0 si no se lanzó nunca (ya quedó la salvedad de "no disponible") o si sigue vivo; distinto de 0 si
# se lanzó, se confirmó y murió a mitad de la campaña.
keep_awake_alive() {
  [[ -z "$KEEP_AWAKE_PID" ]] || kill -0 "$KEEP_AWAKE_PID" 2>/dev/null
}

stop_keep_awake() {
  if [[ -n "$KEEP_AWAKE_PID" ]]; then
    kill "$KEEP_AWAKE_PID" 2>/dev/null || true
    KEEP_AWAKE_PID=""
  fi
}

# ─── Detección de suspensión y salvedades (usan $RUN_DIR, $PLATFORM y `log` del runner) ───

# Devuelve el digest por stdout; distinto de cero si la plataforma no pudo consultar el log.
# "Sin coincidencias" no es un fallo (grep sale con 1); un pmset que falla o que no devuelve nada,
# o un grep con error (2 o más), sí lo son.
sleep_wake_digest() {
  if [[ "$PLATFORM" == "windows" ]]; then sleep_wake_digest_windows; return; fi
  local log lines rc
  log="$(pmset -g log 2>/dev/null)" || return 1
  [[ -n "$log" ]] || return 1
  lines="$(printf '%s\n' "$log" | grep -E 'Entering Sleep state|Wake from')"
  rc=$?
  [[ "$rc" -le 1 ]] || return 1
  printf '%s\n' "$lines" | tail -n 10 | shasum -a 256 | awk '{print $1}'
}
# Si la consulta falla no se asume "sin suspensión": queda dicho en el log y en el resumen.
# `sleep-detection.json` lo escriben las dos plataformas; un `false` previo (APPEND) no se pisa.
SLEEP_DETECTION_OK=1
write_sleep_detection() {
  node - "$RUN_DIR/sleep-detection.json" "$1" "$2" "$PLATFORM" <<'NODE'
const fs = require("node:fs");
const [file, available, note, platform] = process.argv.slice(2);
if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).available === false) process.exit(0);
fs.writeFileSync(file, `${JSON.stringify({ available: available === "true", platform, note: note === "" ? null : note }, null, 2)}\n`);
NODE
}
sleep_detection_failed() {
  local detail=""
  [[ "$PLATFORM" == "windows" ]] && detail="$(ps_last_error)"
  SLEEP_DETECTION_OK=0
  log "detección de suspensión no disponible: falló la consulta del log del sistema ($1)${detail:+: $detail}."
  write_sleep_detection false "falló la consulta del log del sistema ($1); las corridas desde ahí no tienen detección de suspensión"
}
# Salvedades de validez que el resumen tiene que mostrar (caveats.json).
add_caveat() {
  node - "$RUN_DIR/caveats.json" "$1" "$2" <<'NODE'
const fs = require("node:fs");
const [file, id, note] = process.argv.slice(2);
const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).items ?? [] : [];
if (!items.some((item) => item.id === id)) items.push({ id, note });
fs.writeFileSync(file, `${JSON.stringify({ items }, null, 2)}\n`);
NODE
  log "salvedad registrada ($1): $2"
}
