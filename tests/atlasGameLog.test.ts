import { describe, expect, it } from "vitest";
import { buildAtlasGameLog } from "../src/shared/atlasGameLog";
import type { CaptureEvent, MatchDraft, ReplayRecord, ReplayStructuredEvent } from "../src/shared/types";

const START = 1_790_000_000_000;
const frame = (seq: number, packet: unknown, dir = "in") => ({ seq, dir, ts: START + seq * 1000, raw: JSON.stringify(packet) });
const snapshot = (gameNumber: number, gameplayLog: unknown[], room = "ROOM1") => ({
  type: "authoritative_snapshot", gameInstanceId: room,
  snapshot: { gameNumber, phase: "in_game", players: [{ id: "p1", name: "Alice" }], gameplayLog },
});
const insert = (entries: unknown[], extra: object = {}) => ({ type: "authoritative_patch_commit", ...extra, ops: [{ op: "log_insert", index: 0, entries }] });
const entry = (id: string, text: string, at = START) => ({ id, text, at, authorPlayerId: "p1" });
const texts = (result: ReturnType<typeof buildAtlasGameLog>) => result.games.map((game) => game.entries.map((row) => row.text));
const replay = (patch: Partial<ReplayRecord> = {}): ReplayRecord => ({
  id: "replay-1", matchId: "match-1", platform: "atlas", capturedAt: new Date(START).toISOString(),
  title: "Akali vs Irelia", players: { me: "Alice", opponent: "Bob" }, events: [], ...patch,
});
const rowEvent = (id: string, text: string, patch: Partial<ReplayStructuredEvent> = {}): ReplayStructuredEvent => ({
  id, sourceEventId: "capture-1", gameNumber: 1, capturedAt: new Date(START).toISOString(),
  labelTime: "13:37", type: "action", side: "system", text, cardName: "", destination: "", battlefield: "", ...patch,
});
const evidence = (rows: unknown[], gameNumber = 1, id = "capture-1"): CaptureEvent => ({
  id, platform: "atlas", kind: "match-snapshot", capturedAt: new Date(START).toISOString(),
  url: "https://riftatlas.com/play/ROOM1", payload: { rows, gameNumber },
});

