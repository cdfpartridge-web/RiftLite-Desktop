const { execFileSync, spawnSync } = require("node:child_process");
const { chmodSync, copyFileSync, existsSync, mkdirSync, unlinkSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

if (process.platform !== "darwin") {
  throw new Error("Architecture-specific FFmpeg preparation must run on macOS.");
}

const projectDirectory = resolve(__dirname, "..");
const packageDirectory = join(projectDirectory, "node_modules", "ffmpeg-static");
const packageBinary = join(packageDirectory, "ffmpeg");
const installScript = join(packageDirectory, "install.js");
const cacheRoot = join(projectDirectory, "node_modules", ".cache", "riftlite-ffmpeg");
const targets = [
  { npmArch: "x64", machoArch: "x86_64" },
  { npmArch: "arm64", machoArch: "arm64" },
];

for (const path of [packageDirectory, installScript]) {
  if (!existsSync(path)) {
    throw new Error(`Cannot prepare macOS FFmpeg because a required ffmpeg-static path is missing: ${path}`);
  }
}

for (const target of targets) {
  for (const suffix of ["", ".LICENSE", ".README"]) {
    const path = `${packageBinary}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }

  const environment = {
    ...process.env,
    npm_config_platform: "darwin",
    npm_config_arch: target.npmArch,
  };
  delete environment.FFMPEG_BIN;
  const installed = spawnSync(process.execPath, [installScript], {
    cwd: projectDirectory,
    env: environment,
    stdio: "inherit",
  });
  if (installed.status !== 0 || !existsSync(packageBinary)) {
    throw new Error(`ffmpeg-static failed to install the darwin-${target.npmArch} binary.`);
  }
  assertMachArchitecture(packageBinary, target.machoArch);

  const targetBinary = join(cacheRoot, `darwin-${target.npmArch}`, "ffmpeg");
  mkdirSync(dirname(targetBinary), { recursive: true });
  copyFileSync(packageBinary, targetBinary);
  chmodSync(targetBinary, 0o755);
  const binaryLicense = `${packageBinary}.LICENSE`;
  const licenseSource = existsSync(binaryLicense) ? binaryLicense : join(packageDirectory, "LICENSE");
  if (!existsSync(licenseSource)) {
    throw new Error(`ffmpeg-static did not provide a license for darwin-${target.npmArch}.`);
  }
  copyFileSync(licenseSource, `${targetBinary}.LICENSE`);
}

const hostTarget = targets.find((target) => target.npmArch === process.arch);
if (hostTarget) {
  const hostBinary = join(cacheRoot, `darwin-${hostTarget.npmArch}`, "ffmpeg");
  copyFileSync(hostBinary, packageBinary);
  chmodSync(packageBinary, 0o755);
  copyFileSync(`${hostBinary}.LICENSE`, `${packageBinary}.LICENSE`);
}

console.log("Prepared and verified darwin-x64 and darwin-arm64 FFmpeg binaries.");

function assertMachArchitecture(path, expectedArchitecture) {
  const architectures = execFileSync("lipo", ["-archs", path], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(
      `Unexpected architecture for ${path}: expected ${expectedArchitecture}, found ${architectures.join(", ") || "none"}.`
    );
  }
}
