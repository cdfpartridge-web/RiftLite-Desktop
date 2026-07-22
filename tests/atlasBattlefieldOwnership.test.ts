import { describe, expect, it } from "vitest";

import {
  ATLAS_SEAT_ONE_BATTLEFIELD_ZONE,
  ATLAS_SEAT_ZERO_BATTLEFIELD_ZONE,
  atlasBattlefieldCardsByOwner,
  atlasBattlefieldZonesForSeat
} from "../src/shared/atlasBattlefieldOwnership.js";

describe("Atlas battlefield ownership", () => {
  const cards = [
    { zone: "battlefieldB", code: "OGN-287", name: "Sigil of the Storm" },
    { zone: "battlefieldC", code: "OGN-300", name: "Hall of Legends" },
    { zone: "battlefieldA", code: "SFD-218", name: "Sunken Temple" }
  ];

  it("maps battlefield A to a local seat-zero player", () => {
    expect(ATLAS_SEAT_ZERO_BATTLEFIELD_ZONE).toBe("battlefielda");
    expect(ATLAS_SEAT_ONE_BATTLEFIELD_ZONE).toBe("battlefieldb");
    expect(atlasBattlefieldZonesForSeat(0)).toEqual({ me: "battlefielda", opponent: "battlefieldb" });
    expect(atlasBattlefieldCardsByOwner(cards, 0)).toEqual({
      me: cards[2],
      opponent: cards[0]
    });
  });

  it("maps battlefield B to a local seat-one player", () => {
    expect(atlasBattlefieldZonesForSeat(1)).toEqual({ me: "battlefieldb", opponent: "battlefielda" });
    expect(atlasBattlefieldCardsByOwner(cards, 1)).toEqual({
      me: cards[0],
      opponent: cards[2]
    });
  });

  it("fails closed until the local seat is authoritative", () => {
    expect(atlasBattlefieldZonesForSeat(null)).toBeNull();
    expect(atlasBattlefieldCardsByOwner(cards, null)).toEqual({
      me: undefined,
      opponent: undefined
    });
  });

  it("normalizes zone spelling and fails closed when one side is absent", () => {
    const cards = [
      { zone: " Battlefield-A ", code: "SFD-220" }
    ];

    expect(atlasBattlefieldCardsByOwner(cards, 0)).toEqual({
      me: cards[0],
      opponent: undefined
    });
  });
});
