import { describe, expect, it, vi } from "vitest";
import { mergeAccountReplayLibrary } from "../src/shared/accountReplayLibrary.js";
import { loadAccountReplayLibrary, sanitizeAccountReplayLibraryItem } from "../src/main/services/accountReplayLibrary.js";
import type { MatchDraft, ReplayRecord } from "../src/shared/types.js";

const summary = { replayId: "rpl_one", captureId: "capture-one", title: "Ahri vs Irelia", platform: "atlas", visibility: "private", status: "ready", capturedAt: "2026-10-01T10:00:00Z", createdAt: "2026-10-01T10:01:00Z", updatedAt: "2026-10-01T10:02:00Z" };
const cloud = sanitizeAccountReplayLibraryItem(summary)!;
function response(items: unknown[] = [summary]) { return new Response(JSON.stringify({ scope: "mine", items })); }
const match: MatchDraft = {
  id: "match-one", platform: "atlas", status: "saved", capturedAt: summary.capturedAt, updatedAt: summary.updatedAt,
  result: "Win", format: "Bo1", score: "8-6", myName: "Player", opponentName: "Opponent", myChampion: "Ahri", opponentChampion: "Irelia",
  myBattlefield: "", opponentBattlefield: "", deckName: "", deckSourceId: "", flags: "", notes: "", games: [], rawEvidence: [], sync: { community: "disabled", hubs: {}, teams: {} }
};
function replay(id = "local-one", patch: Partial<ReplayRecord> = {}): ReplayRecord {
  return { id, matchId: match.id, platform: "atlas", capturedAt: summary.capturedAt, title: summary.title, players: { me: "Player", opponent: "Opponent" }, events: [], ...patch };
}

