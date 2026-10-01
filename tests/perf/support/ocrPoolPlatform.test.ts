import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { afterEach, beforeEach, describe as vitestDescribe, expect, it } from "vitest";

// Estos tests ejercitan la lógica de cadenas de ocr-pool-platform.sh con stubs POSIX (scripts con
// shebang llamados powershell.exe, pmset, cygpath...). En Windows nativo ni los stubs se ejecutan
// por shebang ni `bash` resuelve de forma fiable (System32\bash.exe es WSL), y el caso "sin
// powershell.exe" encontraría el real: un test rojo o verde por casualidad no sirve. El camino real
// de Windows se valida con el humo (`ANONLY_OCR_POOL_ULTRA_SMOKE=1`), no con estos tests.
const describe = vitestDescribe.skipIf(process.platform === "win32");

const LIB = resolve(__dirname, "ocr-pool-platform.sh");
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ocr-pool-platform-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stub(name: string, body: string): void {
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/** powershell.exe falso: guarda el .ps1 que recibe y responde con STUB_OUT / STUB_RC. */
function stubPowerShell(): void {
  stub(
    "powershell.exe",
    [
      'while [[ $# -gt 0 ]]; do [[ "$1" == "-File" ]] && file="$2"; shift; done',
      'cp "$file" "$STUB_SCRIPT_COPY"',
      'if [[ "$(basename "$file")" == "keepawake.ps1" ]]; then',
      '  case "${STUB_KEEP:-ok}" in',
      '    ok) printf OK >"$ANONLY_KEEPAWAKE_MARKER"; exec sleep 30 ;;',
      "    silent) exec sleep 30 ;;",
      "    dies) exit 4 ;;",
      "  esac",
      "fi",
      '[[ "${STUB_ECHO_ENV:-}" == "1" ]] && printf "%s" "$ANONLY_PROC_PATTERN" >"$STUB_ENV_COPY"',
      'printf "%b" "${STUB_OUT:-}"',
      'exit "${STUB_RC:-0}"',
    ].join("\n"),
  );
}

function bash(
  script: string,
  env: Record<string, string> = {},
): { stdout: string; status: number | null } {
  const result = spawnSync("bash", ["-c", `source "${LIB}"; ${script}`], {
    encoding: "utf8",
    env: {
      PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
      HOME: dir,
      STUB_SCRIPT_COPY: join(dir, "script-copy.ps1"),
      STUB_ENV_COPY: join(dir, "env-copy.txt"),
      ...env,
    },
  });
  return { stdout: result.stdout, status: result.status };
}

describe("detect_platform", () => {
  it.each([
    ["Darwin", "darwin"],
    ["MINGW64_NT-10.0-22631", "windows"],
    ["MSYS_NT-10.0", "windows"],
    ["CYGWIN_NT-10.0", "windows"],
    ["Linux", "unsupported"],
    ["FreeBSD", "unsupported"],
  ])("%s -> %s", (uname, expected) => {
    expect(bash(`detect_platform "${uname}"`).stdout.trim()).toBe(expected);
  });
});

describe("is_abs_path", () => {
  it.each([
    "/Users/x/a.pdf",
    "/c/Users/x/a.pdf",
    "C:\\Users\\x\\a.pdf",
    "c:/Users/x/a.pdf",
    "D:\\a",
  ])("acepta %s", (path) => {
    expect(bash(`is_abs_path '${path}'`).status).toBe(0);
  });

  it.each(["", "a.pdf", "./a.pdf", "C:a.pdf", "\\a.pdf", "C:"])("rechaza '%s'", (path) => {
    expect(bash(`is_abs_path '${path}'`).status).toBe(1);
  });
});

describe("rutas sin cygpath", () => {
  it("to_native_path y to_shell_path devuelven la ruta tal cual", () => {
    expect(bash(`to_native_path 'C:\\a b\\x.pdf'`).stdout).toBe("C:\\a b\\x.pdf");
    expect(bash(`to_shell_path '/c/a'`).stdout).toBe("/c/a");
  });

  it("con cygpath usa -m para el proceso nativo y -u para la shell", () => {
    stub("cygpath", 'echo "cygpath $1 $2"');
    expect(bash(`to_native_path 'C:\\x'`).stdout.trim()).toBe("cygpath -m C:\\x");
    expect(bash(`to_shell_path 'C:\\x'`).stdout.trim()).toBe("cygpath -u C:\\x");
  });

  it("readable_abs_file exige ruta absoluta y archivo legible", () => {
    const file = join(dir, "a.pdf");
    writeFileSync(file, "x");
    expect(bash(`readable_abs_file '${file}'`).status).toBe(0);
    expect(bash(`readable_abs_file '${join(dir, "no-existe.pdf")}'`).status).toBe(1);
    expect(bash(`readable_abs_file 'a.pdf'`).status).toBe(1);
  });
});

describe("sha", () => {
  it("da el mismo hash que SHA-256 para stdin y para archivos", () => {
    const file = join(dir, "f.txt");
    writeFileSync(file, "hola\n");
    expect(bash(`printf 'hola\\n' | sha`).stdout.trim()).toBe(sha256("hola\n"));
    expect(bash(`sha '${file}'`).stdout.trim()).toBe(sha256("hola\n"));
  });

  it("en Windows prefiere sha256sum si está", () => {
    stub("sha256sum", 'echo "deadbeef  -"');
    expect(bash("PLATFORM=windows; sha </dev/null").stdout.trim()).toBe("deadbeef");
    expect(bash("PLATFORM=darwin; sha </dev/null").stdout.trim()).toBe(sha256(""));
  });
});

describe("sleep_wake_digest_windows", () => {
  const run = (env: Record<string, string>) =>
    bash("ps_init; sleep_wake_digest_windows; rc=$?; ps_cleanup; exit $rc", env);
  const ev = (...lines: string[]): string => `${lines.join("\\n")}\\nQUERY_OK\\n`;
  const K42 = "K|42|10|2026-09-30T01:00:00.0000000Z";
  const K107 = "K|107|11|2026-09-30T02:00:00.0000000Z";

  it("sin eventos el digest es constante (el de la entrada vacía) y no falla", () => {
    stubPowerShell();
    const first = run({ STUB_OUT: "QUERY_OK\\n" });
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toBe(sha256(""));
    expect(run({ STUB_OUT: "QUERY_OK\\n" }).stdout.trim()).toBe(first.stdout.trim());
  });

  it("los \\r\\n de PowerShell no cambian el digest", () => {
    stubPowerShell();
    const lf = run({ STUB_OUT: ev(K42, K107) });
    const crlf = run({ STUB_OUT: ev(K42, K107).replaceAll("\\n", "\\r\\n") });
    expect(crlf.stdout).toBe(lf.stdout);
    expect(lf.stdout.trim()).toHaveLength(64);
  });

  it("un evento nuevo de suspensión cambia el digest", () => {
    stubPowerShell();
    const before = run({ STUB_OUT: ev(K107) });
    const after = run({ STUB_OUT: ev(K107, "K|42|12|2026-09-30T03:00:00.0000000Z") });
    expect(after.stdout).not.toBe(before.stdout);
  });

  it("si la consulta falla devuelve distinto de cero y no un digest", () => {
    stubPowerShell();
    const failed = run({ STUB_OUT: "QUERY_OK\\n", STUB_RC: "3" });
    expect(failed.status).not.toBe(0);
    expect(failed.stdout.trim()).toBe("");
  });

  it("sin la línea final QUERY_OK (script que no llegó al final) también es fallo, aunque salga con 0", () => {
    stubPowerShell();
    for (const out of ["", K42 + "\\n"]) {
      const result = run({ STUB_OUT: out });
      expect(result.status).not.toBe(0);
      expect(result.stdout.trim()).toBe("");
    }
  });

  it("sin powershell.exe también falla en vez de dar el digest de la entrada vacía", () => {
    const failed = run({});
    expect(failed.status).not.toBe(0);
    expect(failed.stdout.trim()).not.toBe(sha256(""));
  });

  it("consulta Kernel-Power 42/107 y 506/507 (Modern Standby) y Power-Troubleshooter 1", () => {
    stubPowerShell();
    run({ STUB_OUT: "QUERY_OK\\n" });
    const script = readFileSync(join(dir, "script-copy.ps1"), "utf8");
    expect(script).toContain("Microsoft-Windows-Kernel-Power");
    expect(script).toContain("Id = 42, 107, 506, 507");
    expect(script).toContain("Microsoft-Windows-Power-Troubleshooter");
    expect(script).toContain("NoMatchingEventsFound");
    expect(script).toContain("exit 3");
  });
});

describe("sleep_wake_digest en macOS", () => {
  const digest = (env: Record<string, string>) => bash("PLATFORM=darwin; sleep_wake_digest", env);
  const pmset = (body: string): void => stub("pmset", body);

  it("un log sin eventos de suspensión da un digest constante y NO es un fallo (grep sale con 1)", () => {
    pmset('printf "2026 Assertions PreventUserIdleSystemSleep\\n2026 Clamshell\\n"');
    const first = digest({});
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toHaveLength(64);
    expect(digest({}).stdout).toBe(first.stdout);
  });

  it("una suspensión nueva en el log cambia el digest", () => {
    pmset('printf "a\\n"');
    const before = digest({});
    pmset('printf "a\\n2026 Entering Sleep state due to Idle Sleep\\n"');
    expect(digest({}).stdout).not.toBe(before.stdout);
  });

  it("un pmset que falla es un fallo, no un digest", () => {
    pmset("exit 1");
    const result = digest({});
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("un pmset que no devuelve nada también es un fallo (no hay señal positiva)", () => {
    pmset("exit 0");
    expect(digest({}).status).not.toBe(0);
  });

  it("un grep con error (código 2) es un fallo", () => {
    pmset('printf "a\\n"');
    stub("grep", "exit 2");
    expect(digest({}).status).not.toBe(0);
  });
});

describe("sleep-detection.json y salvedades", () => {
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
  const withRunDir = (script: string, platform = "darwin") =>
    bash(`log() { :; }; RUN_DIR='${dir}'; PLATFORM=${platform}; ${script}`);

  it("las dos plataformas escriben available: true / false con su plataforma", () => {
    withRunDir('write_sleep_detection true ""', "darwin");
    expect(read("sleep-detection.json")).toEqual({
      available: true,
      platform: "darwin",
      note: null,
    });
    rmSync(join(dir, "sleep-detection.json"));
    withRunDir('write_sleep_detection false "falló"', "windows");
    expect(read("sleep-detection.json")).toEqual({
      available: false,
      platform: "windows",
      note: "falló",
    });
  });

  it("un false previo (APPEND) no se pisa con un true posterior", () => {
    withRunDir('write_sleep_detection false "falló antes"');
    withRunDir('write_sleep_detection true ""');
    expect(read("sleep-detection.json").available).toBe(false);
    expect(read("sleep-detection.json").note).toBe("falló antes");
  });

  it("sleep_detection_failed apaga la detección y deja el false escrito", () => {
    const out = withRunDir('sleep_detection_failed "antes de x"; echo "ok=$SLEEP_DETECTION_OK"');
    expect(out.stdout.trim()).toBe("ok=0");
    expect(read("sleep-detection.json").available).toBe(false);
  });

  it("add_caveat acumula salvedades sin duplicar el mismo id", () => {
    withRunDir('add_caveat a "uno"; add_caveat b "dos"; add_caveat a "otra vez"');
    expect(read("caveats.json")).toEqual({
      items: [
        { id: "a", note: "uno" },
        { id: "b", note: "dos" },
      ],
    });
  });
});

describe("prevención de suspensión (Windows)", () => {
  const start = (env: Record<string, string>) =>
    bash(
      "KEEP_AWAKE_WAIT_S=2; ps_init; start_keep_awake_windows; rc=$?; stop_keep_awake; ps_cleanup; exit $rc",
      env,
    );

  it("con marcador (SetThreadExecutionState devolvió distinto de cero) está activa", () => {
    stubPowerShell();
    expect(start({ STUB_KEEP: "ok" }).status).toBe(0);
  });

  it("con el proceso vivo pero mudo (sin marcador) NO se da por activa", () => {
    stubPowerShell();
    expect(start({ STUB_KEEP: "silent" }).status).not.toBe(0);
  });

  it("si el proceso muere antes del marcador no está activa", () => {
    stubPowerShell();
    expect(start({ STUB_KEEP: "dies" }).status).not.toBe(0);
  });

  it("el script usa [uint32]2147483649 y escribe el marcador solo si el retorno no es 0", () => {
    stubPowerShell();
    start({ STUB_KEEP: "ok" });
    const script = readFileSync(join(dir, "script-copy.ps1"), "utf8");
    expect(script).toContain("[uint32]2147483649");
    expect(script).not.toContain("0x80000001)");
    const guard = script.indexOf("-eq 0");
    const marker = script.indexOf("Set-Content");
    expect(guard).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(guard);
  });
});

describe("keep_awake_alive (la prevención sigue viva al final)", () => {
  const scenario = (after: string) =>
    bash(
      `KEEP_AWAKE_WAIT_S=2; ps_init; start_keep_awake_windows || exit 9; ${after}; keep_awake_alive; rc=$?; stop_keep_awake; ps_cleanup; exit $rc`,
      { STUB_KEEP: "ok" },
    );

  it("vivo al final: sin novedad", () => {
    stubPowerShell();
    expect(scenario(":").status).toBe(0);
  });

  it("si el powershell murió a mitad de la campaña, se detecta", () => {
    stubPowerShell();
    expect(scenario('kill "$KEEP_AWAKE_PID"; sleep 0.5').status).not.toBe(0);
  });

  it("si nunca se lanzó no es 'perdida' (ya quedó la salvedad de no disponible)", () => {
    expect(bash("keep_awake_alive").status).toBe(0);
  });
});

describe("digest de directorios y herramientas", () => {
  it("digest_is_plausible rechaza vacío y el digest de la entrada vacía, y acepta otro", () => {
    expect(bash("digest_is_plausible ''").status).toBe(1);
    expect(bash(`digest_is_plausible '${sha256("")}'`).status).toBe(1);
    expect(bash(`digest_is_plausible '${sha256("algo")}'`).status).toBe(0);
  });

  it("digest_dir de un directorio con archivos no da el digest vacío; con find roto, sí (y se detecta)", () => {
    writeFileSync(join(dir, "a.txt"), "uno");
    const ok = bash(`d="$(digest_dir '${dir}')"; digest_is_plausible "$d"`);
    expect(ok.status).toBe(0);
    stub("find", "exit 0");
    const broken = bash(`d="$(digest_dir '${dir}')"; digest_is_plausible "$d"`);
    expect(broken.status).toBe(1);
  });

  it("en Windows se fijan /usr/bin/find y sort cuando existen; en macOS, los del PATH", () => {
    expect(bash("PLATFORM=darwin; msys_tool find").stdout).toBe("find");
    const windows = bash("PLATFORM=windows; msys_tool find").stdout;
    expect(["find", "/usr/bin/find"]).toContain(windows);
  });
});

describe("otras funciones de PowerShell", () => {
  it("capture_pressure_windows limpia \\r y pide memoria física y archivo de paginación", () => {
    stubPowerShell();
    const out = bash("ps_init; capture_pressure_windows; ps_cleanup", {
      STUB_OUT: "FreePhysicalMemoryKB=1\\r\\nPageFile=x CurrentUsageMB=2\\r\\n",
    });
    expect(out.stdout).toBe("FreePhysicalMemoryKB=1\nPageFile=x CurrentUsageMB=2\n");
    const script = readFileSync(join(dir, "script-copy.ps1"), "utf8");
    expect(script).toContain("Win32_OperatingSystem");
    expect(script).toContain("Win32_PageFileUsage");
  });

  it("windows_process_count pasa regex y raíz por entorno, y exige una salida numérica", () => {
    stubPowerShell();
    const call = (out: string) =>
      bash(
        `ps_init; windows_process_count 'playwright test --config|x"y' '/repo'; rc=$?; ps_cleanup; exit $rc`,
        {
          STUB_OUT: out,
          STUB_ECHO_ENV: "1",
        },
      );
    const ok = call("0\\r\\n");
    expect(ok.stdout.trim()).toBe("0");
    expect(readFileSync(join(dir, "env-copy.txt"), "utf8")).toBe('playwright test --config|x"y');
    expect(call("Access denied\\n").status).not.toBe(0);
    expect(call("").status).not.toBe(0);
    const script = readFileSync(join(dir, "script-copy.ps1"), "utf8");
    expect(script).toContain("ANONLY_PROC_ROOT");
  });

  it("ps_last_error devuelve la causa y redacta la ruta de los documentos reales", () => {
    stub("powershell.exe", 'echo "fallo con /ruta/secreta/R2.pdf adentro" >&2; exit 5');
    const out = bash(
      "ps_init; ps_src_x() { echo x; }; ps_run algo ps_src_x >/dev/null; ps_last_error; ps_cleanup",
      {
        ANONLY_REAL_DOC_R2: "/ruta/secreta/R2.pdf",
      },
    );
    expect(out.stdout).toContain("fallo con");
    expect(out.stdout).not.toContain("secreta");
    expect(out.stdout).toContain("<ruta-redactada>");
  });

  it("ps_last_error usa el texto por defecto cuando stderr está vacío (y no queda vacío)", () => {
    stub("powershell.exe", "exit 0");
    const out = bash(
      "ps_init; ps_src_x() { echo x; }; ps_run algo ps_src_x >/dev/null; ps_last_error 'sin detalle'; ps_cleanup",
    );
    expect(out.stdout).toBe("sin detalle");
    stub("powershell.exe", 'echo "causa real" >&2; exit 5');
    const withError = bash(
      "ps_init; ps_src_x() { echo x; }; ps_run algo ps_src_x >/dev/null; ps_last_error 'sin detalle'; ps_cleanup",
    );
    expect(withError.stdout).toBe("causa real ");
  });

  it("ps_init crea el directorio una sola vez y ps_cleanup lo borra", () => {
    const out = bash(
      'ps_init; d="$PS_DIR"; [[ -d "$d" ]] && echo existe; ps_cleanup; [[ -d "$d" ]] || echo borrado',
    );
    expect(out.stdout.split("\n").filter(Boolean)).toEqual(["existe", "borrado"]);
  });
});