describe("Atlas game log", () => {
  it("reads original snapshot rows, resolves actors, and preserves distinct repeated actions", () => {
    const result = buildAtlasGameLog({ payload: { messages: [frame(0, snapshot(1, [
      entry("b", "Paid 1 Energy."), entry("a", "Paid 1 Energy."), entry("turn", "Starting turn 17"),
    ]))] } });
    expect(result.source).toBe("raw");
    expect(result.partial).toBe(false);
    expect(texts(result)).toEqual([["Starting turn 17", "Paid 1 Energy.", "Paid 1 Energy."]]);
    expect(result.games[0].entries[0]).toMatchObject({ actor: "Alice", time: expect.any(String) });
    expect(new Set(result.games[0].entries.map((row) => row.id)).size).toBe(3);
  });

  it("orders equal-time native snapshots and insertion batches oldest first using native positions", () => {
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(0, { type: "authoritative_snapshot", snapshot: { gameNumber: 1 }, gameplayLog: [
        entry("choose", "Choose who starts.", START), entry("roll", "Rolled initiative.", START),
      ] }),
      frame(1, { type: "authoritative_patch_commit", patch: { operations: [
        { op: "log_insert", index: 0, entries: [entry("both", "Both battlefields are locked.", START + 1000)] },
        { op: "log_insert", index: 1, entries: [entry("player", "Player locked in a battlefield.", START + 1000)] },
      ] } }),
      // Duplicate delivery must not erase the previously established order.
      frame(2, insert([entry("both", "Both battlefields are locked.", START + 1000)])),
    ] } });
    expect(texts(result)).toEqual([[
      "Rolled initiative.", "Choose who starts.", "Player locked in a battlefield.", "Both battlefields are locked.",
    ]]);
  });

  it("retains the whole observed history across Atlas's native rolling window while honoring explicit rewind", () => {
    const oldRows = Array.from({ length: 100 }, (_, index) => entry(`row-${99 - index}`, `Action ${99 - index}`, START + (99 - index) * 1000));
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(0, { type: "authoritative_snapshot", snapshot: { gameNumber: 1, phase: "battlefield_pick" }, gameplayLog: [] }),
      frame(1, { type: "authoritative_patch_commit", action: { type: "payment_batch" }, patch: { operations: [
        { op: "log_insert", index: 0, entries: oldRows },
      ] } }),
      frame(2, { type: "authoritative_patch_commit", action: { type: "end_turn" }, patch: { operations: [
        { op: "log_remove", entryIds: ["row-0"] },
        { op: "log_insert", index: 0, entries: [entry("row-100", "Action 100", START + 100_000)] },
      ] } }),
      // A later snapshot contains only the retained native window.
      frame(3, { type: "authoritative_snapshot", snapshot: { gameNumber: 1 }, gameplayLog: [entry("row-100", "Action 100", START + 100_000), ...oldRows.slice(0, 98)] }),
      frame(4, { type: "authoritative_patch_commit", action: { type: "rewind_last_action" }, patch: { operations: [
        { op: "log_remove", entryIds: ["row-100"] },
      ] } }),
      // Some normal actions only trim a row without adding visible log text.
      frame(5, { type: "authoritative_patch_commit", action: { type: "set_card_hidden" }, patch: { operations: [
        { op: "log_remove", entryIds: ["row-2"] },
      ] } }),
    ] } });
    expect(result.partial).toBe(false);
    expect(result.games[0].entries).toHaveLength(100);
    expect(result.games[0].entries.map((row) => row.text)).toEqual(Array.from({ length: 100 }, (_, index) => `Action ${index}`));
  });

  it("marks a first already-full native snapshot as partial because earlier rows may be absent", () => {
    const result = buildAtlasGameLog({ payload: { messages: [frame(0, {
      type: "authoritative_snapshot", snapshot: { gameNumber: 1, phase: "in_game" },
      gameplayLog: Array.from({ length: 99 }, (_, index) => entry(`${index}`, `Tail ${index}`)),
    })] } });
    expect(result).toMatchObject({ source: "raw", partial: true });
    expect(result.games[0].entries).toHaveLength(99);
  });

  it("applies incoming patches in capture sequence, honours insertion order and undo, and ignores outbound requests", () => {
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(3, { type: "authoritative_patch_commit", patch: { operations: [{ op: "log_remove", entryIds: ["b"] }] } }),
      frame(0, snapshot(1, [entry("c", "Third"), entry("a", "First")])),
      frame(1, { type: "authoritative_patch_commit", operations: [{ op: "log_insert", index: 1, entries: [entry("b", "Undo this")] }] }),
      frame(2, insert([entry("c", "Third"), entry("d", "Fourth")])),
      frame(4, insert([entry("private", "Do not include uncommitted outgoing actions")]), "out"),
    ] } });
    expect(texts(result)).toEqual([["First", "Third", "Fourth"]]);
    expect(result.partial).toBe(false);
  });

  it("replaces the native log on resync and never resurrects removed rows from fallback evidence", () => {
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(0, snapshot(1, [entry("a", "Old action")])),
      frame(1, { type: "setup_log_sync", gameInstanceId: "ROOM1", log: [] }),
    ] }, replay: replay({ structuredEvents: [rowEvent("capture:row:1", "Old action")] }) });
    expect(result.source).toBe("raw");
    expect(texts(result)).toEqual([[]]);
  });

  it("separates BO3 games using explicit numbers, including reused room and entry ids", () => {
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(0, snapshot(1, [entry("turn-1", "Game one turn")])),
      frame(1, { type: "authoritative_patch_commit", ops: [{ op: "set_room_fields", fields: { gameNumber: 2, phase: "sideboarding" } }] }),
      frame(2, snapshot(2, [entry("turn-1", "Game two turn")])),
      frame(3, insert([entry("turn-2", "Game two action")])),
      frame(4, { type: "room_shell_sync", sessionDoc: { gameNumber: 3, roomCode: "ROOM3" } }),
      frame(5, snapshot(3, [entry("turn-1", "Game three turn")], "ROOM3")),
    ] } });
    expect(result.games.map((game) => game.gameNumber)).toEqual([1, 2, 3]);
    expect(texts(result)).toEqual([["Game one turn"], ["Game two turn", "Game two action"], ["Game three turn"]]);
    expect(new Set(result.games.flatMap((game) => game.entries.map((row) => row.id))).size).toBe(4);
  });

  it("uses retained lifecycle sequence ranges when packets omit game numbers", () => {
    const result = buildAtlasGameLog({ payload: {
      capture: { lifecycle: { games: [
        { gameNumber: 1, source: { fromSeq: 0, toSeq: 1 } },
        { gameNumber: 2, source: { fromSeq: 2, toSeq: 3 } },
      ] } },
      messages: [
        frame(0, { type: "setup_log_sync", log: [entry("same", "Game one")] }),
        frame(2, { type: "setup_log_sync", log: [entry("same", "Game two")] }),
      ],
    } });
    expect(texts(result)).toEqual([["Game one"], ["Game two"]]);
  });

  it("keeps delayed previous-room packets scoped to that game without redirecting the active game", () => {
    const result = buildAtlasGameLog({ payload: { messages: [
      frame(0, snapshot(1, [entry("a", "One")], "ROOM1")),
      frame(1, snapshot(2, [entry("a", "Two")], "ROOM2")),
      frame(2, insert([entry("b", "Late one")], { gameInstanceId: "ROOM1" })),
      frame(3, { type: "room_shell_sync", sessionDoc: { roomCode: "ROOM1", gameNumber: 1 } }),
      frame(4, insert([entry("b", "New two")])),
    ] } });
    expect(texts(result)).toEqual([["One", "Late one"], ["Two", "New two"]]);
  });

  it("recognises parsed/nested packets and marks patch-only captures as partial", () => {
    const result = buildAtlasGameLog({ payload: { rawCheckpoint: { retainedMessages: [{
      seq: 0, dir: "in", parsed: { type: "state_patch", payload: { ops: [{ op: "log_insert", entries: [entry("x", "Captured tail")] }] } },
    }] } } });
    expect(texts(result)).toEqual([["Captured tail"]]);
    expect(result).toMatchObject({ source: "raw", partial: true });
  });

  it("keeps text as plain strings and ignores unsupported objects rather than inventing log actions", () => {
    const result = buildAtlasGameLog({ payload: { messages: [frame(0, snapshot(1, [
      { id: "message", message: "Native message fallback" },
      { id: "missing", content: { secret: "ignored" } }, entry("literal", '<img src=x onerror="alert(1)">'),
    ]))] } });
    expect(texts(result)).toEqual([['<img src=x onerror="alert(1)">', "Native message fallback"]]);
  });

  it("returns only direct game-log structured events from legacy captures, without inferred score/board actions", () => {
    const result = buildAtlasGameLog({ replay: replay({ structuredEvents: [
      rowEvent("row-with-evidence", "Paid 1 Energy.", { evidence: { source: "game-log", confidence: "confirmed" } }),
      rowEvent("capture:row:2", "Moved Qiyana to trash."),
      rowEvent("capture:score:1", "Score changed", { evidence: { source: "state-diff", confidence: "reconstructed" } }),
    ] }) });
    expect(texts(result)).toEqual([["Paid 1 Energy.", "Moved Qiyana to trash."]]);
    expect(result).toMatchObject({ source: "captured", partial: true });
  });

  it("deduplicates repeated DOM snapshots while retaining distinct stable log ids with equal text", () => {
    const result = buildAtlasGameLog({ replay: replay({ events: [
      evidence([{ key: "riftlite-log:a", text: "13:37 Paid 1 Energy." }]),
      evidence([{ key: "riftlite-log:a", text: "13:37 Paid 1 Energy." }, { key: "riftlite-log:b", text: "13:37 Paid 1 Energy." }], 1, "capture-2"),
    ], structuredEvents: [rowEvent("capture:row:1", "Paid 1 Energy.")] }) });
    expect(texts(result)).toEqual([["Paid 1 Energy.", "Paid 1 Energy."]]);
  });

  it("reads legacy DOM rows across games, retains resource actions, and excludes captured chat", () => {
    const result = buildAtlasGameLog({ match: { platform: "atlas", rawEvidence: [
      evidence([{ key: "same-id", text: "13:37 Exhausted 2 Calm runes." }, { text: "Bob at 13:37: hello" }]),
      evidence([{ key: "same-id", text: "13:38 Paid 1 Energy." }], 2),
    ] } as MatchDraft });
    expect(texts(result)).toEqual([["Exhausted 2 Calm runes."], ["Paid 1 Energy."]]);
    expect(result.games.map((game) => game.gameNumber)).toEqual([1, 2]);
  });

  it("merges fallback sources chronologically across midnight and respects native BO3 game numbers", () => {
    const iso = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute).toISOString();
    const gameOne = evidence([
      { key: "late", text: "00:01 After midnight", observedAt: iso(21, 0, 2) },
      { key: "same", text: "23:59 Before midnight second", observedAt: iso(21, 0, 2) },
      { key: "first", text: "23:59 Before midnight first", observedAt: iso(21, 0, 2) },
    ]);
    gameOne.capturedAt = iso(21, 0, 2);
    gameOne.payload.atlasBo3GameNumber = 1;
    delete gameOne.payload.gameNumber;
    const gameTwo = evidence([{ key: "same", text: "00:04 Next game" }]);
    gameTwo.capturedAt = iso(21, 0, 5);
    gameTwo.payload.atlasBo3GameNumber = 2;
    delete gameTwo.payload.gameNumber;
    const result = buildAtlasGameLog({ replay: replay({
      structuredEvents: [rowEvent("capture:row:midnight", "At midnight", { capturedAt: iso(21, 0, 0), labelTime: "00:00" })],
      events: [gameTwo, gameOne],
    }) });
    expect(result.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(texts(result)).toEqual([[
      "Before midnight first", "Before midnight second", "At midnight", "After midnight",
    ], ["Next game"]]);
    expect(result).toMatchObject({ source: "captured", partial: true });
  });

  it("handles malformed messages and falls back when a capture has no log protocol", () => {
    const result = buildAtlasGameLog({ payload: { messages: [{ seq: 0, raw: "broken" }, frame(1, { type: "chat_append", text: "Not a game log" })] },
      replay: replay({ events: [evidence([{ text: "13:37 Captured action" }])] }) });
    expect(result).toMatchObject({ source: "captured", partial: true });
    expect(texts(result)).toEqual([["Captured action"]]);
    expect(buildAtlasGameLog({})).toEqual({ games: [], source: "none", partial: false });
  });

  it("respects keepReplay=false and never labels other platforms as Atlas logs", () => {
    const payload = { messages: [frame(0, snapshot(1, [entry("a", "Private log")]))] };
    expect(buildAtlasGameLog({ payload, match: { platform: "atlas", keepReplay: false } as MatchDraft }).source).toBe("none");
    expect(buildAtlasGameLog({ payload, replay: replay({ platform: "tcga" }) }).source).toBe("none");
  });

  it("reports bounded/truncated imports and retained capture warnings as partial", () => {
    const payload = { messages: [frame(0, snapshot(1, [entry("long", "x".repeat(9_000))]))] };
    const result = buildAtlasGameLog({ payload });
    expect(result.partial).toBe(true);
    expect(result.games[0].entries[0].text).toHaveLength(8_000);
    const warned = buildAtlasGameLog({ payload: { messages: [frame(0, snapshot(1, []))] }, replay: replay({
      rawCapture: { provider: "riftlite-v2", captureSessionId: "c", messageCount: 1, uploadStatus: "not-uploaded", partialWarnings: ["Capture interrupted"] },
    }) });
    expect(warned.partial).toBe(true);
  });
});
