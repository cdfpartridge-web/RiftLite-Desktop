import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeUtf8FileAtomically } from "../src/main/services/rawCaptureService.js";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

describe("raw capture file replacement", () => {
  it.each([true, false])("preserves the existing file during a Windows lock (retry succeeds: %s)", async succeeds => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-locked-capture-"));
    const path = join(directory, "capture.json");
    try {
      await writeFile(path, "original");
      const locked = Object.assign(new Error("file temporarily locked"), { code: "EPERM" });
      vi.mocked(rename).mockRejectedValueOnce(locked);
      vi.mocked(rename).mockImplementationOnce(async (source, target) => {
        expect(await readFile(path, "utf8")).toBe("original");
        if (!succeeds) throw locked;
        const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        await fs.rename(source, target);
      });
      const operation = writeUtf8FileAtomically(path, "replacement");
      if (succeeds) await operation;
      else await expect(operation).rejects.toThrow("temporarily locked");
      expect(await readFile(path, "utf8")).toBe(succeeds ? "replacement" : "original");
      expect(await readdir(directory)).toEqual(["capture.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
