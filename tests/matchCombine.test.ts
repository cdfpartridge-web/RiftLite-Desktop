import { describe, expect, it } from "vitest";
import {
  buildCombinedBo3Match,
  buildMatchCombinePreview,
  isCombinedOriginal,
  markOriginalAsCombined,
  restoreCombinedOriginal
} from "../src/shared/matchCombine";
import type { MatchDraft } from "../src/shared/types";

function savedBo1(id: string, result: MatchDraft["result"], score: string, capturedAt: string): MatchDraft {
  const [myScore = "0", opponentScore = "0"] = score.split("-");
  return {
    id,
    platform: "atlas",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result,
    format: "Bo1",
    score,
    myName: "BMU",
    opponentName: "Tester",
    myChampion: "Vex",
    opponentChampion: "Pyke",
    myBattlefield: "Zaun Warrens",
    opponentBattlefield: "Ripper's Bay",
    deckName: "Vex test",
    deckSourceId: "",
    deckSourceKey: "",
    flags: "",
    notes: "",
    games: [{
      gameNumber: 1,
      result,
      myPoints: Number(myScore),
      oppPoints: Number(opponentScore),
      wentFirst: "undecided",
      myBattlefield: "Zaun Warrens",
      oppBattlefield: "Ripper's Bay"
    }],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

describe("match combine repair helpers", () => {
  it("combines two Bo1 rows into a two-game Bo3 record", () => {
    const first = savedBo1("first", "Win", "7-5", "2026-05-30T10:00:00.000Z");
    const second = savedBo1("second", "Loss", "3-7", "2026-05-30T10:12:00.000Z");

    const preview = buildMatchCombinePreview([first, second]);
    const combined = buildCombinedBo3Match([first, second], "combined", "2026-05-30T10:20:00.000Z");

    expect(preview.canSave).toBe(true);
    expect(combined.format).toBe("Bo3");
    expect(combined.result).toBe("Draw");
    expect(combined.score).toBe("1-1");
    expect(combined.games).toHaveLength(2);
    expect(combined.manualRepair).toBe(true);
    expect(combined.combinedFromMatchIds).toEqual(["first", "second"]);
  });

  it("preserves exact battlefield identities and images from each source game", () => {
    const first = savedBo1("first", "Win", "7-5", "2026-05-30T10:00:00.000Z");
    const second = savedBo1("second", "Loss", "3-7", "2026-05-30T10:12:00.000Z");
    first.games[0] = {
      ...first.games[0],
      myBattlefieldCode: "OGN-123",
      oppBattlefieldCode: "OGN-456",
      myBattlefieldImage: "https://cdn.example/my-battlefield.webp",
      oppBattlefieldImage: "https://cdn.example/opp-battlefield.webp"
    };
    second.games[0] = {
      ...second.games[0],
      myBattlefieldCode: "OGN-789",
      oppBattlefieldCode: "OGN-012"
    };

    const combined = buildCombinedBo3Match([first, second], "combined", "2026-05-30T10:20:00.000Z");

    expect(combined.games[0]).toMatchObject({
      myBattlefieldCode: "OGN-123",
      oppBattlefieldCode: "OGN-456",
      myBattlefieldImage: "https://cdn.example/my-battlefield.webp",
      oppBattlefieldImage: "https://cdn.example/opp-battlefield.webp"
    });
    expect(combined.games[1]).toMatchObject({
      myBattlefieldCode: "OGN-789",
      oppBattlefieldCode: "OGN-012"
    });
  });

  it("does not mislabel the first source game's web replay as the combined Bo3 replay", () => {
    const first = {
      ...savedBo1("first", "Win", "7-5", "2026-05-30T10:00:00.000Z"),
      webReplayId: "single-game-replay",
      webReplayAccountUid: "account-1",
      webReplayLocalReplayId: "local-replay-1"
    };
    const second = savedBo1("second", "Loss", "3-7", "2026-05-30T10:12:00.000Z");

    const combined = buildCombinedBo3Match([first, second], "combined", "2026-05-30T10:20:00.000Z");

    expect(combined.webReplayId).toBeUndefined();
    expect(combined.webReplayAccountUid).toBeUndefined();
    expect(combined.webReplayLocalReplayId).toBeUndefined();
  });

  it("marks originals hidden and can restore them for undo", () => {
    const original = {
      ...savedBo1("first", "Win", "7-5", "2026-05-30T10:00:00.000Z"),
      sync: {
        community: "synced" as const,
        hubs: { "hub-1": "synced" as const },
        teams: { "team-1": "failed" as const }
      }
    };
    const hidden = markOriginalAsCombined(original, "combined", "2026-05-30T10:20:00.000Z");
    const restored = restoreCombinedOriginal(hidden, "2026-05-30T10:25:00.000Z");

    expect(isCombinedOriginal(hidden)).toBe(true);
    expect(hidden.mergedIntoMatchId).toBe("combined");
    expect(hidden.hiddenFromStats).toBe(true);
    expect(restored.mergedIntoMatchId).toBeUndefined();
    expect(restored.hiddenFromStats).toBeUndefined();
    expect(restored.hiddenFromHistory).toBeUndefined();
    expect(restored.sync).toEqual({
      community: "pending",
      hubs: { "hub-1": "pending" },
      teams: { "team-1": "pending" }
    });
  });

  it("warns when selected rows do not look like the same match", () => {
    const first = savedBo1("first", "Win", "7-5", "2026-05-30T10:00:00.000Z");
    const second = { ...savedBo1("second", "Loss", "3-7", "2026-05-30T10:12:00.000Z"), opponentName: "Different player" };

    const preview = buildMatchCombinePreview([first, second]);

    expect(preview.canSave).toBe(true);
    expect(preview.warnings.some((warning) => warning.code === "opponent")).toBe(true);
  });
});
