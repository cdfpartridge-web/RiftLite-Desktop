import { describe, expect, it } from "vitest";

import {
  getRiftLiteAccountState,
  hasCompleteAccountProfile,
  hasVerifiedRiftLiteAccount,
  isGenericAccountDisplayName,
  linkedAccountAuthUidMatches,
  verifiedAccountConnectionUid,
  resolveCompletedAccountLinkUid
} from "../src/shared/accountIdentity.js";

describe("account identity", () => {
  it("recognizes every generated Player placeholder variant", () => {
    expect(isGenericAccountDisplayName("Player#abc123")).toBe(true);
    expect(isGenericAccountDisplayName("Player abc123")).toBe(true);
    expect(isGenericAccountDisplayName("player_abc123")).toBe(true);
    expect(isGenericAccountDisplayName("BMU")).toBe(false);
  });

  it("does not present an anonymous refresh token as a linked account", () => {
    expect(getRiftLiteAccountState({
      accountUid: "",
      firebaseRefreshToken: "anonymous-refresh-token",
      accountHandle: "",
      accountDisplayName: ""
    })).toBe("local");
  });

  it("separates incomplete, ready, and reconnect states", () => {
    expect(getRiftLiteAccountState({
      accountUid: "uid-1",
      firebaseRefreshToken: "token",
      accountHandle: "",
      accountDisplayName: "Player#uid1"
    })).toBe("needs-profile");
    expect(hasCompleteAccountProfile({ accountHandle: "bmu", accountDisplayName: "BMU" })).toBe(true);
    expect(getRiftLiteAccountState({
      accountUid: "uid-1",
      firebaseRefreshToken: "token",
      accountHandle: "bmu",
      accountDisplayName: "BMU"
    })).toBe("ready");
    expect(getRiftLiteAccountState({
      accountUid: "uid-1",
      firebaseRefreshToken: "",
      accountHandle: "bmu",
      accountDisplayName: "BMU"
    })).toBe("reconnect");
  });

  it("accepts the exchanged Firebase identity when an older link status omits its redundant uid", () => {
    expect(resolveCompletedAccountLinkUid("account-1", "account-1")).toBe("account-1");
    expect(resolveCompletedAccountLinkUid("", "account-1")).toBe("account-1");
    expect(resolveCompletedAccountLinkUid("account-1", "account-2")).toBe("");
    expect(resolveCompletedAccountLinkUid("account-1", "")).toBe("");
  });

  it("requires a completed connection check before account-bound uploads", () => {
    const verified = {
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token",
      accountLastVerifiedAt: "2026-07-21T14:00:00.000Z",
      accountLastVerificationError: ""
    };
    expect(hasVerifiedRiftLiteAccount(verified)).toBe(true);
    expect(hasVerifiedRiftLiteAccount({ ...verified, accountLastVerifiedAt: "" })).toBe(false);
    expect(hasVerifiedRiftLiteAccount({ ...verified, accountLastVerificationError: "Account needs attention." })).toBe(false);
    expect(hasVerifiedRiftLiteAccount({ ...verified, firebaseRefreshToken: "" })).toBe(false);
  });

  it("accepts a server-verified Firebase alias without accepting unrelated accounts", () => {
    const settings = { accountUid: "canonical-1", firebaseUid: "desktop-alias-1" };
    expect(linkedAccountAuthUidMatches(settings, "desktop-alias-1")).toBe(true);
    expect(linkedAccountAuthUidMatches(settings, "canonical-1")).toBe(true);
    expect(linkedAccountAuthUidMatches(settings, "unrelated-2")).toBe(false);
    expect(verifiedAccountConnectionUid(
      "canonical-1",
      "canonical-1",
      "desktop-alias-1",
      ["canonical-1", "desktop-alias-1"]
    )).toBe("canonical-1");
    expect(verifiedAccountConnectionUid(
      "unrelated-2",
      "canonical-1",
      "desktop-alias-1",
      ["canonical-1", "desktop-alias-1"]
    )).toBe("");
  });
});
