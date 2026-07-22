import { describe, expect, it } from "vitest";
import {
  sanitizeTcgaResearchUrl,
  sanitizeTcgaResearchValue,
  TCGA_RESEARCH_REDACTED_LOCAL_PATH,
  TCGA_RESEARCH_REDACTED_NETWORK_METADATA
} from "../src/shared/tcgaResearchPrivacy";

describe("TCGA research privacy", () => {
  it("removes authentication, network metadata, URL secrets, and local paths", () => {
    const jwt = "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk";
    const sanitized = sanitizeTcgaResearchValue({
      requestUrl: "https://firestore.googleapis.com/v1/projects/riftlite/games/GAME-1?key=url-secret#private",
      socketUrl: "wss://tcg-arena.fr/game/GAME-1?access_token=socket-secret",
      headers: { authorization: "Bearer header-secret", ordinary: "value" },
      requestCookies: [{ name: "session", value: "cookie-secret" }],
      password: "password-secret",
      refreshToken: "refresh-secret",
      nested: {
        authorization: "Bearer nested-secret",
        message: `request used Bearer inline-secret, token=form-secret, Cookie: session=cookie-inline-secret and ${jwt}`,
        windowsPath: "C:\\Users\\Alice\\Documents\\tcga.json",
        unixPath: "/home/alice/private/tcga.json"
      },
      raw: JSON.stringify({
        token: "raw-token-secret",
        clientSecret: "raw-client-secret",
        actionId: "RAW-ACTION-1",
        cardId: "OGN-001"
      })
    });
    const encoded = JSON.stringify(sanitized);

    expect(sanitized.requestUrl).toBe("https://firestore.googleapis.com/v1/projects/riftlite/games/GAME-1");
    expect(sanitized.socketUrl).toBe("wss://tcg-arena.fr/game/GAME-1");
    expect(sanitized.headers).toBe(TCGA_RESEARCH_REDACTED_NETWORK_METADATA);
    expect(sanitized.requestCookies).toBe(TCGA_RESEARCH_REDACTED_NETWORK_METADATA);
    expect(sanitized.nested.windowsPath).toBe(TCGA_RESEARCH_REDACTED_LOCAL_PATH);
    expect(sanitized.nested.unixPath).toBe(TCGA_RESEARCH_REDACTED_LOCAL_PATH);
    for (const secret of [
      "url-secret",
      "socket-secret",
      "header-secret",
      "cookie-secret",
      "password-secret",
      "refresh-secret",
      "nested-secret",
      "inline-secret",
      "form-secret",
      "cookie-inline-secret",
      "raw-token-secret",
      "raw-client-secret",
      jwt
    ]) {
      expect(encoded).not.toContain(secret);
    }
    expect(sanitized.raw).toContain("RAW-ACTION-1");
    expect(sanitized.raw).toContain("OGN-001");
  });

  it("retains gameplay, card, action, and identity evidence", () => {
    const input = {
      gameId: "GAME-123",
      sessionId: "MATCH-SESSION-456",
      actorPlayerId: "PLAYER-1",
      action: {
        actionId: "ACTION-9",
        type: "play_card",
        path: "/games/GAME-123/actions/ACTION-9",
        sequence: 42
      },
      card: {
        cardId: "OGN-001",
        name: "Jinx",
        zone: "hand"
      },
      token: {
        type: "Sprite",
        cardId: "TKN-002"
      },
      participants: ["Alice", "Bob"]
    };

    expect(sanitizeTcgaResearchValue(input)).toEqual(input);
  });

  it("preserves exact base64 RTC bytes so BinaryPack remains decodable", () => {
    const encoded = Buffer.from("token=game-state-value", "utf8").toString("base64");
    expect(sanitizeTcgaResearchValue({
      encoding: "base64",
      data: encoded,
      byteLength: 22
    })).toEqual({
      encoding: "base64",
      data: encoded,
      byteLength: 22
    });
  });

  it("sanitizes JSON carried in the monitor's utf8 data envelope", () => {
    const sanitized = sanitizeTcgaResearchValue({
      encoding: "utf8",
      data: JSON.stringify({
        token: "transport-secret",
        authorization: "Bearer nested-secret",
        actionId: "ACTION-UTF8-1",
        cardId: "OGN-042"
      })
    });
    const decoded = JSON.parse(sanitized.data) as Record<string, unknown>;

    expect(JSON.stringify(decoded)).not.toContain("transport-secret");
    expect(JSON.stringify(decoded)).not.toContain("nested-secret");
    expect(decoded).toMatchObject({ actionId: "ACTION-UTF8-1", cardId: "OGN-042" });
  });

  it("sanitizes standalone URLs without discarding endpoint paths", () => {
    expect(sanitizeTcgaResearchUrl("https://user:pass@tcg-arena.fr/api/game/ABC?token=secret#state"))
      .toBe("https://tcg-arena.fr/api/game/ABC");
    expect(sanitizeTcgaResearchUrl("file:///C:/Users/Alice/private.json"))
      .toBe(TCGA_RESEARCH_REDACTED_LOCAL_PATH);
  });
});
