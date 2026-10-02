import { describe, expect, it } from "vitest";
import { cloudReplayForGameSegment, gameDetailsDisplayMatch, resolveGameDetails } from "../src/shared/gameDetails.js";
import type { AccountReplayLibraryItem, AccountReplayLibraryResult } from "../src/shared/accountReplayLibrary.js";
import type { MatchDraft, ReplayRecord } from "../src/shared/types.js";

const match: MatchDraft = {
  id: "match-one", platform: "atlas", status: "saved", capturedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
  result: "Win", format: "Bo1", score: "8-6", myName: "Player", opponentName: "Opponent", myChampion: "Ahri", opponentChampion: "Irelia",
  myBattlefield: "", opponentBattlefield: "", deckName: "Saved deck", deckSourceId: "", flags: "", notes: "Review turn two", games: [], rawEvidence: [], sync: { community: "disabled", hubs: {}, teams: {} }
};
const replay: ReplayRecord = { id: "replay-one", matchId: match.id, platform: "atlas", capturedAt: match.capturedAt, title: "Ahri vs Irelia", players: { me: "Player", opponent: "Opponent" }, events: [], rawCapture: { provider: "riftlite-v2", captureSessionId: "capture-one", uploadId: "online-one", uploadStatus: "uploaded", processingStatus: "ready", messageCount: 5 } };
const cloud: AccountReplayLibraryItem = { replayId: "online-one", captureId: "capture-one", title: replay.title, platform: "atlas", visibility: "private", status: "ready", url: "https://www.riftlite.com/replays/online-one", capturedAt: match.capturedAt, createdAt: match.capturedAt, updatedAt: match.capturedAt };
function owner(items = [cloud], accountUid = "account-one"): AccountReplayLibraryResult { return { accountUid, available: true, items, limit: 100, mayHaveMore: false }; }

