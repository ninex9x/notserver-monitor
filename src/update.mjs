import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function loadUpdateRelease(updateDirectory) {
  const metadata = JSON.parse(await readFile(join(updateDirectory, "latest.json"), "utf8"));
  const versionCode = Number(metadata.versionCode);
  const versionName = String(metadata.versionName || "").trim();
  const sha256 = String(metadata.sha256 || "").trim().toLowerCase();
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error("versionCode de atualização inválido.");
  if (!versionName || !SHA256_PATTERN.test(sha256)) throw new Error("Metadados de atualização inválidos.");

  const apkPath = join(updateDirectory, "notserver-monitor.apk");
  const apk = await stat(apkPath);
  if (!apk.isFile() || apk.size < 1) throw new Error("APK de atualização indisponível.");

  return {
    apkPath,
    metadata: {
      versionCode,
      versionName,
      sha256,
      size: apk.size,
      publishedAt: metadata.publishedAt || null,
    },
  };
}
