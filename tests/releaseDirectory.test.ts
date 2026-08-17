import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE,
  resolveReleaseDirectory
} from "../scripts/release-directory.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const projectDirectory = mkdtempSync(join(tmpdir(), "riftlite-release-directory-"));
  temporaryDirectories.push(projectDirectory);
  const releaseDirectory = join(projectDirectory, "release");
  const outputBoundary = join(projectDirectory, "output");
  const alternateDirectory = join(outputBoundary, "local-nsis-candidate");
  const outsideDirectory = join(projectDirectory, "outside");
  for (const directory of [releaseDirectory, alternateDirectory, outsideDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  return { projectDirectory, releaseDirectory, outputBoundary, alternateDirectory, outsideDirectory };
}

describe("release directory resolution", () => {
  it("uses the canonical release directory when no override is configured", () => {
    const paths = fixture();

    expect(resolveReleaseDirectory(paths.projectDirectory, {})).toBe(realpathSync(paths.releaseDirectory));
    expect(resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: "  "
    })).toBe(realpathSync(paths.releaseDirectory));
  });

  it("accepts relative and absolute existing descendants of the output boundary", () => {
    const paths = fixture();

    expect(resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: "output/local-nsis-candidate"
    })).toBe(realpathSync(paths.alternateDirectory));
    expect(resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: paths.alternateDirectory
    })).toBe(realpathSync(paths.alternateDirectory));
  });

  it("rejects missing, broad, and out-of-bound alternate directories", () => {
    const paths = fixture();

    expect(() => resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: "output/missing"
    })).toThrow("does not exist");
    expect(() => resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: paths.outputBoundary
    })).toThrow("must resolve to an existing directory below");
    expect(() => resolveReleaseDirectory(paths.projectDirectory, {
      [RELEASE_DIRECTORY_ENVIRONMENT_VARIABLE]: paths.outsideDirectory
    })).toThrow("must resolve to an existing directory below");
  });
});
