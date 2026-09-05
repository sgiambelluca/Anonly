/**
 * Los gates de seguridad del contenedor (ADR-132 §5).
 *
 * `08_Security_Model.md` §11 los declara; acá se ejecutan. Reemplazan a
 * `csp-strict`, `no-third-party-connect` y `sri-present`, que estaban escritos
 * para un origen web servido por HTTP: no cambia la intención, cambia el
 * mecanismo — ya no hay un servidor cuyas response headers leer.
 *
 * Absorben además a `shell-boot.spec.ts`, que verificaba estas mismas
 * propiedades sin nombrarlas como gates.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";

test.setTimeout(300_000);

test("gate `webprefs-locked`: el renderer no tiene llaves del sistema", async ({
  page,
  electronApp,
}) => {
  await openApp(page);

  const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    /*
     * `getLastWebPreferences()` existe en runtime pero no está en los tipos
     * públicos de Electron. Se accede con un cast acotado y se tolera que no
     * esté: la aserción que de verdad manda es la de abajo, sobre los efectos.
     */
    const contents = win?.webContents as unknown as {
      getLastWebPreferences?: () => Record<string, unknown> | null;
    };
    const p = contents?.getLastWebPreferences?.() ?? {};
    return {
      contextIsolation: p["contextIsolation"],
      sandbox: p["sandbox"],
      nodeIntegration: p["nodeIntegration"],
      webSecurity: p["webSecurity"],
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  });

  // Y comprobado desde adentro: el renderer procesa documentos de terceros,
  // así que lo que importa no es la config sino que Node sea inalcanzable.
  const alcanzable = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require !== "undefined",
    process: typeof (globalThis as { process?: unknown }).process !== "undefined",
  }));
  expect(alcanzable).toEqual({ require: false, process: false });
});

test("gate `cross-origin-isolated`: el aislamiento llega adentro de los workers", async ({
  page,
}) => {
  await openApp(page);

  // En el renderer.
  expect(
    await page.evaluate(() => ({
      crossOriginIsolated: self.crossOriginIsolated,
      isSecureContext: self.isSecureContext,
      sab: typeof SharedArrayBuffer !== "undefined",
    })),
  ).toEqual({ crossOriginIsolated: true, isSecureContext: true, sab: true });

  /*
   * Y adentro de un worker, que es donde de verdad importa: sin esto
   * `onnxruntime-web` se autolimita a un hilo y la inferencia tarda el doble
   * (ADR-100: 13 564 ms contra 6 287 ms).
   */
  const enWorker = await page.evaluate(async () => {
    const src = `self.postMessage({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer !== "undefined" });`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return await new Promise<unknown>((resolve) => {
      const w = new Worker(url, { type: "module" });
      w.onmessage = (e) => resolve(e.data);
      setTimeout(() => resolve({ error: "timeout" }), 5000);
    });
  });
  expect(enWorker).toEqual({ iso: true, sab: true });
});

test("gate `csp-under-app-protocol`: la política llega bajo el esquema propio", async ({
  page,
}) => {
  await openApp(page);

  const csp = await page.evaluate(async () => {
    const res = await fetch("app://local/index.html");
    return res.headers.get("content-security-policy");
  });

  expect(csp, "el documento tiene que llegar con CSP").not.toBeNull();
  // Las tres que sostienen el modelo: nada de terceros, nada de eval, nada de
  // plugins. `connect-src 'self'` sin excepciones es lo que impide exfiltrar
  // un documento aunque hubiera una inyección (ADR-132 §1).
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/connect-src[^;]*(https?:|\*)/);

  const aislamiento = await page.evaluate(async () => {
    const res = await fetch("app://local/index.html");
    return {
      coop: res.headers.get("cross-origin-opener-policy"),
      coep: res.headers.get("cross-origin-embedder-policy"),
    };
  });
  expect(aislamiento).toEqual({ coop: "same-origin", coep: "require-corp" });
});

test("gate `shell-no-egress`: un pipeline completo no habla con ningún host", async ({
  page,
  electronApp,
}) => {
  await electronApp.evaluate(({ session }) => {
    const vistos: string[] = [];
    (globalThis as { __egress?: string[] }).__egress = vistos;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      vistos.push(details.url);
      callback({});
    });
  });

  await openApp(page);
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await page.getByRole("button", { name: "Exportar" }).waitFor({ timeout: 240_000 });

  const todos = await electronApp.evaluate(
    () => (globalThis as { __egress?: string[] }).__egress ?? [],
  );

  /*
   * `file://` y `app://` no son salidas de red: son el propio handler del
   * protocolo leyendo el disco. Lo que este gate prohíbe es un host.
   *
   * **Dos cosas que este gate NO cubre**, y hay que decirlas para que nadie lo
   * lea como más fuerte de lo que es:
   *
   * 1. Solo observa lo que pasa por la sesión. Un servicio interno de Chromium
   *    en otro contexto no aparecería. Por eso ADR-132 §4 **apaga** esos
   *    caminos además de medirlos: el gate prueba lo observable, los switches
   *    cierran lo que no.
   * 2. **No ejercita el actualizador**, que es justamente el único componente
   *    que sí habla con la red. Los E2E corren la app desempaquetada, donde el
   *    `Info.plist` no tiene `SUPublicEDKey` y Sparkle no arranca — así que acá
   *    el gate pasaría igual aunque el actualizador filtrara algo. Eso lo
   *    cubren `network-destinations.test.ts`, que enumera desde el código los
   *    destinos que el shell tiene permitido nombrar, y `updater-payload-clean`,
   *    que fija qué viaja por ese canal.
   */
  const aHosts = todos.filter((u) => /^https?:/i.test(u));
  expect(aHosts, `la app pidió a un host: ${JSON.stringify([...new Set(aHosts)])}`).toEqual([]);
  expect(
    todos.length,
    "la sonda no registró nada: el gate no estaría probando nada",
  ).toBeGreaterThan(0);

  /*
   * Precondición explícita: que el pipeline haya corrido de verdad. Sin esto,
   * un cambio que rompa la importación dejaría el gate en verde con cero
   * requests — el peor modo de falla de un test de ausencia.
   */
  expect(
    todos.filter((u) => u.includes("model_quantized.onnx")).length,
    "el modelo NER no se pidió: el pipeline no corrió y el gate no probó nada",
  ).toBeGreaterThan(0);
});

test("gate `no-cache-storage-writes`: no se intenta cachear lo que ya es local", async ({
  page,
}) => {
  const fallosDeCache: string[] = [];
  page.on("console", (m) => {
    if (/Cache|cache/.test(m.text()) && /put|unsupported/.test(m.text())) {
      fallosDeCache.push(m.text());
    }
  });

  await openApp(page);
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await page.getByRole("button", { name: "Exportar" }).waitFor({ timeout: 240_000 });

  /*
   * `Cache Storage` rechaza el esquema `app://`, así que un intento de escribir
   * deja `Failed to execute 'put' on 'Cache'` en consola. ADR-132 §7 apagó esa
   * capa en el motor de NER; este gate verifica que siga apagada — el ruido
   * volvería en silencio si alguien la reactivara.
   */
  expect(fallosDeCache, `intentos de escribir en Cache Storage: ${fallosDeCache.length}`).toEqual(
    [],
  );
});
