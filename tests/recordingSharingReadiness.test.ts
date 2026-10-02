import { describe, expect, it } from "vitest";
import { discordDestinationReadiness, discordReportsChannelUrl, replayDiscordResultNeedsReview } from "../src/shared/recordingSharingReadiness.js";
import type { HubHealthStatus, MatchDraft, ReplayRecord } from "../src/shared/types.js";

function fixture(): HubHealthStatus {
  return {
    account: { uid: "account-a", email: "", handle: "player", displayName: "Player", profileComplete: true, identityUids: ["account-a", "old-account-a"] },
    hub: { id: "testing", name: "Testing", role: "member", capabilities: ["view"] },
    discord: { configured: true, verified: false, guilds: [{ guildId: "123456789012345678", reportsChannelId: "123456789012345679", reportsChannelConfigured: true, verifiedRoleId: "", verifiedRoleConfigured: false, feedChannelId: "", feedChannelConfigured: false, verifiedForAccount: false, discordUsername: "", updatedAt: 1 }] },
    replay: { latest: null, latestDiscordDelivery: null }
  };
}
function check(health?: HubHealthStatus, patch: Partial<Parameters<typeof discordDestinationReadiness>[0]> = {}) {
  return discordDestinationReadiness({ accountUid: "account-a", accountVerified: true, hubId: "testing", health, ...patch });
}

describe("recording and sharing destination readiness", () => {
  it("does not turn a saved preference or missing health response into a ready destination", () => {
    expect(check()).toMatchObject({ state: "unknown", canEnableAutomaticSharing: false });
    expect(check(fixture(), { error: "Membership check failed" })).toMatchObject({ state: "unknown", canEnableAutomaticSharing: false, detail: "Membership check failed" });
  });
  it("requires the current verified account and ignores another account or hub's response", () => {
    expect(check(fixture(), { accountVerified: false }).state).toBe("account");
    expect(check(fixture(), { accountUid: "account-b" })).toMatchObject({ state: "unknown", canEnableAutomaticSharing: false });
    expect(check(fixture(), { hubId: "another-hub" }).state).toBe("unknown");
    expect(check(fixture(), { accountUid: "old-account-a" }).state).toBe("configured");
  });
  it("requires a complete account profile", () => {
    const health = fixture();
    health.account.profileComplete = false;
    expect(check(health)).toMatchObject({ state: "profile", canEnableAutomaticSharing: false });
  });
  it("requires one unambiguous connected server", () => {
    const health = fixture();
    health.discord.configured = false;
    expect(check(health).state).toBe("server");
    health.discord.configured = true;
    health.discord.guilds.push({ ...health.discord.guilds[0], guildId: "123456789012345680" });
    expect(check(health)).toMatchObject({ state: "server", canEnableAutomaticSharing: false });
    health.discord.guilds = [];
    expect(check(health).state).toBe("server");
  });
  it("does not treat a server with no reports channel as ready for replay posts", () => {
    const health = fixture();
    health.discord.guilds[0].reportsChannelConfigured = false;
    expect(check(health)).toMatchObject({ state: "channel", canEnableAutomaticSharing: false });
    health.discord.guilds[0].reportsChannelConfigured = true;
    health.discord.guilds[0].reportsChannelId = "";
    expect(check(health).state).toBe("channel");
  });
  it("does not add Discord verification or an optional role as replay-posting prerequisites", () => {
    const health = fixture();
    expect(health.discord.verified).toBe(false);
    expect(health.discord.guilds[0].verifiedForAccount).toBe(false);
    expect(health.discord.guilds[0].verifiedRoleConfigured).toBe(false);
    expect(check(health)).toMatchObject({ state: "configured", canEnableAutomaticSharing: true });
  });
  it("links only an actual singular configured reports channel", () => {
    const health = fixture();
    expect(discordReportsChannelUrl(health)).toBe("https://discord.com/channels/123456789012345678/123456789012345679");
    health.discord.guilds[0].reportsChannelId = "https://elsewhere.example";
    expect(discordReportsChannelUrl(health)).toBeNull();
    health.discord.guilds = [fixture().discord.guilds[0], fixture().discord.guilds[0]];
    expect(discordReportsChannelUrl(health)).toBeNull();
    expect(discordReportsChannelUrl(null)).toBeNull();
  });
});

describe("manual Discord share result review", () => {
  const match = (status: MatchDraft["status"], result: MatchDraft["result"]) => ({ status, result } as MatchDraft);
  it("uses the saved current match instead of an old pending capture snapshot", () => {
    const replay = { matchSnapshot: match("pending-review", "Incomplete"), rawCapture: { discordResultReviewRequired: true } } as ReplayRecord;
    expect(replayDiscordResultNeedsReview(replay, match("saved", "Win"))).toBe(false);
    expect(replayDiscordResultNeedsReview(replay)).toBe(true);
  });
  it("does not use a saved snapshot to bypass a pending current match", () => {
    const replay = { matchSnapshot: match("saved", "Win") } as ReplayRecord;
    expect(replayDiscordResultNeedsReview(replay, match("pending-review", "Win"))).toBe(true);
    expect(replayDiscordResultNeedsReview(replay, match("saved", "Incomplete"))).toBe(true);
    expect(replayDiscordResultNeedsReview(replay, match("incomplete", "Loss"))).toBe(true);
  });
  it("requires review for recovered captures that have no saved match", () => {
    const replay = { rawCapture: { discordResultReviewRequired: true } } as ReplayRecord;
    expect(replayDiscordResultNeedsReview(replay)).toBe(true);
  });
  it("lets the service verify an otherwise unknown result and accepts reviewed draws", () => {
    expect(replayDiscordResultNeedsReview({} as ReplayRecord)).toBe(false);
    expect(replayDiscordResultNeedsReview({ matchSnapshot: match("saved", "Draw") } as ReplayRecord)).toBe(false);
  });
});
