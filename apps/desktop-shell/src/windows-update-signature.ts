import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Clave pública del actualizador de Windows (ADR-137).
 *
 * Es un SubjectPublicKeyInfo DER codificado en base64. La privada correspondiente
 * vive únicamente en el secret `WINDOWS_UPDATE_PRIVATE_KEY` de GitHub Actions y
 * en el backup que custodia el responsable del proyecto.
 */
export const WINDOWS_UPDATE_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEARf1pb0E+LTmSemtL69mQcQGTSzZPAZp5CUaI2sljCLY=";

/** Fuerza a `electron-updater` a invocar el callback aun sin Authenticode. */
export const ED25519_ONLY_PUBLISHER = "__ANONLY_ED25519_ONLY__";

const SIGNATURE_DOMAIN = "anonly-windows-update-v1";
const SHA512_BYTES = 64;
const ED25519_SIGNATURE_BYTES = 64;

export interface UnsignedWindowsUpdate {
  readonly version: string;
  readonly file: string;
  readonly sha512: string;
}

export interface SignedWindowsUpdate extends UnsignedWindowsUpdate {
  readonly schema: 1;
  readonly keyId: string;
  readonly signature: string;
}

export type WindowsUpdateSignatureDecodeResult =
  | { readonly ok: true; readonly value: SignedWindowsUpdate }
  | { readonly ok: false; readonly error: string };

interface RecordValue {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCanonicalBase64(value: unknown, bytes: number): string | null {
  if (typeof value !== "string") return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== value) return null;
  return value;
}

function toPublicKey(encoded: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "spki",
  });
}

