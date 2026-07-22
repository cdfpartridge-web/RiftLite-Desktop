import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { RIFTLITE_BUILD_IDENTITY } from "../src/shared/buildIdentity";

interface PackageBuildConfig {
  appId?: string;
  productName?: string;
  executableName?: string;
  artifactName?: string;
  publish?: Array<{ provider?: string; owner?: string; repo?: string }>;
  protocols?: Array<{ name?: string; schemes?: string[] }>;
  directories?: { output?: string };
  mac?: { artifactName?: string };
  nsis?: { shortcutName?: string; uninstallDisplayName?: string };
}

interface PackageManifest {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  build?: PackageBuildConfig;
}

const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as PackageManifest;

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const macWorkflowSource = readFileSync(
  new URL("../.github/workflows/build-mac.yml", import.meta.url),
  "utf8"
);
const afterPackSource = readFileSync(new URL("../build/afterPack.cjs", import.meta.url), "utf8");
const macPackageSource = readFileSync(new URL("../scripts/package-mac-release.cjs", import.meta.url), "utf8");

const PRODUCTION_CONTINUITY = {
  appId: "com.riftlite.desktop.beta06",
  userDataDirectory: "RiftLite Beta 0.6",
  mediaDirectoryName: "RiftLite",
  protocol: "riftlite",
  output: "release",
  windowsArtifact: "RiftLiteBetaInstall.${ext}",
  macArtifact: "RiftLiteBetaInstall-${arch}.${ext}"
} as const;

describe("RiftLite v0.9 production build identity", () => {
  it("keeps the released app, profile, media, and deep-link continuity identifiers", () => {
    expect(RIFTLITE_BUILD_IDENTITY).toMatchObject({
      flavor: "production",
      appName: "RiftLite Beta 0.9",
      appId: PRODUCTION_CONTINUITY.appId,
      userDataDirectory: PRODUCTION_CONTINUITY.userDataDirectory,
      mediaDirectoryName: PRODUCTION_CONTINUITY.mediaDirectoryName,
      protocol: PRODUCTION_CONTINUITY.protocol,
      packageVersion: "0.9.11",
      displayVersion: "0.9.11",
      updatesEnabled: true,
      usageAnalyticsEnabled: true
    });
  });

  it("keeps runtime storage on the historical production roots", () => {
    expect(mainSource).toContain('join(app.getPath("appData"), RIFTLITE_BUILD_IDENTITY.userDataDirectory)');
    expect(mainSource).toContain('join(app.getPath("pictures"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName)');
    expect(mainSource).toContain('join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Replay Bundles")');
    expect(mainSource).toContain('join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Backups")');
    expect(mainSource).toContain('join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Replay Videos")');
    expect(mainSource).not.toContain('join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.appName');
    expect(mainSource).not.toContain('join(app.getPath("pictures"), RIFTLITE_BUILD_IDENTITY.appName');
  });

  it("aligns package metadata with the production v0.9 identity", () => {
    const build = packageManifest.build;

    expect(packageManifest.name).toBe("riftlite-desktop-v09");
    expect(packageManifest.version).toBe("0.9.11");
    expect(build?.appId).toBe(PRODUCTION_CONTINUITY.appId);
    expect(build?.productName).toBe(RIFTLITE_BUILD_IDENTITY.appName);
    expect(build?.executableName).toBe(RIFTLITE_BUILD_IDENTITY.appName);
    expect(build?.nsis?.shortcutName).toBe(RIFTLITE_BUILD_IDENTITY.appName);
    expect(build?.nsis?.uninstallDisplayName).toBe(RIFTLITE_BUILD_IDENTITY.appName);
  });

  it("uses only the production protocol and stable release artifact paths", () => {
    const build = packageManifest.build;
    const schemes = build?.protocols?.flatMap((entry) => entry.schemes ?? []) ?? [];

    expect(schemes).toEqual([PRODUCTION_CONTINUITY.protocol]);
    expect(build?.directories?.output).toBe(PRODUCTION_CONTINUITY.output);
    expect(build?.artifactName).toBe(PRODUCTION_CONTINUITY.windowsArtifact);
    expect(build?.mac?.artifactName).toBe(PRODUCTION_CONTINUITY.macArtifact);
  });

  it("packages the production updater feed without allowing local builds to publish", () => {
    const build = packageManifest.build;

    expect(build?.publish).toEqual([
      {
        provider: "github",
        owner: "cdfpartridge-web",
        repo: "RiftLite-Desktop"
      }
    ]);
    expect(packageManifest.scripts?.["electron:build"]).toContain("--publish never");
    expect(packageManifest.scripts?.["electron:build:mac"]).toContain("npm run package:mac");
    expect(macPackageSource).toContain('publish: "never"');
  });

  it("builds the game preload before development smoke tests and fails closed on missing packaged tools", () => {
    expect(packageManifest.scripts?.["electron:smoke"]).toContain("npm run build:game-preload");
    expect(afterPackSource).toContain("Cannot stamp the Windows executable because rcedit is missing");
    expect(afterPackSource).toContain("Cannot package replay video support because the FFmpeg binary is missing");
    expect(afterPackSource).toContain("Cannot package replay video support because the FFmpeg license is missing");
  });

  it("refuses to publish a macOS tag that does not match the package version", () => {
    expect(macWorkflowSource).toContain("if: github.ref_type == 'tag'");
    expect(macWorkflowSource).toContain('const expectedTag = `mac-v${pkg.version}`;');
    expect(macWorkflowSource).toContain("process.env.RELEASE_TAG !== expectedTag");
  });
});
