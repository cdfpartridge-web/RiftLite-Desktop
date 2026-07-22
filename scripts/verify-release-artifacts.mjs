import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { extractFile, listPackage } from "@electron/asar";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = join(projectDirectory, "release");
const installerPath = join(releaseDirectory, "RiftLiteBetaInstall.exe");
const blockmapPath = `${installerPath}.blockmap`;
const manifestPath = join(releaseDirectory, "latest.yml");
const unpackedDirectory = join(releaseDirectory, "win-unpacked");
const asarPath = join(unpackedDirectory, "resources", "app.asar");
const packagedUpdaterPath = join(unpackedDirectory, "resources", "app-update.yml");
const ffmpegPath = join(unpackedDirectory, "resources", "ffmpeg", "ffmpeg.exe");
const ffmpegLicensePath = `${ffmpegPath}.LICENSE`;
const appBuilderPath = join(projectDirectory, "node_modules", "app-builder-bin", "win", "x64", "app-builder.exe");

const packageManifest = JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8"));
const expectedVersion = packageManifest.version;
const expectedArtifactName = packageManifest.build?.artifactName?.replace("${ext}", "exe");
const expectedIdentity = {
  appId: "com.riftlite.desktop.beta06",
  productName: "RiftLite Beta 0.9",
  executableName: "RiftLite Beta 0.9",
  userDataDirectory: "RiftLite Beta 0.6",
  mediaDirectoryName: "RiftLite",
  protocol: "riftlite",
  updateOwner: "cdfpartridge-web",
  updateRepository: "RiftLite-Desktop",
};

for (const path of [installerPath, blockmapPath, manifestPath, asarPath, packagedUpdaterPath, ffmpegPath, ffmpegLicensePath, appBuilderPath]) {
  assert(existsSync(path), `Required release artifact is missing: ${path}`);
}
assert(expectedArtifactName === "RiftLiteBetaInstall.exe", "The canonical Windows installer name changed.");
assert(packageManifest.build?.appId === expectedIdentity.appId, "The continuity app ID changed.");
assert(packageManifest.build?.productName === expectedIdentity.productName, "The installed product name changed.");
assert(packageManifest.build?.executableName === expectedIdentity.executableName, "The executable name changed.");
assert(
  packageManifest.build?.protocols?.some((entry) => entry?.schemes?.includes(expectedIdentity.protocol)),
  "The riftlite:// protocol registration is missing."
);
assert(
  packageManifest.build?.publish?.some((entry) => (
    entry?.provider === "github" &&
    entry?.owner === expectedIdentity.updateOwner &&
    entry?.repo === expectedIdentity.updateRepository
  )),
  "The Windows updater feed changed."
);

const updaterManifest = readFileSync(manifestPath, "utf8");
const manifestVersion = yamlScalar(updaterManifest, "version");
const manifestPathValue = yamlScalar(updaterManifest, "path");
const manifestSha512 = yamlScalar(updaterManifest, "sha512");
const manifestFile = yamlFileEntry(updaterManifest, expectedArtifactName);
const manifestSize = Number(manifestFile.size);
const installer = readFileSync(installerPath);

assert(manifestVersion === expectedVersion, `latest.yml version ${manifestVersion} does not match ${expectedVersion}.`);
assert(manifestPathValue === expectedArtifactName, `latest.yml path ${manifestPathValue} is not ${expectedArtifactName}.`);
assert(manifestFile.url === expectedArtifactName, `latest.yml files entry ${manifestFile.url} is not ${expectedArtifactName}.`);
assert(manifestFile.sha512 === manifestSha512, "latest.yml file and top-level SHA-512 values differ.");
assert(manifestSize === installer.length, `latest.yml size ${manifestSize} does not match installer size ${installer.length}.`);
assert(
  manifestSha512 === createHash("sha512").update(installer).digest("base64"),
  "latest.yml SHA-512 does not match the installer."
);

const packagedManifest = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
const packagedBuildIdentity = extractFile(asarPath, join("dist", "shared", "buildIdentity.js")).toString("utf8");
assert(packagedManifest.version === expectedVersion, `Packaged app version ${packagedManifest.version} does not match ${expectedVersion}.`);
assert(
  packagedBuildIdentity.includes(`packageVersion: \"${expectedVersion}\"`) &&
    packagedBuildIdentity.includes(`displayVersion: \"${expectedVersion}\"`),
  "Packaged build identity does not contain the expected package/display version."
);
for (const [field, value] of Object.entries({
  appName: expectedIdentity.productName,
  appId: expectedIdentity.appId,
  userDataDirectory: expectedIdentity.userDataDirectory,
  mediaDirectoryName: expectedIdentity.mediaDirectoryName,
  protocol: expectedIdentity.protocol,
})) {
  assert(
    packagedBuildIdentity.includes(`${field}: \"${value}\"`),
    `Packaged build identity has an unexpected ${field}.`
  );
}
assert(packagedBuildIdentity.includes("updatesEnabled: true"), "Packaged updates are unexpectedly disabled.");

