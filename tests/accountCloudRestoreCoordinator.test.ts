import { describe, expect, it, vi } from "vitest";

import { runAccountCloudRestore } from "../src/main/services/accountCloudRestoreCoordinator";

describe("account cloud restore coordinator", () => {
  it("invalidates the deck tracker only after a restore succeeds", async () => {
    const invalidateDeckLibrary = vi.fn();

    await expect(runAccountCloudRestore(
      async () => ({ restored: true }),
      { invalidateDeckLibrary }
    )).resolves.toEqual({ restored: true });

    expect(invalidateDeckLibrary).toHaveBeenCalledOnce();
  });

  it("leaves the live deck tracker untouched when restore fails", async () => {
    const invalidateDeckLibrary = vi.fn();

    await expect(runAccountCloudRestore(
      async () => {
        throw new Error("restore failed");
      },
      { invalidateDeckLibrary }
    )).rejects.toThrow("restore failed");

    expect(invalidateDeckLibrary).not.toHaveBeenCalled();
  });
});
