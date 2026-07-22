import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runAccountCloudRestore } from "../src/main/services/accountCloudRestoreCoordinator.js";

describe("account cloud restore runtime coordination", () => {
  it("holds capture, commits restore, invalidates caches, refreshes runtime, and releases in order", async () => {
    const calls: string[] = [];
    const result = await runAccountCloudRestore(async () => {
      calls.push("restore");
      return "restored";
    }, {
      prepareForRestore: async () => { calls.push("prepare"); },
      invalidateDeckLibrary: () => { calls.push("invalidate"); },
      refreshAfterRestore: async () => { calls.push("refresh"); },
      finishRestore: async () => { calls.push("finish"); }
    });

    expect(result).toBe("restored");
    expect(calls).toEqual(["prepare", "restore", "invalidate", "refresh", "finish"]);
  });

  it("always releases maintenance and leaves caches untouched when restore fails", async () => {
    const invalidateDeckLibrary = vi.fn();
    const finishRestore = vi.fn();
    await expect(runAccountCloudRestore(async () => {
      throw new Error("restore failed");
    }, {
      prepareForRestore: vi.fn(),
      invalidateDeckLibrary,
      refreshAfterRestore: vi.fn(),
      finishRestore
    })).rejects.toThrow("restore failed");

    expect(invalidateDeckLibrary).not.toHaveBeenCalled();
    expect(finishRestore).toHaveBeenCalledOnce();
  });

  it("takes and writes a manual-restore safety snapshot inside the maintained restore callback", () => {
    const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const restoreFunction = source.match(
      /async function restoreRiftLiteBackup[\s\S]*?(?=\nasync function exportMatchHistoryCsv)/
    )?.[0] ?? "";

    expect(restoreFunction).toMatch(
      /await runRiftLiteDataRestore\(async \(\) => \{[\s\S]*?store\.exportBackupData\([\s\S]*?writeBackupFile\([\s\S]*?store\.restoreBackupData\(backup\)[\s\S]*?\}\);/
    );
  });
});