/** Identificador estable de una pública: SHA-256 de sus bytes SPKI DER. */
export function windowsUpdatePublicKeyId(encoded: string): string {
  const der = Buffer.from(encoded, "base64");
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

export const WINDOWS_UPDATE_PUBLIC_KEY_ID = windowsUpdatePublicKeyId(
  WINDOWS_UPDATE_PUBLIC_KEY_SPKI_BASE64,
);

/**
 * Bytes exactos que firma CI y verifica la app.
 *
 * Un array JSON de posiciones fijas evita depender del formato de `latest.yml`
 * y ata el artefacto a su versión y nombre, además de a sus bytes.
 */
export function windowsUpdateSignatureEnvelope(update: UnsignedWindowsUpdate): Buffer {
  return Buffer.from(
    JSON.stringify([SIGNATURE_DOMAIN, update.version, update.file, update.sha512]),
    "utf8",
  );
}

/** SHA-512 base64 sin cargar el instalador completo en memoria. */
export async function sha512File(filePath: string): Promise<string> {
  const hash = createHash("sha512");
  const stream = createReadStream(filePath);
  for await (const chunk of stream as AsyncIterable<Uint8Array>) hash.update(chunk);
  return hash.digest("base64");
}

/**
 * Firma metadata de release y rechaza una privada que no corresponda a la
 * pública horneada. El error nunca incluye material de la clave privada.
 */
export function signWindowsUpdate(
  update: UnsignedWindowsUpdate,
  privateKeyPem: string,
  expectedPublicKey = WINDOWS_UPDATE_PUBLIC_KEY_SPKI_BASE64,
): SignedWindowsUpdate {
  const privateKey = createPrivateKey(privateKeyPem);
  const derivedPublic = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const expectedPublic = Buffer.from(expectedPublicKey, "base64");

  if (
    derivedPublic.length !== expectedPublic.length ||
    !timingSafeEqual(derivedPublic, expectedPublic)
  ) {
    throw new Error("La clave privada de Windows no corresponde a la pública horneada");
  }

  return {
    schema: 1,
    keyId: windowsUpdatePublicKeyId(expectedPublicKey),
    ...update,
    signature: sign(null, windowsUpdateSignatureEnvelope(update), privateKey).toString("base64"),
  };
}

/**
 * Decodifica la extensión propia de `latest.yml` y la cruza con el `.exe` que
 * `electron-updater` seleccionará. No confía en anotaciones de TypeScript sobre
 * datos que llegaron de la red.
 */
export function decodeWindowsUpdateSignature(
  updateInfo: unknown,
  expectedKeyId = WINDOWS_UPDATE_PUBLIC_KEY_ID,
): WindowsUpdateSignatureDecodeResult {
  if (!isRecord(updateInfo)) return { ok: false, error: "manifiesto de actualización inválido" };

  const version = updateInfo.version;
  const files = updateInfo.files;
  const signature = updateInfo.anonlyEd25519;
  if (typeof version !== "string" || version.length === 0 || !Array.isArray(files)) {
    return { ok: false, error: "manifiesto de actualización incompleto" };
  }
  if (!isRecord(signature)) {
    return { ok: false, error: "la actualización no tiene firma Ed25519" };
  }

  const file = signature.file;
  const sha512 = decodeCanonicalBase64(signature.sha512, SHA512_BYTES);
  const encodedSignature = decodeCanonicalBase64(signature.signature, ED25519_SIGNATURE_BYTES);

  if (
    signature.schema !== 1 ||
    signature.keyId !== expectedKeyId ||
    typeof file !== "string" ||
    file.length === 0 ||
    sha512 === null ||
    encodedSignature === null
  ) {
    return { ok: false, error: "metadata de firma Ed25519 inválida" };
  }

  const executableFiles = files.filter(
    (candidate): candidate is RecordValue =>
      isRecord(candidate) &&
      typeof candidate.url === "string" &&
      candidate.url.toLowerCase().endsWith(".exe"),
  );
  const matchingFiles = executableFiles.filter(
    (candidate): candidate is RecordValue => candidate.url === file && candidate.sha512 === sha512,
  );
  if (executableFiles.length !== 1 || matchingFiles.length !== 1) {
    return { ok: false, error: "la firma no corresponde al instalador anunciado" };
  }

  return {
    ok: true,
    value: {
      schema: 1,
      keyId: expectedKeyId,
      version,
      file,
      sha512,
      signature: encodedSignature,
    },
  };
}

/**
 * Verifica la firma y después los bytes descargados. Un texto rechaza la
 * actualización; `null` conserva la convención de `electron-updater`.
 */
export async function verifyWindowsUpdateFile(
  filePath: string,
  update: SignedWindowsUpdate,
  publicKey = WINDOWS_UPDATE_PUBLIC_KEY_SPKI_BASE64,
): Promise<string | null> {
  try {
    if (update.keyId !== windowsUpdatePublicKeyId(publicKey)) {
      return "la actualización fue firmada por una clave desconocida";
    }

    const validSignature = verify(
      null,
      windowsUpdateSignatureEnvelope(update),
      toPublicKey(publicKey),
      Buffer.from(update.signature, "base64"),
    );
    if (!validSignature) return "la firma Ed25519 de la actualización es inválida";

    const actualSha512 = Buffer.from(await sha512File(filePath), "base64");
    const expectedSha512 = Buffer.from(update.sha512, "base64");
    if (
      actualSha512.length !== expectedSha512.length ||
      !timingSafeEqual(actualSha512, expectedSha512)
    ) {
      return "los bytes descargados no corresponden a la actualización firmada";
    }

    return null;
  } catch {
    return "no se pudo verificar la actualización descargada";
  }
}

/** Lee el formato estable que `electron-builder` genera para Windows. */
export function parseElectronBuilderWindowsManifest(manifest: string): UnsignedWindowsUpdate {
  const version = /^version:\s*([^\s#]+)\s*$/m.exec(manifest)?.[1];
  const fileEntry = /^\s*-\s+url:\s*([^\r\n]+\.exe)\s*\r?\n\s+sha512:\s*([A-Za-z0-9+/]+=*)\s*$/gim;
  const matches = [...manifest.matchAll(fileEntry)];

  if (version === undefined || matches.length !== 1) {
    throw new Error("latest.yml no describe exactamente un instalador Windows");
  }
  const file = matches[0]?.[1]?.trim();
  const sha512 = matches[0]?.[2];
  if (
    file === undefined ||
    sha512 === undefined ||
    decodeCanonicalBase64(sha512, SHA512_BYTES) === null
  ) {
    throw new Error("latest.yml contiene metadata inválida para el instalador Windows");
  }
  return { version, file, sha512 };
}

/** Agrega la extensión YAML sin reserializar campos de `electron-builder`. */
export function appendWindowsUpdateSignature(
  manifest: string,
  update: SignedWindowsUpdate,
): string {
  if (/^anonlyEd25519:/m.test(manifest)) {
    throw new Error("latest.yml ya contiene una firma Ed25519");
  }

  const yaml = [
    "anonlyEd25519:",
    `  schema: ${update.schema}`,
    `  keyId: ${JSON.stringify(update.keyId)}`,
    `  file: ${JSON.stringify(update.file)}`,
    `  sha512: ${JSON.stringify(update.sha512)}`,
    `  signature: ${JSON.stringify(update.signature)}`,
  ].join("\n");
  return `${manifest.trimEnd()}\n${yaml}\n`;
}