describe("shared game detail identity", () => {
  it("resolves the same exact game from match, recording and owned-cloud entry points", () => {
    for (const target of [{ kind: "match", id: match.id }, { kind: "replay", id: replay.id }, { kind: "cloud", id: cloud.replayId, accountUid: "account-one" }] as const) {
      const result = resolveGameDetails(target, [match], [replay], "account-one", owner());
      expect(result.match).toBe(match);
      expect(result.replays).toEqual([replay]);
      expect(result.cloudReplays).toEqual([cloud]);
    }
  });
  it("keeps a match-only game and its notes without inventing a recording", () => {
    const result = resolveGameDetails({ kind: "match", id: match.id }, [match], [], "", null);
    expect(result.match?.notes).toBe("Review turn two");
    expect(result.replays).toEqual([]);
    expect(result.cloudReplays).toEqual([]);
  });
  it("keeps imported replay snapshots display-only and verifies their match ID", () => {
    const result = resolveGameDetails({ kind: "replay", id: replay.id }, [], [{ ...replay, matchSnapshot: match }], "");
    expect(result.match).toBeUndefined();
    expect(gameDetailsDisplayMatch(result)).toBe(match);
    result.replays[0] = { ...replay, matchSnapshot: { ...match, id: "unrelated" } };
    expect(gameDetailsDisplayMatch(result)).toBeUndefined();
  });
  it("never substitutes a lookalike game or the first replay for a missing ID", () => {
    const other = { ...match, id: "lookalike" };
    const result = resolveGameDetails({ kind: "match", id: "missing" }, [other], [replay], "account-one", owner());
    expect(result.unavailableReason).toContain("no longer saved");
    expect(result.match).toBeUndefined();
    expect(result.replays).toEqual([]);
    expect(resolveGameDetails({ kind: "replay", id: "missing" }, [match], [replay], "account-one", owner()).replays).toEqual([]);
  });
  it("does not cross-link cloud lookalikes using names, titles or date", () => {
    const similarCloud = { ...cloud, replayId: "different", captureId: "different" };
    const result = resolveGameDetails({ kind: "cloud", id: "different", accountUid: "account-one" }, [match], [replay], "account-one", owner([similarCloud]));
    expect(result.match).toBeUndefined();
    expect(result.replays).toEqual([]);
    expect(result.cloudReplays).toEqual([similarCloud]);
  });
  it("rejects a stale cloud selection after switching accounts even if the new listing contains its ID", () => {
    const result = resolveGameDetails({ kind: "cloud", id: cloud.replayId, accountUid: "account-one" }, [match], [replay], "account-two", owner([cloud], "account-two"));
    expect(result.unavailableReason).toContain("account that owns");
    expect(result.cloudReplays).toEqual([]);
  });
  it("does not use an owner response for a different account or an unavailable response", () => {
    for (const response of [owner([cloud], "account-two"), { ...owner(), available: false }]) {
      expect(resolveGameDetails({ kind: "match", id: match.id }, [match], [replay], "account-one", response).cloudReplays).toEqual([]);
    }
  });
  it("does not turn an ambiguous cloud association into editable local match details", () => {
    const duplicate = { ...replay, id: "second-capture", matchId: "second-match" };
    const result = resolveGameDetails({ kind: "cloud", id: cloud.replayId, accountUid: "account-one" }, [match, { ...match, id: "second-match" }], [replay, duplicate], "account-one", owner());
    expect(result.replays).toEqual([]);
    expect(result.match).toBeUndefined();
  });
  it("opens all exact BO3 child recordings and never a neighbouring game", () => {
    const combined = { ...match, id: "combined", combinedFromMatchIds: ["game-one", "game-two", "game-three"] };
    const recordings = ["game-three", "neighbour", "game-one", "game-two"].map((matchId) => ({ ...replay, id: `replay-${matchId}`, matchId, rawCapture: undefined }));
    const result = resolveGameDetails({ kind: "match", id: combined.id }, [combined], recordings, "");
    expect(result.match).toBe(combined);
    expect(result.replays.map((item) => item.matchId)).toEqual(combined.combinedFromMatchIds);
  });
  it("excludes deleted games and recordings instead of reopening them through the dialog", () => {
    const deletedAt = "2026-10-01T11:00:00Z";
    expect(resolveGameDetails({ kind: "match", id: match.id }, [{ ...match, deletedAt }], [replay], "").unavailableReason).toBeTruthy();
    expect(resolveGameDetails({ kind: "replay", id: replay.id }, [match], [{ ...replay, deletedAt }], "").unavailableReason).toBeTruthy();
  });
  it("binds each BO3 segment to its own cloud replay rather than the first cloud item", () => {
    const other = { ...cloud, replayId: "online-two", captureId: "capture-two" };
    const details = { title: "Series", replays: [replay], cloudReplays: [other, cloud] };
    expect(cloudReplayForGameSegment(details, replay)).toBe(cloud);
    expect(cloudReplayForGameSegment(details, { ...replay, rawCapture: { ...replay.rawCapture!, uploadId: "missing" } })).toBeUndefined();
    expect(cloudReplayForGameSegment(details)).toBeUndefined();
  });
  it("allows unique capture-ID linkage only in the absence of a conflicting upload ID", () => {
    const details = { title: replay.title, replays: [replay], cloudReplays: [cloud] };
    expect(cloudReplayForGameSegment(details, { ...replay, rawCapture: { ...replay.rawCapture!, uploadId: undefined } })).toBe(cloud);
    expect(cloudReplayForGameSegment(details, { ...replay, rawCapture: { ...replay.rawCapture!, uploadId: "other" } })).toBeUndefined();
  });
  it("preserves a durable exact-match cloud association without applying its parent to a BO3 child", () => {
    const localMatch = { ...match, webReplayId: cloud.replayId };
    const localReplay = { ...replay, rawCapture: undefined };
    const details = resolveGameDetails({ kind: "match", id: localMatch.id }, [localMatch], [localReplay], "account-one", owner());
    expect(cloudReplayForGameSegment(details, localReplay)).toBe(cloud);
    expect(cloudReplayForGameSegment({ ...details, match: { ...localMatch, id: "series-parent", combinedFromMatchIds: [localMatch.id] } }, localReplay)).toBeUndefined();
    expect(cloudReplayForGameSegment(details, { ...localReplay, rawCapture: { ...replay.rawCapture!, uploadId: "conflicting" } })).toBeUndefined();
  });
});
