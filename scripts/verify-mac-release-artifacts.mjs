import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = join(projectDirectory, "release");
const manifestPath = join(releaseDirectory, "latest-mac.yml");
const packageManifest = JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8"));
const expectedVersion = packageManifest.version;
const artifactTemplate = packageManifest.build?.mac?.artifactName;
const expectedArchitectures = ["x64", "arm64"];
const expectedExtensions = ["dmg", "zip"];

assert(typeof expectedVersion === "string" && expectedVersion.length > 0, "package.json has no version.");
assert(
  artifactTemplate === "RiftLiteBetaInstall-${arch}.${ext}",
  "The canonical macOS installer artifact name changed."
);
assert(existsSync(manifestPath), `Required macOS updater manifest is missing: ${manifestPath}`);

for (const target of expectedExtensions) {
  const targetConfiguration = packageManifest.build?.mac?.target?.find((entry) => entry?.target === target);
  assert(targetConfiguration, `package.json is missing the macOS ${target} target.`);
  for (const architecture of expectedArchitectures) {
    assert(
      targetConfiguration.arch?.includes(architecture),
      `package.json does not build the macOS ${target} target for ${architecture}.`
    );
  }
}

const expectedArtifactNames = expectedArchitectures.flatMap((architecture) => (
  expectedExtensions.map((extension) => (
    artifactTemplate.replace("${arch}", architecture).replace("${ext}", extension)
  ))
));
const manifestSource = readFileSync(manifestPath, "utf8");
const manifestVersion = yamlScalar(manifestSource, "version");
const manifestEntries = yamlFileEntries(manifestSource);
const entryNames = manifestEntries.map((entry) => entry.url);

assert(
  manifestVersion === expectedVersion,
  `latest-mac.yml version ${manifestVersion} does not match package.json version ${expectedVersion}.`
);
assert(
  manifestEntries.length === expectedArtifactNames.length,
  `latest-mac.yml must contain exactly ${expectedArtifactNames.length} file entries; found ${manifestEntries.length}.`
);
assert(new Set(entryNames).size === entryNames.length, "latest-mac.yml contains duplicate artifact URLs.");
assert(
  sameStringSet(entryNames, expectedArtifactNames),
  `latest-mac.yml artifact URLs do not match the expected set: ${expectedArtifactNames.join(", ")}.`
);

const verifiedArtifacts = [];
for (const expectedName of expectedArtifactNames) {
  assert(
    basename(expectedName) === expectedName && !expectedName.includes("\\"),
    `Unsafe macOS artifact name generated from package.json: ${expectedName}`
  );
  const entry = manifestEntries.find((candidate) => candidate.url === expectedName);
  assert(entry, `latest-mac.yml is missing the ${expectedName} files entry.`);
  assert(/^\d+$/.test(entry.size), `latest-mac.yml has an invalid size for ${expectedName}.`);
  assert(
    /^[A-Za-z0-9+/]{86}==$/.test(entry.sha512),
    `latest-mac.yml has an invalid SHA-512 for ${expectedName}.`
  );

  const artifactPath = join(releaseDirectory, expectedName);
  assert(existsSync(artifactPath), `Required macOS release artifact is missing: ${artifactPath}`);
  const artifactStats = statSync(artifactPath);
  assert(artifactStats.isFile(), `Required macOS release artifact is not a file: ${artifactPath}`);
  const artifactBytes = artifactStats.size;
  const declaredBytes = Number(entry.size);
  assert(
    Number.isSafeInteger(declaredBytes) && declaredBytes > 0,
    `latest-mac.yml size is not a positive safe integer for ${expectedName}.`
  );
  assert(
    artifactBytes === declaredBytes,
    `latest-mac.yml size ${declaredBytes} does not match ${expectedName} size ${artifactBytes}.`
  );
  const actualSha512 = await digestFile(artifactPath, "sha512", "base64");
  assert(entry.sha512 === actualSha512, `latest-mac.yml SHA-512 does not match ${expectedName}.`);

  verifiedArtifacts.push({
    name: expectedName,
    bytes: artifactBytes,
    sha512: actualSha512,
  });
}

const primaryArtifactName = yamlScalar(manifestSource, "path");
const primarySha512 = yamlScalar(manifestSource, "sha512");
const primaryEntry = manifestEntries.find((entry) => entry.url === primaryArtifactName);
assert(primaryEntry, `latest-mac.yml path refers to an unknown artifact: ${primaryArtifactName}.`);
assert(
  primarySha512 === primaryEntry.sha512,
  "latest-mac.yml top-level SHA-512 does not match its primary artifact entry."
);

console.log(JSON.stringify({
  version: expectedVersion,
  manifest: manifestPath,
  primaryArtifact: primaryArtifactName,
  artifacts: verifiedArtifacts,
}, null, 2));

function yamlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?\\s*$`, "m"));
  assert(match, `latest-mac.yml is missing ${key}.`);
  return match[1].trim();
}

function yamlFileEntries(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let inFiles = false;
  let current = null;

  for (const line of lines) {
    if (!inFiles) {
      if (/^files:\s*$/.test(line)) inFiles = true;
      continue;
    }
    if (/^[^\s#]/.test(line)) break;

    const urlMatch = line.match(/^\s+-\s+url:\s*['"]?([^'"\r\n]+)['"]?\s*$/);
    if (urlMatch) {
      if (current) entries.push(current);
      current = { url: urlMatch[1].trim(), sha512: "", size: "" };
      continue;
    }
    if (!current) continue;
    const valueMatch = line.match(/^\s+(sha512|size):\s*['"]?([^'"\r\n]+)['"]?\s*$/);
    if (valueMatch) current[valueMatch[1]] = valueMatch[2].trim();
  }
  if (current) entries.push(current);

  for (const entry of entries) {
    assert(entry.url, "latest-mac.yml contains a file entry without a URL.");
    assert(entry.sha512, `latest-mac.yml file entry ${entry.url} has no SHA-512.`);
    assert(entry.size, `latest-mac.yml file entry ${entry.url} has no size.`);
  }
  return entries;
}

function sameStringSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((value) => actualSet.has(value));
}

function digestFile(path, algorithm, encoding) {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash(algorithm);
    const input = createReadStream(path);
    input.on("error", rejectDigest);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveDigest(hash.digest(encoding)));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
