import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUpdateRelease } from "../src/update.mjs";

test("carrega metadados da APK sem aceitar nomes de arquivo externos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "notserver-update-"));
  try {
    await writeFile(join(directory, "notserver-monitor.apk"), "apk");
    await writeFile(join(directory, "latest.json"), JSON.stringify({
      versionCode: 3,
      versionName: "1.2.0",
      sha256: "a".repeat(64),
      file: "../../arquivo-inseguro.apk",
    }));
    const release = await loadUpdateRelease(directory);
    assert.equal(release.metadata.versionCode, 3);
    assert.equal(release.metadata.size, 3);
    assert.equal(release.apkPath, join(directory, "notserver-monitor.apk"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejeita hash de atualização inválido", async () => {
  const directory = await mkdtemp(join(tmpdir(), "notserver-update-"));
  try {
    await writeFile(join(directory, "notserver-monitor.apk"), "apk");
    await writeFile(join(directory, "latest.json"), JSON.stringify({ versionCode: 3, versionName: "1.2.0", sha256: "fraco" }));
    await assert.rejects(() => loadUpdateRelease(directory), /inválidos/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
