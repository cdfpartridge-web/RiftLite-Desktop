const { execFileSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

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

  if (!existsSync(exePath) || !existsSync(iconPath) || !existsSync(rceditPath)) {
    return;
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
  let ffmpegPath = "";
  try {
    ffmpegPath = require(resolve(context.packager.projectDir, "node_modules", "ffmpeg-static"));
  } catch {
    ffmpegPath = "";
  }

  if (typeof ffmpegPath !== "string" || !ffmpegPath || !existsSync(ffmpegPath)) {
    return;
  }

  const isWindows = context.electronPlatformName === "win32";
  const outputDirectory = join(context.appOutDir, "resources", "ffmpeg");
  const outputPath = join(outputDirectory, isWindows ? "ffmpeg.exe" : "ffmpeg");
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(ffmpegPath, outputPath);

  const binaryLicense = `${ffmpegPath}.LICENSE`;
  const packageLicense = resolve(context.packager.projectDir, "node_modules", "ffmpeg-static", "LICENSE");
  const licenseSource = existsSync(binaryLicense) ? binaryLicense : packageLicense;
  if (existsSync(licenseSource)) {
    copyFileSync(licenseSource, join(outputDirectory, isWindows ? "ffmpeg.exe.LICENSE" : "ffmpeg.LICENSE"));
  }
}
