import { describe, expect, it } from "vitest";
import { upsertMatchPreservingOrder } from "../src/shared/matchList";
import type { MatchDraft } from "../src/shared/types";

function match(id: string, capturedAt: string): MatchDraft {
  return {
    id,
    platform: "tcga",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "Me",
    opponentName: "Opponent",
    myChampion: "Vex",
    opponentChampion: "Ahri",
    myBattlefield: "",
    opponentBattlefield: "",
    deckName: "",
    deckSourceId: "",
    deckSourceKey: "",
    flags: "",
    notes: "",
    games: [],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

describe("upsertMatchPreservingOrder", () => {
  it("replaces an edited match without moving it to the top", () => {
    const first = match("newest", "2026-04-24T12:00:00.000Z");
    const second = match("older", "2026-04-24T10:00:00.000Z");
    const edited = { ...second, opponentName: "Edited opponent", updatedAt: "2026-04-24T13:00:00.000Z" };

    const result = upsertMatchPreservingOrder([first, second], edited);

    expect(result.map((item) => item.id)).toEqual(["newest", "older"]);
    expect(result[1].opponentName).toBe("Edited opponent");
  });

  it("prepends a brand-new captured match", () => {
    const existing = match("existing", "2026-04-24T10:00:00.000Z");
    const captured = match("captured", "2026-04-24T13:00:00.000Z");

    const result = upsertMatchPreservingOrder([existing], captured);

    expect(result.map((item) => item.id)).toEqual(["captured", "existing"]);
  });
});