describe("account replay library request boundary", () => {
  it("pins account identity and keeps its token in the authenticated main-process request", async () => {
    const fetchImpl = vi.fn(async () => response());
    const getAccessToken = vi.fn(async () => "secret-token");
    const result = await loadAccountReplayLibrary({ getAccountUid: () => "user-one", getAccessToken, fetchImpl });
    expect(getAccessToken).toHaveBeenCalledWith("user-one");
    expect(fetchImpl.mock.calls[0]).toEqual(["https://www.riftlite.com/api/v2/replays?scope=mine&limit=100", expect.objectContaining({ headers: { Authorization: "Bearer secret-token", Accept: "application/json" }, redirect: "error" })]);
    expect(result).toMatchObject({ accountUid: "user-one", available: true, items: [cloud], mayHaveMore: false });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("does not refresh or fetch when there is no linked account", async () => {
    const getAccessToken = vi.fn(async () => "token");
    const fetchImpl = vi.fn(async () => response());
    const result = await loadAccountReplayLibrary({ getAccountUid: () => "", getAccessToken, fetchImpl });
    expect(result).toMatchObject({ available: false, items: [], accountUid: "" });
    expect(getAccessToken).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an account switch during token refresh before fetching", async () => {
    let uid = "user-one";
    const fetchImpl = vi.fn(async () => response());
    const result = await loadAccountReplayLibrary({ getAccountUid: () => uid, getAccessToken: async () => { uid = "user-two"; return "token"; }, fetchImpl });
    expect(result).toMatchObject({ available: false, items: [], accountUid: "" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("discards the response when the account changes during fetch", async () => {
    let uid = "user-one";
    const result = await loadAccountReplayLibrary({ getAccountUid: () => uid, getAccessToken: async () => "token", fetchImpl: async () => { uid = "user-two"; return response(); } });
    expect(result).toMatchObject({ available: false, accountUid: "", items: [] });
  });

  it("also discards a response after a switch while its body is being read", async () => {
    let uid = "user-one";
    const reply = response();
    vi.spyOn(reply, "text").mockImplementation(async () => { uid = "user-two"; return JSON.stringify({ scope: "mine", items: [summary] }); });
    const result = await loadAccountReplayLibrary({ getAccountUid: () => uid, getAccessToken: async () => "token", fetchImpl: async () => reply });
    expect(result).toMatchObject({ available: false, accountUid: "", items: [] });
  });

  it("reports the owner cap without claiming a known next page exists", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...summary, replayId: `rpl_${index}` }));
    const result = await loadAccountReplayLibrary({ getAccountUid: () => "user-one", getAccessToken: async () => "token", fetchImpl: async () => response(items) });
    expect(result).toMatchObject({ available: true, limit: 100, mayHaveMore: true });
    expect(result.items).toHaveLength(100);
  });

  it("returns a distinct unavailable state for auth or network errors without exposing error internals", async () => {
    const deps = { getAccountUid: () => "user-one", getAccessToken: async () => "secret-token" };
    const denied = await loadAccountReplayLibrary({ ...deps, fetchImpl: async () => new Response("private diagnostic", { status: 401 }) });
    expect(denied).toMatchObject({ available: false, items: [] });
    expect(denied.error).toContain("Reconnect");
    const failed = await loadAccountReplayLibrary({ ...deps, fetchImpl: async () => { throw new Error("Authorization: Bearer secret-token"); } });
    expect(failed.available).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("secret-token");
  });

  it("distinguishes an empty account library from an unreadable or public response", async () => {
    const deps = { getAccountUid: () => "user-one", getAccessToken: async () => "token" };
    expect(await loadAccountReplayLibrary({ ...deps, fetchImpl: async () => response([]) })).toMatchObject({ available: true, items: [] });
    expect(await loadAccountReplayLibrary({ ...deps, fetchImpl: async () => new Response(JSON.stringify({ scope: "public", items: [summary] })) })).toMatchObject({ available: false, items: [] });
  });

  it("whitelists returned fields and canonical URLs, preserves exact identities and bounds display text", () => {
    const item = sanitizeAccountReplayLibraryItem({ ...summary, url: "https://evil.example", accessToken: "secret", title: "a".repeat(500), failure: { token: "secret" }, warnings: [{ code: "partial", message: "Opening turn missing" }] })!;
    expect(item.url).toBe("https://www.riftlite.com/replays/rpl_one");
    expect(item.title).toHaveLength(200);
    expect(item.warnings).toEqual(["Opening turn missing"]);
    expect(JSON.stringify(item)).not.toContain("secret");
    expect(sanitizeAccountReplayLibraryItem({ ...summary, replayId: "../../evil" })).toBeNull();
    expect(sanitizeAccountReplayLibraryItem({ ...summary, captureId: "x".repeat(513) })?.captureId).toBeUndefined();
  });
});

describe("exact identity account replay merge", () => {
  it("combines an upload id with its cloud replay and local match", () => {
    const local = replay("local-one", { rawCapture: { provider: "riftlite-v2", captureSessionId: "different", messageCount: 5, uploadStatus: "uploaded", uploadId: cloud.replayId } });
    expect(mergeAccountReplayLibrary([local], [match], [cloud])).toEqual([{ id: "local:local-one", replay: local, match, cloudReplay: cloud }]);
  });

  it("combines exact capture ids when the local upload id was never persisted", () => {
    const local = replay("local-one", { rawCapture: { provider: "riftlite-v2", captureSessionId: cloud.captureId!, messageCount: 5, uploadStatus: "not-uploaded" } });
    expect(mergeAccountReplayLibrary([local], [], [cloud])).toHaveLength(1);
    expect(mergeAccountReplayLibrary([local], [], [cloud])[0].cloudReplay).toBe(cloud);
  });

  it("retains durable match associations when local replay files were not kept", () => {
    const linked = { ...match, keepReplay: false, webReplayId: cloud.replayId };
    expect(mergeAccountReplayLibrary([], [linked], [cloud])).toEqual([{ id: `match:${match.id}`, match: linked, cloudReplay: cloud }]);
  });

  it("keeps match-only games visible with stable ids even when no replay was recorded", () => {
    expect(mergeAccountReplayLibrary([], [match], [])).toEqual([{ id: `match:${match.id}`, match }]);
    expect(mergeAccountReplayLibrary([], [{ ...match, hiddenFromHistory: true }], [])).toEqual([]);
    expect(mergeAccountReplayLibrary([], [{ ...match, mergedIntoMatchId: "combined" }], [])).toEqual([]);
  });

  it("does not guess identity from equal titles, players or timestamps", () => {
    const rows = mergeAccountReplayLibrary([replay()], [match], [cloud]);
    expect(rows).toHaveLength(2);
    expect(rows[0].cloudReplay).toBeUndefined();
    expect(rows[1]).toEqual({ id: "cloud:rpl_one", cloudReplay: cloud });
  });

  it("does not let an equal capture id override a different durable upload id", () => {
    const local = replay("local-one", { rawCapture: { provider: "riftlite-v2", captureSessionId: cloud.captureId!, messageCount: 5, uploadStatus: "uploaded", uploadId: "rpl_different" } });
    expect(mergeAccountReplayLibrary([local], [], [cloud])).toHaveLength(2);
  });

  it("preserves ambiguous duplicate capture rows instead of choosing one arbitrarily", () => {
    const rawCapture = { provider: "riftlite-v2" as const, captureSessionId: cloud.captureId!, messageCount: 5, uploadStatus: "not-uploaded" as const };
    const rows = mergeAccountReplayLibrary([replay("one", { rawCapture }), replay("two", { rawCapture })], [], [cloud]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.cloudReplay)).toHaveLength(1);
    expect(rows[2].replay).toBeUndefined();
  });

  it("preserves cloud-only games and deduplicates repeated API items", () => {
    expect(mergeAccountReplayLibrary([], [], [cloud, cloud])).toEqual([{ id: "cloud:rpl_one", cloudReplay: cloud }]);
  });

  it("keeps local games through offline errors, excludes deleted local records and does not mutate inputs", () => {
    const local = replay();
    const rows = mergeAccountReplayLibrary([local, replay("deleted", { deletedAt: summary.updatedAt })], [match], []);
    expect(rows).toEqual([{ id: "local:local-one", replay: local, match }]);
    expect(local).not.toHaveProperty("cloudReplay");
  });
});
