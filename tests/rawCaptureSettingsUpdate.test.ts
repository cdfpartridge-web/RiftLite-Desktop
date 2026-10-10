import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import { rawCaptureSettingsForAccountUpdate } from "../src/shared/rawCaptureSettingsUpdate.js";
import { createDefaultSettings } from "../src/shared/settingsDefaults.js";

describe("account-pinned raw-capture settings updates", () => {
  it("merges a same-account partial update without dropping independent preferences", () => {
    const settings = { ...createDefaultSettings(), accountUid: "account-one" };
    settings.rawCapture.tcgaWebReplayAutoUploadEnabled = true;
    settings.rawCapture.tcgaWebReplayAutoUploadAccountUid = "account-one";
    const before = structuredClone(settings);
    const next = rawCaptureSettingsForAccountUpdate(settings, { visibility: "private" }, "account-one");
    expect(next).toEqual({ ...settings.rawCapture, visibility: "private" });
    expect(next.tcgaWebReplayAutoUploadEnabled).toBe(true);
    expect(settings).toEqual(before);
  });

  it("keeps omitted expected identity compatible with existing callers", () => {
    const settings = { ...createDefaultSettings(), accountUid: "account-two" };
    expect(rawCaptureSettingsForAccountUpdate(settings, { enabled: true })).toMatchObject({ enabled: true });
    expect(rawCaptureSettingsForAccountUpdate(settings, { enabled: true }, undefined)).toMatchObject({ enabled: true });
  });

  it("treats an explicitly empty account identity as a pin to the local profile", () => {
    const settings = createDefaultSettings();
    expect(rawCaptureSettingsForAccountUpdate(settings, { visibility: "private" }, "").visibility).toBe("private");
    settings.accountUid = "newly-linked";
    expect(() => rawCaptureSettingsForAccountUpdate(settings, { visibility: "public" }, "")).toThrow("account changed");
  });

  it.each(["different-account", "ACCOUNT-ONE", ""])("rejects an account switch to %j", (currentUid) => {
    const settings = { ...createDefaultSettings(), accountUid: currentUid };
    expect(() => rawCaptureSettingsForAccountUpdate(settings, { visibility: "public" }, "account-one")).toThrow("account changed");
  });

  it("rejects malformed expected identities rather than treating them as unpinned", () => {
    expect(() => rawCaptureSettingsForAccountUpdate(createDefaultSettings(), {}, null as unknown as string)).toThrow("identity is invalid");
  });

  it("checks account identity when the queued store mutation executes, preserving the new account's privacy", async () => {
    const boundary = resolve(tmpdir());
    const directory = await mkdtemp(join(boundary, "riftlite-replay-account-"));
    try {
      const store = new RiftLiteStore(join(directory, "riftlite-v06.sqlite"), join(directory, "legacy.json"));
      await store.load();
      await store.saveSettings({ accountUid: "account-one", rawCapture: { ...createDefaultSettings().rawCapture, visibility: "private" } });
      const accountSwitch = store.saveSettings({ accountUid: "account-two" });
      const staleVisibilitySave = store.updateSettings((current) => ({
        rawCapture: rawCaptureSettingsForAccountUpdate(current, { visibility: "public" }, "account-one")
      }));
      await expect(staleVisibilitySave).rejects.toThrow("account changed");
      await accountSwitch;
      const saved = await store.getSettings();
      expect(saved.accountUid).toBe("account-two");
      expect(saved.rawCapture.visibility).toBe("private");
      await expect(store.updateSettings((current) => ({
        rawCapture: rawCaptureSettingsForAccountUpdate(current, { visibility: "unlisted" }, "account-two")
      }))).resolves.toMatchObject({ accountUid: "account-two", rawCapture: { visibility: "unlisted" } });
    } finally {
      if (dirname(directory) !== boundary || !basename(directory).startsWith("riftlite-replay-account-")) {
        throw new Error("Unexpected replay account fixture directory.");
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
