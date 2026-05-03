const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

module.exports = async function afterPack(context) {
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

  execFileSync(rceditPath, [exePath, "--set-icon", iconPath], { stdio: "inherit" });
};
