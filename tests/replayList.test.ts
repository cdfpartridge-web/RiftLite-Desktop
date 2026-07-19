import { describe, expect, it } from "vitest";
import { upsertReplayPreservingOrder } from "../src/shared/replayList.js";
import type { ReplayRecord } from "../src/shared/types.js";

function replay(id: string, uploadStatus: "not-uploaded" | "uploaded"): ReplayRecord {
  return {
    id,
    matchId: `match-${id}`,
    platform: "atlas",
    capturedAt: "2026-07-19T20:39:51.000Z",
    title: id,
    players: { me: "Me", opponent: "Opponent" },
    events: [],
    rawCapture: {
      provider: "riftlite-v2",
      captureSessionId: `capture-${id}`,
      messageCount: 42,
      uploadStatus
    }
  };
}

describe("upsertReplayPreservingOrder", () => {
  it("replaces a pending replay with its completed delivery state in place", () => {
    const first = replay("newest", "not-uploaded");
    const pending = replay("ambessa", "not-uploaded");
    const ready = {
      ...pending,
      rawCapture: {
        ...pending.rawCapture!,
        uploadStatus: "uploaded" as const,
        processingStatus: "ready" as const,
        discordShareStatus: "shared" as const
      }
    };

    const result = upsertReplayPreservingOrder([first, pending], ready);

    expect(result.map((item) => item.id)).toEqual(["newest", "ambessa"]);
    expect(result[1].rawCapture).toMatchObject({
      uploadStatus: "uploaded",
      processingStatus: "ready",
      discordShareStatus: "shared"
    });
  });

  it("prepends a newly finalized replay that was not in the bootstrap snapshot", () => {
    const result = upsertReplayPreservingOrder([replay("existing", "uploaded")], replay("new", "not-uploaded"));

    expect(result.map((item) => item.id)).toEqual(["new", "existing"]);
  });
});
