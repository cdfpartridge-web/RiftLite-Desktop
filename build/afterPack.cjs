const { execFileSync } = require("node:child_process");
const { chmodSync, copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { Arch } = require("builder-util");

module.exports = async function afterPack(context) {
  copyFfmpegBinary(context);

  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = join(context.appOutDir, exeName);
  const localIconPath = resolve(context.packager.projectDir, "resources", "riftlite-app.ico");
  const legacyIconPath = resolve(context.packager.projectDir, "..", "resources", "riftlite-app.ico");
  const iconPath = existsSync(localIconPath) ? localIconPath : legacyIconPath;
  const rceditPath = resolve(context.packager.projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

  if (!existsSync(exePath)) {
    throw new Error(`Cannot stamp the Windows executable because it is missing: ${exePath}`);
  }
  if (!existsSync(iconPath)) {
    throw new Error(`Cannot stamp the Windows executable because its icon is missing: ${iconPath}`);
  }
  if (!existsSync(rceditPath)) {
    throw new Error(`Cannot stamp the Windows executable because rcedit is missing: ${rceditPath}`);
  }

  execFileSync(rceditPath, [
    exePath,
    "--set-icon", iconPath,
    "--set-version-string", "ProductName", context.packager.appInfo.productName,
    "--set-version-string", "FileDescription", context.packager.appInfo.productName,
    "--set-version-string", "CompanyName", "RiftLite",
    "--set-version-string", "InternalName", exeName,
    "--set-version-string", "OriginalFilename", exeName,
    "--set-file-version", context.packager.appInfo.version,
    "--set-product-version", context.packager.appInfo.version
  ], { stdio: "inherit" });
};

function copyFfmpegBinary(context) {
  const isWindows = context.electronPlatformName === "win32";
  const isMac = context.electronPlatformName === "darwin";
  const projectDirectory = context.packager.projectDir;
  const architecture = Arch[context.arch];
  let ffmpegPath = "";
  if (isMac) {
    if (architecture !== "x64" && architecture !== "arm64") {
      throw new Error(`Cannot package replay video support for unsupported macOS architecture: ${String(architecture)}`);
    }
    ffmpegPath = resolve(
      projectDirectory,
      "node_modules",
      ".cache",
      "riftlite-ffmpeg",
      `darwin-${architecture}`,
      "ffmpeg"
    );
  } else {
    try {
      ffmpegPath = require(resolve(projectDirectory, "node_modules", "ffmpeg-static"));
    } catch (error) {
      throw new Error("Cannot package replay video support because ffmpeg-static could not be loaded.", { cause: error });
    }
  }

  if (typeof ffmpegPath !== "string" || !ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error(`Cannot package replay video support because the FFmpeg binary is missing: ${String(ffmpegPath)}`);
  }
  if (isMac) {
    const expectedMachArchitecture = architecture === "x64" ? "x86_64" : "arm64";
    const machArchitectures = execFileSync("lipo", ["-archs", ffmpegPath], { encoding: "utf8" })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!machArchitectures.includes(expectedMachArchitecture)) {
      throw new Error(
        `Cannot package darwin-${architecture}: staged FFmpeg contains ${machArchitectures.join(", ") || "no"} architecture.`
      );
    }
  }

  const resourcesDirectory = isMac
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : join(context.appOutDir, "resources");
  const outputDirectory = join(resourcesDirectory, "ffmpeg");
  const outputPath = join(outputDirectory, isWindows ? "ffmpeg.exe" : "ffmpeg");
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(ffmpegPath, outputPath);
  if (!isWindows) {
    chmodSync(outputPath, 0o755);
  }

  const binaryLicense = `${ffmpegPath}.LICENSE`;
  const packageLicense = resolve(projectDirectory, "node_modules", "ffmpeg-static", "LICENSE");
  const licenseSource = existsSync(binaryLicense) ? binaryLicense : packageLicense;
  if (!existsSync(licenseSource)) {
    throw new Error(`Cannot package replay video support because the FFmpeg license is missing: ${licenseSource}`);
  }
  copyFileSync(licenseSource, join(outputDirectory, isWindows ? "ffmpeg.exe.LICENSE" : "ffmpeg.LICENSE"));
}
