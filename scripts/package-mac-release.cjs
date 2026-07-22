const { Arch, Platform, build } = require("electron-builder");
const { macReleaseBuildConfig } = require("./mac-release-config.cjs");

if (process.platform !== "darwin") {
  throw new Error("The RiftLite macOS package command must run on macOS.");
}

build({
  targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.x64, Arch.arm64),
  publish: "never",
  config: macReleaseBuildConfig()
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
