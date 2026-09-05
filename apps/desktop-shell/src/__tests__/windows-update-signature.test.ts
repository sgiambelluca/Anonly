import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendWindowsUpdateSignature,
  decodeWindowsUpdateSignature,
  parseElectronBuilderWindowsManifest,
  signWindowsUpdate,
  verifyWindowsUpdateFile,
  windowsUpdatePublicKeyId,
  type SignedWindowsUpdate,
  type UnsignedWindowsUpdate,
} from "../windows-update-signature";

const VERSION = "0.9.1-beta.1";
const FILE = "Anonly-Setup-0.9.1-beta.1.exe";
const CONTENT = Buffer.from("instalador de prueba", "utf8");

let tempDir = "";
let installerPath = "";
let privateKeyPem = "";
let publicKeyBase64 = "";
let unsigned: UnsignedWindowsUpdate;
let signed: SignedWindowsUpdate;

function metadata(update: SignedWindowsUpdate): Record<string, unknown> {
  return {
    schema: update.schema,
    keyId: update.keyId,
    file: update.file,
    sha512: update.sha512,
    signature: update.signature,
  };
}

function updateInfo(
  update: SignedWindowsUpdate,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: update.version,
    files: [{ url: update.file, sha512: update.sha512 }],
    anonlyEd25519: metadata(update),
    ...overrides,
  };
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "anonly-windows-signature-"));
  installerPath = join(tempDir, "installer.exe");
  await writeFile(installerPath, CONTENT);

  const pair = generateKeyPairSync("ed25519");
  privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publicKeyBase64 = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  unsigned = {
    version: VERSION,
    file: FILE,
    sha512: createHash("sha512").update(CONTENT).digest("base64"),
  };
  signed = signWindowsUpdate(unsigned, privateKeyPem, publicKeyBase64);
});

afterAll(async () => {
  if (tempDir !== "") await rm(tempDir, { recursive: true, force: true });
});

describe("firma Ed25519 de actualizaciones Windows", () => {
  it("acepta el instalador, versión y nombre que CI firmó", async () => {
    const decoded = decodeWindowsUpdateSignature(
      updateInfo(signed),
      windowsUpdatePublicKeyId(publicKeyBase64),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    await expect(
      verifyWindowsUpdateFile(installerPath, decoded.value, publicKeyBase64),
    ).resolves.toBe(null);
  });

  it("rechaza bytes alterados aunque la metadata conserve una firma válida", async () => {
    const alteredPath = join(tempDir, "alterado.exe");
    await writeFile(alteredPath, "otro instalador");
    await expect(verifyWindowsUpdateFile(alteredPath, signed, publicKeyBase64)).resolves.toContain(
      "bytes descargados",
    );
  });

  it("rechaza el replay de un instalador firmado bajo otra versión", async () => {
    const decoded = decodeWindowsUpdateSignature(
      updateInfo(signed, { version: "99.0.0" }),
      windowsUpdatePublicKeyId(publicKeyBase64),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    await expect(
      verifyWindowsUpdateFile(installerPath, decoded.value, publicKeyBase64),
    ).resolves.toContain("firma Ed25519");
  });

  it("rechaza firma ausente, clave desconocida y archivos que no coinciden", () => {
    const expectedKeyId = windowsUpdatePublicKeyId(publicKeyBase64);
    expect(decodeWindowsUpdateSignature({ version: VERSION, files: [] }, expectedKeyId).ok).toBe(
      false,
    );
    expect(decodeWindowsUpdateSignature(updateInfo(signed), "sha256:otra-clave").ok).toBe(false);
    expect(
      decodeWindowsUpdateSignature(
        updateInfo(signed, { files: [{ url: "otro.exe", sha512: signed.sha512 }] }),
        expectedKeyId,
      ).ok,
    ).toBe(false);
    expect(
      decodeWindowsUpdateSignature(
        updateInfo(signed, {
          files: [
            { url: signed.file, sha512: signed.sha512 },
            { url: "inyectado.exe", sha512: signed.sha512 },
          ],
        }),
        expectedKeyId,
      ).ok,
    ).toBe(false);
  });

  it("rechaza una firma base64 malformada", () => {
    const info = updateInfo(signed, {
      anonlyEd25519: { ...metadata(signed), signature: "no-es-una-firma" },
    });
    expect(decodeWindowsUpdateSignature(info, windowsUpdatePublicKeyId(publicKeyBase64)).ok).toBe(
      false,
    );
  });

  it("no firma si la privada no corresponde a la pública esperada", () => {
    const otherPair = generateKeyPairSync("ed25519");
    const otherPrivate = otherPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => signWindowsUpdate(unsigned, otherPrivate, publicKeyBase64)).toThrow(
      "no corresponde",
    );
  });

  it("falla cerrado si el archivo descargado no se puede leer", async () => {
    await expect(
      verifyWindowsUpdateFile(join(tempDir, "no-existe.exe"), signed, publicKeyBase64),
    ).resolves.toContain("no se pudo verificar");
  });
});

describe("metadata de electron-builder", () => {
  const fakeSha512 = `${"A".repeat(86)}==`;
  const manifest = `version: ${VERSION}
files:
  - url: ${FILE}
    sha512: ${fakeSha512}
    size: 123
path: ${FILE}
sha512: ${fakeSha512}
releaseDate: '2026-09-05T00:00:00.000Z'
`;

  it("lee exactamente el exe y agrega una sola extensión firmada", () => {
    const parsed = parseElectronBuilderWindowsManifest(manifest);
    expect(parsed).toEqual({ version: VERSION, file: FILE, sha512: fakeSha512 });
    const output = appendWindowsUpdateSignature(manifest, { ...signed, ...parsed });
    expect(output).toContain("\nanonlyEd25519:\n");
    expect(output).toContain(`  keyId: ${JSON.stringify(signed.keyId)}`);
    expect(() => appendWindowsUpdateSignature(output, signed)).toThrow("ya contiene");
  });

  it("rechaza un manifiesto ambiguo o sin instalador", () => {
    expect(() => parseElectronBuilderWindowsManifest("version: 1.0.0\nfiles: []\n")).toThrow(
      "exactamente un instalador",
    );
    expect(() => parseElectronBuilderWindowsManifest(`${manifest}${manifest}`)).toThrow(
      "exactamente un instalador",
    );
  });
});
