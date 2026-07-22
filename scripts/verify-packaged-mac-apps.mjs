import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Packaged macOS application verification must run on macOS.");
}

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8"));
const productName = manifest.build?.productName;
const expectedVersion = manifest.version;
const expectedIdentity = {
  appId: "com.riftlite.desktop.beta06",
  protocol: "riftlite",
  provider: "github",
  owner: "cdfpartridge-web",
  repo: "RiftLite-Desktop-Mac"
};

assert(productName === "RiftLite Beta 0.9", "The macOS product name changed.");
for (const target of [
  { directory: "mac", architecture: "x86_64", artifactArchitecture: "x64" },
  { directory: "mac-arm64", architecture: "arm64", artifactArchitecture: "arm64" }
]) {
  const appPath = join(projectDirectory, "release", target.directory, `${productName}.app`);
  const executablePath = join(appPath, "Contents", "MacOS", productName);
  const resourcesPath = join(appPath, "Contents", "Resources");
  const ffmpegPath = join(resourcesPath, "ffmpeg", "ffmpeg");
  const ffmpegLicensePath = `${ffmpegPath}.LICENSE`;
  const infoPath = join(appPath, "Contents", "Info.plist");
  const updaterPath = join(resourcesPath, "app-update.yml");
  for (const path of [executablePath, ffmpegPath, ffmpegLicensePath, infoPath, updaterPath]) {
    assert(existsSync(path), `Required packaged macOS file is missing: ${path}`);
  }
  assert((statSync(executablePath).mode & 0o111) !== 0, `The app executable is not executable: ${executablePath}`);
  assert((statSync(ffmpegPath).mode & 0o111) !== 0, `FFmpeg is not executable: ${ffmpegPath}`);
  assert(command("lipo", ["-archs", executablePath]).split(/\s+/).includes(target.architecture), `The app executable is not ${target.architecture}.`);
  assert(command("lipo", ["-archs", ffmpegPath]).split(/\s+/).includes(target.architecture), `FFmpeg is not ${target.architecture}.`);

  const info = JSON.parse(command("plutil", ["-convert", "json", "-o", "-", infoPath]));
  assert(info.CFBundleIdentifier === expectedIdentity.appId, `Unexpected bundle identifier in ${infoPath}.`);
  assert(info.CFBundleShortVersionString === expectedVersion, `Unexpected short version in ${infoPath}.`);
  assert(info.CFBundleVersion === expectedVersion, `Unexpected bundle version in ${infoPath}.`);
  const schemes = (info.CFBundleURLTypes ?? []).flatMap((entry) => entry.CFBundleURLSchemes ?? []);
  assert(schemes.includes(expectedIdentity.protocol), `The ${expectedIdentity.protocol} protocol is missing from ${infoPath}.`);

  const updater = readFileSync(updaterPath, "utf8");
  for (const key of ["provider", "owner", "repo"]) {
    assert(
      yamlScalar(updater, key) === expectedIdentity[key],
      `Unexpected ${key} in ${updaterPath}.`
    );
  }
  command("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  command("hdiutil", ["verify", join(projectDirectory, "release", `RiftLiteBetaInstall-${target.artifactArchitecture}.dmg`)]);
}

console.log(`Packaged macOS identity, updater, signatures, DMGs, and architectures verified for v${expectedVersion}.`);

function command(executable, args) {
  return execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function yamlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?\\s*$`, "m"));
  assert(match, `Embedded app-update.yml is missing ${key}.`);
  return match[1].trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