const ffmpegVersion = execFileSync(ffmpegPath, ["-version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
assert(/^ffmpeg version\s+/m.test(ffmpegVersion), "Packaged FFmpeg did not return a valid version banner.");

const packagedUpdater = readFileSync(packagedUpdaterPath, "utf8");
assert(yamlScalar(packagedUpdater, "provider") === "github", "The packaged updater provider is not GitHub.");
assert(yamlScalar(packagedUpdater, "owner") === expectedIdentity.updateOwner, "The packaged updater owner changed.");
assert(yamlScalar(packagedUpdater, "repo") === expectedIdentity.updateRepository, "The packaged updater repository changed.");

let blockmap;
try {
  blockmap = JSON.parse(gunzipSync(readFileSync(blockmapPath)).toString("utf8"));
} catch (error) {
  throw new Error(`The installer blockmap is not valid gzip JSON: ${error instanceof Error ? error.message : String(error)}`);
}
assert(blockmap?.version === "2", `Unexpected installer blockmap version: ${String(blockmap?.version)}.`);
assert(Array.isArray(blockmap?.files) && blockmap.files.length === 1, "The NSIS installer blockmap must contain exactly one file.");
for (const entry of blockmap.files) {
  assert(entry?.name === "file", `The NSIS installer blockmap has an unexpected file name: ${String(entry?.name)}.`);
  assert(entry?.offset === 0, `The NSIS installer blockmap has an unexpected offset: ${String(entry?.offset)}.`);
  assert(Array.isArray(entry?.checksums) && entry.checksums.length > 0, `The installer blockmap file ${entry?.name} has no checksums.`);
  assert(Array.isArray(entry?.sizes) && entry.sizes.length === entry.checksums.length, `The installer blockmap file ${entry?.name} has inconsistent blocks.`);
  assert(entry.sizes.every((size) => Number.isInteger(size) && size > 0), "The installer blockmap contains an invalid block size.");
  assert(
    entry.sizes.reduce((total, size) => total + size, 0) === installer.length,
    "The installer blockmap does not describe the packaged installer bytes."
  );
}
const blockmapAuditDirectory = mkdtempSync(join(tmpdir(), "riftlite-blockmap-verify-"));
try {
  const regeneratedBlockmapPath = join(blockmapAuditDirectory, "installer.blockmap");
  execFileSync(appBuilderPath, ["blockmap", "--input", installerPath, "--output", regeneratedBlockmapPath], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const regeneratedBlockmap = JSON.parse(gunzipSync(readFileSync(regeneratedBlockmapPath)).toString("utf8"));
  assert(
    JSON.stringify(regeneratedBlockmap) === JSON.stringify(blockmap),
    "The shipped installer blockmap does not match a canonical blockmap regenerated from the installer."
  );
} finally {
  rmSync(blockmapAuditDirectory, { recursive: true, force: true });
}

const packagedPaths = listPackage(asarPath).map((path) => path.replaceAll("\\", "/").toLowerCase());
for (const buildOnlyPath of [
  "/node_modules/vite/",
  "/node_modules/esbuild/",
  "/node_modules/@vitejs/plugin-react/",
  "/node_modules/@types/qrcode/",
  "/node_modules/@types/sql.js/",
]) {
  assert(
    !packagedPaths.some((path) => path.startsWith(buildOnlyPath)),
    `Build-only dependency was shipped in app.asar: ${buildOnlyPath}`
  );
}

const report = {
  version: expectedVersion,
  installer: {
    path: installerPath,
    bytes: installer.length,
    sha256: digestFile(installerPath, "sha256"),
  },
  blockmap: {
    path: blockmapPath,
    bytes: statSync(blockmapPath).size,
    sha256: digestFile(blockmapPath, "sha256"),
  },
  updaterManifest: {
    path: manifestPath,
    bytes: statSync(manifestPath).size,
    sha256: digestFile(manifestPath, "sha256"),
  },
  ffmpegBytes: statSync(ffmpegPath).size,
};

console.log(JSON.stringify(report, null, 2));

function yamlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?\\s*$`, "m"));
  assert(match, `latest.yml is missing ${key}.`);
  return match[1].trim();
}

function yamlFileEntry(source, expectedUrl) {
  const lines = source.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const urlMatch = line.match(/^\s{2}-\s+url:\s*['"]?([^'"\r\n]+)['"]?\s*$/);
    if (urlMatch) {
      if (current?.url === expectedUrl) return current;
      current = { url: urlMatch[1].trim(), sha512: "", size: "" };
      continue;
    }
    if (!current) continue;
    const valueMatch = line.match(/^\s{4}(sha512|size):\s*['"]?([^'"\r\n]+)['"]?\s*$/);
    if (valueMatch) {
      current[valueMatch[1]] = valueMatch[2].trim();
    }
  }
  if (current?.url === expectedUrl) return current;
  throw new Error(`latest.yml is missing the ${expectedUrl} files entry.`);
}

function digestFile(path, algorithm) {
  return createHash(algorithm).update(readFileSync(path)).digest("hex").toUpperCase();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
