import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { afterEach, beforeEach, describe as vitestDescribe, expect, it } from "vitest";

// Ejercitan los runners de la campaña de DPI descendente con bash y stubs POSIX (digest de suspensión
// falso, cygpath falso). En Windows nativo `bash` resuelve a WSL (System32\bash.exe) y los stubs no
// se ejecutan por shebang: se saltean, como ocrPoolPlatform.test.ts. El camino real de Windows se
// valida con los humos de las dos fases (README, «Campaña de DPI descendente»).
const describe = vitestDescribe.skipIf(process.platform === "win32");

const ROOT = resolve(__dirname, "../../..");
const PLATFORM_LIB = resolve(__dirname, "ocr-pool-platform.sh");
const COMMON_LIB = resolve(__dirname, "ocr-campaign-common.sh");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ocr-campaign-common-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function bash(script: string, env: Record<string, string> = {}) {
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        `source "${PLATFORM_LIB}"`,
        `source "${COMMON_LIB}"`,
        `RUN_DIR="${join(dir, "run")}"; mkdir -p "$RUN_DIR"`,
        script,
      ].join("; "),
    ],
    {
      encoding: "utf8",
      env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, HOME: dir, ...env },
    },
  );
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(dir, "run", name), "utf8")) as unknown;

describe("guard_begin / guard_end (detección de suspensión por unidad)", () => {
  const fakeDigest = (value: string) =>
    `PLATFORM=darwin; sleep_wake_digest() { cat "${join(dir, "digest")}"; }; printf '${value}' >"${join(dir, "digest")}"`;

  it("con el mismo digest antes y después no se invalida nada", () => {
    const result = bash(`${fakeDigest("a")}; guard_begin unidad-1; guard_end unidad-1; echo rc=$?`);
    expect(result.stdout).toContain("rc=0");
    expect(existsSync(join(dir, "run", "validity.json"))).toBe(false);
  });

  it("control de fallo: un digest distinto invalida la unidad con su motivo y devuelve 1", () => {
    const result = bash(
      `${fakeDigest("a")}; guard_begin unidad-1; printf b >"${join(dir, "digest")}"; guard_end unidad-1; echo rc=$?`,
    );
    expect(result.stdout).toContain("rc=1");
    expect(read("validity.json")).toEqual({
      affectedRunIds: ["unidad-1"],
      reasonsByRunId: { "unidad-1": ["sleep-wake-event-during-run"] },
    });
  });

  it("sin señal positiva (la consulta falla al inicio) no afirma «sin suspensión»: lo deja escrito como no disponible", () => {
    const result = bash(
      `PLATFORM=darwin; sleep_wake_digest() { return 1; }; guard_begin unidad-1; guard_end unidad-1; echo rc=$? ok=$SLEEP_DETECTION_OK`,
    );
    expect(result.stdout).toContain("ok=0");
    expect(read("sleep-detection.json")).toMatchObject({ available: false });
    expect(existsSync(join(dir, "run", "validity.json"))).toBe(false);
  });

  it("si la consulta falla recién al final, tampoco se da por sin suspensión", () => {
    const result = bash(
      `PLATFORM=darwin; sleep_wake_digest() { if [[ -e "${dir}/seen" ]]; then return 1; fi; touch "${dir}/seen"; printf a; }; guard_begin u; guard_end u; echo ok=$SLEEP_DETECTION_OK`,
    );
    expect(result.stdout).toContain("ok=0");
    expect(read("sleep-detection.json")).toMatchObject({ available: false });
  });
});

