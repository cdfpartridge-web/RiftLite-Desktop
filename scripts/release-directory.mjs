import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE = "RIFTLITE_RELEASE_DIRECTORY";

export function resolveReleaseDirectory(projectDirectory, environment = process.env) {
  const projectRoot = realpathSync(projectDirectory);
  const configuredPath = environment[RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]?.trim();
  if (!configuredPath) {
    return join(projectRoot, "release");
  }

  const outputBoundaryPath = join(projectRoot, "output");
  assertDirectory(outputBoundaryPath, "The alternate release output boundary does not exist");

  const candidatePath = resolve(projectRoot, configuredPath);
  assertDirectory(candidatePath, "The alternate release directory does not exist");

  const outputBoundary = realpathSync(outputBoundaryPath);
  const candidate = realpathSync(candidatePath);
  const relativeCandidate = relative(outputBoundary, candidate);
  if (
    relativeCandidate === "" ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${sep}`) ||
    isAbsolute(relativeCandidate)
  ) {
    throw new Error(
      `${RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE} must resolve to an existing directory below ${outputBoundary}: ${candidate}`
    );
  }

  return candidate;
}

function assertDirectory(path, message) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${message}: ${path}`);
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const projectDirectory = resolve(dirname(modulePath), "..");
  console.log(resolveReleaseDirectory(projectDirectory));
}
