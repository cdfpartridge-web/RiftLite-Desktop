import type { RawCaptureSettings, UserSettings } from "./types.js";

/** Call inside the serialized settings mutation so account changes cannot race the check. */
export function rawCaptureSettingsForAccountUpdate(
  current: Pick<UserSettings, "accountUid" | "rawCapture">,
  patch: Partial<RawCaptureSettings>,
  expectedAccountUid?: string
): RawCaptureSettings {
  if (expectedAccountUid !== undefined) {
    if (typeof expectedAccountUid !== "string") {
      throw new Error("Web Replay settings account identity is invalid.");
    }
    if (current.accountUid !== expectedAccountUid) {
      throw new Error("Your RiftLite account changed. Review your replay settings and try again.");
    }
  }
  return { ...current.rawCapture, ...patch };
}
