import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  scripts?: Record<string, string>;
};

describe("release safety gate", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageManifest;
  const scripts = manifest.scripts ?? {};

  it("makes account identity and two-device cloud conflict coverage mandatory", () => {
    expect(scripts["release:account-sync-gate"]).toContain("tests/accountCloudSync.test.ts");
    expect(scripts["release:account-sync-gate"]).toContain("tests/accountCloudSyncQueue.test.ts");
    expect(scripts["release:account-sync-gate"]).toContain("tests/accountCloudRestoreCoordinator.test.ts");
    expect(scripts["release:account-sync-gate"]).toContain("tests/accountIdentity.test.ts");
    expect(scripts["release:account-sync-gate"]).toContain("tests/accountSyncConfidence.test.ts");
    expect(scripts["release:gate"]).toContain("npm run release:account-sync-gate");
  });

  it("blocks both Windows and macOS packaging behind the release gate", () => {
    expect(scripts["electron:build"]).toMatch(/^npm run release:gate && /);
    expect(scripts["electron:build:mac"]).toMatch(/^npm run release:gate && /);
  });
});
