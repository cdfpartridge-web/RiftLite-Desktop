import { describe, expect, it } from "vitest";
import { diagnosticBundleDocument, redactDiagnosticValue } from "../src/shared/diagnosticPrivacy.js";
import type { CaptureDiagnosticsSummary, CaptureEvent } from "../src/shared/types.js";

const event: CaptureEvent = {
  id: "atlas-event-1",
  platform: "atlas",
  kind: "debug",
  capturedAt: "2026-07-19T12:00:00.000Z",
  url: "https://play.riftatlas.com/game/ROOM-123?token=query-secret#private",
  payload: {
    reason: "capture-check",
    myName: "Alice Tester",
    opponentName: "Bob Opponent",
    roomCode: "ROOM-123",
    requestUrl: "wss://realtime.riftatlas-workers.com/socket?access_token=socket-secret",
    authorization: "Bearer header-secret",
    raw: JSON.stringify({ player: "Alice Tester", token: "raw-secret" }),
    message: "Alice Tester joined Bob Opponent in ROOM-123",
    cards: [{ code: "OGN-001", count: 2 }]
  }
};

const summary: CaptureDiagnosticsSummary = {
  path: "C:\\Users\\Alice Tester\\AppData\\RiftLite\\riftlite-capture-events.jsonl",
  totalEvents: 1,
  lastEventAt: event.capturedAt,
  byKind: { debug: 1 },
  byPlatform: { tcga: 0, atlas: 1, sim: 0 },
  latest: [{
    platform: "atlas",
    lastEventAt: event.capturedAt,
    url: event.url,
    active: true,
    player: "Alice Tester",
    opponent: "Bob Opponent",
    score: "1-0",
    format: "Bo3",
    hasCards: true,
    cardCount: 1,
    logRows: 2,
    roomCode: "ROOM-123",
    endText: "",
    payloadKeys: Object.keys(event.payload)
  }]
};

describe("diagnostic privacy", () => {
  it("redacts identity, rooms, secrets, local paths, URL queries, and raw data by default", () => {
    const document = diagnosticBundleDocument(summary, [event]);
    const encoded = JSON.stringify(document);

    expect(document.privacy.sensitiveDataIncluded).toBe(false);
    expect(encoded).not.toContain("Alice Tester");
    expect(encoded).not.toContain("Bob Opponent");
    expect(encoded).not.toContain("ROOM-123");
    expect(encoded).not.toContain("query-secret");
    expect(encoded).not.toContain("socket-secret");
    expect(encoded).not.toContain("header-secret");
    expect(encoded).not.toContain("raw-secret");
    expect(encoded).not.toContain("C:\\\\Users");
    expect(encoded).toContain("REDACTED_RAW_DATA");
    expect(document.events[0].payload).toMatchObject({ reason: "capture-check" });
    expect(document.events[0].payload.cards).toEqual([{ code: "OGN-001", count: 2 }]);
  });

  it("only includes the original values for an explicitly sensitive document", () => {
    const document = diagnosticBundleDocument(summary, [event], true);
    const encoded = JSON.stringify(document);

    expect(document.privacy.sensitiveDataIncluded).toBe(true);
    expect(encoded).toContain("Alice Tester");
    expect(encoded).toContain("ROOM-123");
    expect(encoded).toContain("raw-secret");
  });

  it("redacts sensitive values when they are repeated in otherwise useful messages", () => {
    const value = redactDiagnosticValue({
      myName: "Test Name",
      note: "Test Name opened https://example.com/path?token=abc123"
    });

    expect(value.note).toContain("[REDACTED]");
    expect(value.note).not.toContain("Test Name");
    expect(value.note).not.toContain("abc123");
  });
});
