import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  scripts?: Record<string, string>;
};

describe("release safety gate", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageManifest;
  const macWorkflow = readFileSync(new URL("../.github/workflows/build-mac.yml", import.meta.url), "utf8");
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

  it("uses Node 24 action versions throughout the macOS workflow", () => {
    expect(macWorkflow).toContain("uses: actions/checkout@v7");
    expect(macWorkflow).toContain("uses: actions/setup-node@v7");
    expect(macWorkflow).toContain("uses: actions/upload-artifact@v7");
    expect(macWorkflow).toContain("uses: softprops/action-gh-release@v3");
    expect(macWorkflow).not.toMatch(/uses: actions\/(?:checkout|setup-node)@v[1-6]\b/);
    expect(macWorkflow).not.toMatch(/uses: actions\/upload-artifact@v[1-6]\b/);
    expect(macWorkflow).not.toMatch(/uses: softprops\/action-gh-release@v[1-2]\b/);
  });

  it("validates source before the central Mac packager and artifact verifiers run", () => {
    const gateIndex = macWorkflow.indexOf("run: npm run release:gate");
    const buildIndex = macWorkflow.indexOf("run: npm run build");
    const prepareIndex = macWorkflow.indexOf("run: npm run package:prepare-mac-ffmpeg");
    const packageIndex = macWorkflow.indexOf("run: npm run package:mac");
    const verifyIndex = macWorkflow.indexOf("run: npm run release:verify:mac");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(gateIndex);
    expect(prepareIndex).toBeGreaterThan(buildIndex);
    expect(packageIndex).toBeGreaterThan(prepareIndex);
    expect(verifyIndex).toBeGreaterThan(packageIndex);
    expect(macWorkflow).not.toContain("Use Mac update feed");
  });
});