describe("record_invalid_run, campaign_init y salvedades", () => {
  it("acumula motivos por unidad sin duplicar", () => {
    bash(
      `record_invalid_run u1 a; record_invalid_run u1 a; record_invalid_run u1 b; record_invalid_run u2 a`,
    );
    expect(read("validity.json")).toEqual({
      affectedRunIds: ["u1", "u2"],
      reasonsByRunId: { u1: ["a", "b"], u2: ["a"] },
    });
  });

  it("campaign_init no pisa una carpeta de salida existente", () => {
    const result = bash(`RUN_DIR="${dir}"; campaign_init`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no se pisa");
  });

  it("Windows: si el powershell de prevención murió, la salvedad queda en caveats.json", () => {
    bash(`PLATFORM=windows; KEEP_AWAKE_PID=999999; campaign_final_checks`);
    expect(read("caveats.json")).toMatchObject({ items: [{ id: "sleep-prevention-lost" }] });
  });

  it("macOS no agrega esa salvedad", () => {
    bash(`PLATFORM=darwin; KEEP_AWAKE_PID=999999; campaign_final_checks`);
    expect(existsSync(join(dir, "run", "caveats.json"))).toBe(false);
  });
});

describe("export_real_doc_native", () => {
  it("en Windows exporta la forma nativa (C:/...) para Node; en macOS deja la ruta como está", () => {
    const file = join(dir, "doc.pdf");
    writeFileSync(file, "x");
    const cygpath = join(dir, "cygpath");
    writeFileSync(
      cygpath,
      '#!/usr/bin/env bash\ncase "$1" in -m) printf "C:/nativa/doc.pdf" ;; -u) printf "%s" "$2" ;; esac\n',
    );
    chmodSync(cygpath, 0o755);
    const windows = bash(
      `PLATFORM=windows; ANONLY_REAL_DOC_R3="${file}"; export_real_doc_native ANONLY_REAL_DOC_R3; echo "$ANONLY_REAL_DOC_R3"`,
    );
    expect(windows.stdout.trim()).toBe("C:/nativa/doc.pdf");
    const mac = bash(
      `PLATFORM=darwin; ANONLY_REAL_DOC_R3="${file}"; export_real_doc_native ANONLY_REAL_DOC_R3; echo "$ANONLY_REAL_DOC_R3"`,
    );
    expect(mac.stdout.trim()).toBe(file);
  });

  it("ps_last_error redacta también la ruta de R3", () => {
    const result = bash(
      `PLATFORM=windows; ANONLY_REAL_DOC_R3='/c/privado/r3.pdf'; PS_DIR="${dir}"; printf 'fallo en /c/privado/r3.pdf aqui' >"${dir}/last-error.txt"; ps_last_error`,
    );
    expect(result.stdout).toContain("<ruta-redactada>");
    expect(result.stdout).not.toContain("privado");
  });
});

describe("validación de argumentos de los runners (antes de construir o medir)", () => {
  let calls = 0;
  function runner(script: string, env: Record<string, string>) {
    calls += 1;
    const output = join(dir, `salida-${calls}`);
    const result = spawnSync("bash", [resolve(ROOT, script)], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        ANONLY_OCR_POOL_OUTPUT_DIR: output,
        ANONLY_OCR_DPI_DOWN_OUTPUT_DIR: output,
        ...env,
      },
      cwd: ROOT,
    });
    const logFile = join(output, "campaign.log");
    const readRun = (name: string): unknown =>
      existsSync(join(output, name))
        ? (JSON.parse(readFileSync(join(output, name), "utf8")) as unknown)
        : undefined;
    return {
      status: result.status,
      log: existsSync(logFile) ? readFileSync(logFile, "utf8") : "",
      run: readRun("ocr-dpi-down-run.json"),
      runPool: readRun("ocr-pool-dpi-run.json"),
    };
  }

  it("fase 2: la lista de DPI tiene que incluir 300", () => {
    const result = runner("tests/perf/run-ocr-pool-dpi.sh", {
      ANONLY_OCR_POOL_DPI_ARMS: "250 200",
    });
    expect(result.status).toBe(1);
    expect(result.log).toContain("incluir 300");
  });

  it("fase 2: la lista de reconocedores tiene que incluir 2 (referencia de las huellas)", () => {
    const result = runner("tests/perf/run-ocr-pool-dpi.sh", { ANONLY_OCR_POOL_DPI_POOLS: "4 6" });
    expect(result.status).toBe(1);
    expect(result.log).toContain("incluir 2");
  });

  it("fase 2: un corpus desconocido aborta", () => {
    const result = runner("tests/perf/run-ocr-pool-dpi.sh", {
      ANONLY_OCR_POOL_DPI_PROFILES: "P2H X9",
    });
    expect(result.status).toBe(1);
    expect(result.log).toContain("corpus desconocido: X9");
  });

  it("ANONLY_OCR_POOL_PHASE=ultra-dpi en run-ocr-pool.sh llega al runner de la fase 2", () => {
    const result = runner("tests/perf/run-ocr-pool.sh", {
      ANONLY_OCR_POOL_PHASE: "ultra-dpi",
      ANONLY_OCR_POOL_DPI_ARMS: "250",
    });
    expect(result.status).toBe(1);
    expect(result.log).toContain("incluir 300");
  });

  it("fase 1: corpus y brazos inválidos abortan; un umbral inválido NO aborta (lo trata el agregador)", () => {
    expect(
      runner("tests/perf/run-ocr-dpi-down.sh", { ANONLY_OCR_DPI_DOWN_CORPUS: "S99" }).log,
    ).toContain("corpus desconocido: S99");
    expect(
      runner("tests/perf/run-ocr-dpi-down.sh", { ANONLY_OCR_DPI_DOWN_ARMS: "300 abc" }).log,
    ).toContain("brazo de DPI inválido");
    const invalid = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL: "1",
      ANONLY_OCR_DPI_DOWN_MIN_COVERAGE: "0,9",
    });
    expect(invalid.status).toBe(0);
    expect((invalid.run as { minCoverageRaw: string }).minCoverageRaw).toBe("0,9");
  });

  it("B-6: el humo y la tanda completa escriben el valor correcto de smoke, y los reales saltados quedan dichos", () => {
    const smoke = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_SMOKE: "1",
    });
    expect(smoke.run).toMatchObject({
      smoke: true,
      corpora: ["S10"],
      arms: [300, 150],
      minCoverageRaw: null,
    });
    const full = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL: "1",
    });
    expect(full.run).toMatchObject({
      smoke: false,
      corpora: ["S12", "S10", "S8", "S6", "SD1", "SD2", "SD3", "SD4", "SD5", "SE", "SR"],
      arms: [300, 250, 200, 150],
    });
    const skipped = (full.run as { skippedCorpora: Array<{ corpus: string }> }).skippedCorpora;
    expect(skipped.map((item) => item.corpus)).toEqual(["R2", "R3"]);
  });

  it("sin R2 la matriz completa corta al inicio, antes del build; con ALLOW_PARTIAL sigue con un aviso; el humo no lo necesita", () => {
    const cut = runner("tests/perf/run-ocr-dpi-down.sh", { ANONLY_OCR_DPI_DOWN_DRY_RUN: "1" });
    expect(cut.status).toBe(1);
    expect(cut.log).toContain("falta R2");
    expect(cut.log).toContain("ALLOW_PARTIAL=1");
    expect(cut.run).toBeUndefined();
    const allowed = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL: "1",
    });
    expect(allowed.status).toBe(0);
    expect(allowed.log).toContain("AVISO: SIN R2");
    expect(allowed.log).toContain("matriz-parcial-permitida");
    const smoke = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_SMOKE: "1",
    });
    expect(smoke.status).toBe(0);
    const subset = runner("tests/perf/run-ocr-dpi-down.sh", {
      ANONLY_OCR_DPI_DOWN_DRY_RUN: "1",
      ANONLY_OCR_DPI_DOWN_CORPUS: "S8 SD1",
    });
    expect(subset.status).toBe(0);
    expect(subset.log).toContain("R2 no está entre los corpus pedidos");
  });

  it("B-6 (fase 2): el humo y la tanda completa escriben el valor correcto de smoke", () => {
    const smoke = runner("tests/perf/run-ocr-pool-dpi.sh", {
      ANONLY_OCR_POOL_DPI_DRY_RUN: "1",
      ANONLY_OCR_POOL_DPI_SMOKE: "1",
    });
    expect(smoke.runPool).toMatchObject({
      smoke: true,
      profiles: ["P2H"],
      arms: ["2"],
      dpis: [300, 200],
    });
    const full = runner("tests/perf/run-ocr-pool-dpi.sh", { ANONLY_OCR_POOL_DPI_DRY_RUN: "1" });
    expect(full.runPool).toMatchObject({
      smoke: false,
      profiles: ["P2H", "SR"],
      arms: ["2", "4", "6"],
    });
  });
});

