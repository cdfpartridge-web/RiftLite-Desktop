import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

describe("release packaging continuity", () => {
  it("keeps the installed identity, protocol, updater, and installer name stable", () => {
    const manifest = JSON.parse(readFileSync(resolve(projectDirectory, "package.json"), "utf8")) as {
      version: string;
      build: {
        appId: string;
        productName: string;
        executableName: string;
        artifactName: string;
        protocols: Array<{ schemes: string[] }>;
        publish: Array<{ provider: string; owner: string; repo: string }>;
      };
    };

    expect(manifest.version).toBe("0.9.11");
    expect(manifest.build).toMatchObject({
      appId: "com.riftlite.desktop.beta06",
      productName: "RiftLite Beta 0.9",
      executableName: "RiftLite Beta 0.9",
      artifactName: "RiftLiteBetaInstall.${ext}"
    });
    expect(manifest.build.protocols.some((entry) => entry.schemes.includes("riftlite"))).toBe(true);
    expect(manifest.build.publish).toContainEqual({
      provider: "github",
      owner: "cdfpartridge-web",
      repo: "RiftLite-Desktop"
    });
  });

  it("stages separate Mac FFmpeg architectures inside the actual app bundle", () => {
    const manifest = JSON.parse(readFileSync(resolve(projectDirectory, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      build: {
        mac: {
          artifactName: string;
          target: Array<{ target: string; arch: string[] }>;
        };
      };
    };
    const afterPack = readFileSync(resolve(projectDirectory, "build", "afterPack.cjs"), "utf8");
    const prepare = readFileSync(resolve(projectDirectory, "scripts", "prepare-mac-ffmpeg.cjs"), "utf8");
    const packageMac = readFileSync(resolve(projectDirectory, "scripts", "package-mac-release.cjs"), "utf8");
    const macConfig = readFileSync(resolve(projectDirectory, "scripts", "mac-release-config.cjs"), "utf8");
    const verify = readFileSync(resolve(projectDirectory, "scripts", "verify-mac-release-artifacts.mjs"), "utf8");
    const verifyApps = readFileSync(resolve(projectDirectory, "scripts", "verify-packaged-mac-apps.mjs"), "utf8");
    const workflow = readFileSync(resolve(projectDirectory, ".github", "workflows", "build-mac.yml"), "utf8");

    expect(manifest.build.mac.artifactName).toBe("RiftLiteBetaInstall-${arch}.${ext}");
    expect(manifest.build.mac.target).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "dmg", arch: expect.arrayContaining(["x64", "arm64"]) }),
      expect.objectContaining({ target: "zip", arch: expect.arrayContaining(["x64", "arm64"]) })
    ]));
    expect(manifest.scripts["release:verify:mac"]).toBe("node scripts/verify-mac-release-artifacts.mjs");
    expect(manifest.scripts["release:verify:mac-apps"]).toBe("node scripts/verify-packaged-mac-apps.mjs");
    expect(manifest.scripts["package:mac"]).toBe("node scripts/package-mac-release.cjs");
    expect(manifest.scripts["electron:build:mac"]).toMatch(
      /package:prepare-mac-ffmpeg.+package:mac.+release:verify:mac.+release:verify:mac-apps.+release:smoke:packaged/
    );
    expect(afterPack).toContain("Arch[context.arch]");
    expect(afterPack).toContain('"Contents", "Resources"');
    expect(afterPack).toContain('"riftlite-ffmpeg"');
    expect(afterPack).toContain('execFileSync("lipo", ["-archs", ffmpegPath]');
    expect(prepare).toContain('{ npmArch: "x64", machoArch: "x86_64" }');
    expect(prepare).toContain('{ npmArch: "arm64", machoArch: "arm64" }');
    expect(packageMac).toContain('require("./mac-release-config.cjs")');
    expect(macConfig).toContain('repo: "RiftLite-Desktop-Mac"');
    expect(macConfig).toContain("publish: { ...MAC_PUBLISH_CONFIGURATION }");
    expect(packageMac).toContain('Platform.MAC.createTarget(["dmg", "zip"], Arch.x64, Arch.arm64)');
    expect(verifyApps).toContain('yamlScalar(updater, key) === expectedIdentity[key]');
    expect(verifyApps).toContain('command("codesign", ["--verify", "--deep", "--strict"');
    expect(verifyApps).toContain('command("hdiutil", ["verify"');
    expect(workflow).toContain("npm run package:prepare-mac-ffmpeg");
    expect(workflow).toContain("npm run package:mac");
    expect(workflow).toContain('x64_ffmpeg="${x64_app}/Contents/Resources/ffmpeg/ffmpeg"');
    expect(workflow).toContain('arm64_ffmpeg="${arm64_app}/Contents/Resources/ffmpeg/ffmpeg"');
    expect(verify).toContain('expectedArchitectures = ["x64", "arm64"]');
    expect(verify).toContain('expectedExtensions = ["dmg", "zip"]');
    expect(verify).toContain('digestFile(artifactPath, "sha512", "base64")');
  });

  it("replaces the Windows publish feed with the effective Mac feed", async () => {
    const { getConfig } = require("app-builder-lib/out/util/config/config") as {
      getConfig: (...args: unknown[]) => Promise<{ publish?: unknown }>;
    };
    const { Lazy } = require("lazy-val") as {
      Lazy: new (creator: () => Promise<unknown>) => unknown;
    };
    const { macReleaseBuildConfig } = require("../scripts/mac-release-config.cjs") as {
      macReleaseBuildConfig: () => { publish: { provider: string; owner: string; repo: string } };
    };
    const manifest = JSON.parse(readFileSync(resolve(projectDirectory, "package.json"), "utf8"));
    const effective = await getConfig(
      projectDirectory,
      null,
      macReleaseBuildConfig(),
      new Lazy(() => Promise.resolve(manifest))
    );

    expect(effective.publish).toEqual([{
      provider: "github",
      owner: "cdfpartridge-web",
      repo: "RiftLite-Desktop-Mac"
    }]);
  });

  it("verifies every Mac release boundary before artifacts can be uploaded", () => {
    const workflow = readFileSync(resolve(projectDirectory, ".github", "workflows", "build-mac.yml"), "utf8");
    const prepareIndex = workflow.indexOf("- name: Prepare architecture-specific FFmpeg binaries");
    const packageIndex = workflow.indexOf("- name: Package macOS installers");
    const artifactVerificationIndex = workflow.indexOf("- name: Verify macOS release artifacts");
    const appVerificationIndex = workflow.indexOf("- name: Verify packaged macOS applications");
    const smokeIndex = workflow.indexOf("- name: Smoke-test packaged macOS application");
    const uploadIndex = workflow.indexOf("- name: Upload macOS installers");

    expect(prepareIndex).toBeGreaterThan(-1);
    expect(packageIndex).toBeGreaterThan(prepareIndex);
    expect(artifactVerificationIndex).toBeGreaterThan(packageIndex);
    expect(appVerificationIndex).toBeGreaterThan(artifactVerificationIndex);
    expect(smokeIndex).toBeGreaterThan(appVerificationIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);
    expect(workflow).toContain("npm run release:verify:mac");
    expect(workflow).toContain("codesign --verify --deep --strict --verbose=2");
    expect(workflow).toContain('info.get("CFBundleIdentifier") != "com.riftlite.desktop.beta06"');
    expect(workflow).toContain('info.get("CFBundleShortVersionString") != expected_version');
    expect(workflow).toContain('info.get("CFBundleVersion") != expected_version');
    expect(workflow).toContain('if "riftlite" not in schemes:');
    expect(workflow).toContain('updater_value(updater, "repo") != "RiftLite-Desktop-Mac"');
    expect(workflow).toContain('hdiutil verify "release/RiftLiteBetaInstall-x64.dmg"');
    expect(workflow).toContain('hdiutil verify "release/RiftLiteBetaInstall-arm64.dmg"');
    expect(workflow).toContain("npm run release:smoke:packaged");
  });

  it("makes Windows verification and an isolated packaged launch part of the canonical build", () => {
    const manifest = JSON.parse(readFileSync(resolve(projectDirectory, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const smokeRunner = readFileSync(resolve(projectDirectory, "scripts", "run-electron-smoke.mjs"), "utf8");
    const windowsVerifier = readFileSync(resolve(projectDirectory, "scripts", "verify-release-artifacts.mjs"), "utf8");

    expect(manifest.scripts["electron:smoke"]).toContain("run-electron-smoke.mjs --development");
    expect(manifest.scripts["release:smoke:packaged"]).toContain("run-electron-smoke.mjs --packaged");
    expect(manifest.scripts["electron:build"]).toMatch(
      /electron-builder.+release:verify:win.+release:smoke:packaged/
    );
    expect(smokeRunner).toContain("RIFTLITE_SMOKE_ROOT_PATH: smokeRoot");
    expect(smokeRunner).toContain('join(smokeRoot, "UserData", "riftlite-startup.log")');
    expect(smokeRunner).toContain("rendererReady !== true");
    expect(windowsVerifier).toContain('join(unpackedDirectory, "resources", "app-update.yml")');
    expect(windowsVerifier).toContain("gunzipSync(readFileSync(blockmapPath))");
    expect(windowsVerifier).toContain('["blockmap", "--input", installerPath, "--output", regeneratedBlockmapPath]');
    expect(windowsVerifier).toContain('execFileSync(ffmpegPath, ["-version"]');
  });
});
