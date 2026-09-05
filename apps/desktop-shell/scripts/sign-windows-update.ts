import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  appendWindowsUpdateSignature,
  parseElectronBuilderWindowsManifest,
  sha512File,
  signWindowsUpdate,
} from "../src/windows-update-signature";

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin as AsyncIterable<string>) input += chunk;
  return input.trim();
}

async function main(): Promise<void> {
  const privateKey = await readStdin();
  if (privateKey.length === 0) {
    throw new Error("falta WINDOWS_UPDATE_PRIVATE_KEY por stdin");
  }

  const releaseDir = join(__dirname, "..", "release");
  const files = await readdir(releaseDir);
  const installers = files.filter((file) => file.toLowerCase().endsWith(".exe"));
  if (installers.length !== 1) {
    throw new Error(`Se esperaba exactamente un instalador Windows y hay ${installers.length}`);
  }

  const installer = installers[0];
  if (installer === undefined) throw new Error("No se encontró el instalador Windows");

  const manifestPath = join(releaseDir, "latest.yml");
  const manifest = await readFile(manifestPath, "utf8");
  const unsigned = parseElectronBuilderWindowsManifest(manifest);
  const installerPath = join(releaseDir, installer);
  const expectedManifestName = basename(installerPath).replaceAll(" ", "-");
  if (unsigned.file !== expectedManifestName) {
    throw new Error("latest.yml no apunta al instalador Windows producido por este build");
  }

  const actualSha512 = await sha512File(installerPath);
  if (actualSha512 !== unsigned.sha512) {
    throw new Error("el SHA-512 de latest.yml no coincide con el instalador producido");
  }

  const signed = signWindowsUpdate(unsigned, privateKey);
  await writeFile(manifestPath, appendWindowsUpdateSignature(manifest, signed), "utf8");
  process.stdout.write(
    `[anonly] actualización Windows firmada: ${signed.file} (${signed.keyId})\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "error desconocido";
  process.stderr.write(`[anonly] no se pudo firmar la actualización Windows: ${message}\n`);
  process.exitCode = 1;
});