describe("campaign_preflight: producto limpio (O-7)", () => {
  function preflight(setup: string) {
    const repo = join(dir, "repo");
    writeFileSync(join(dir, "pgrep"), "#!/usr/bin/env bash\nexit 1\n");
    chmodSync(join(dir, "pgrep"), 0o755);
    return bash(
      [
        `mkdir -p "${repo}/packages" "${repo}/apps"`,
        `cd "${repo}"`,
        "git init -q . && git config user.email t@t && git config user.name t",
        "echo a > packages/a.txt && echo a > apps/a.txt && git add . && git commit -qm base",
        setup,
        'PLATFORM=darwin; ROOT_DIR="$PWD"; sleep_wake_digest() { printf a; }',
        "(campaign_preflight); echo rc=$?",
      ].join("; "),
    );
  }

  it("limpio: pasa", () => {
    expect(preflight("true").stdout).toContain("rc=0");
  });
  it.each([
    ["un archivo sin trackear", "echo x > packages/nuevo.txt"],
    ["un cambio solo en stage", "echo b > apps/a.txt && git add apps/a.txt"],
    ["un cambio sin stage", "echo b > packages/a.txt"],
  ])("control de fallo: %s en packages/ o apps/ aborta", (_label, setup) => {
    const result = preflight(setup);
    expect(result.stdout).toContain("rc=1");
  });
});
