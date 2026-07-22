export type AtlasPlayerSeat = 0 | 1;

export const ATLAS_SEAT_ZERO_BATTLEFIELD_ZONE = "battlefielda";
export const ATLAS_SEAT_ONE_BATTLEFIELD_ZONE = "battlefieldb";

export interface AtlasBattlefieldZoneCard {
  zone: string;
}

export function atlasBattlefieldZonesForSeat(
  localSeat: AtlasPlayerSeat | null
): { me: string; opponent: string } | null {
  if (localSeat === 0) {
    return {
      me: ATLAS_SEAT_ZERO_BATTLEFIELD_ZONE,
      opponent: ATLAS_SEAT_ONE_BATTLEFIELD_ZONE
    };
  }
  if (localSeat === 1) {
    return {
      me: ATLAS_SEAT_ONE_BATTLEFIELD_ZONE,
      opponent: ATLAS_SEAT_ZERO_BATTLEFIELD_ZONE
    };
  }
  return null;
}

export function atlasBattlefieldCardsByOwner<T extends AtlasBattlefieldZoneCard>(
  cards: readonly T[],
  localSeat: AtlasPlayerSeat | null
): { me: T | undefined; opponent: T | undefined } {
  const zones = atlasBattlefieldZonesForSeat(localSeat);
  if (!zones) {
    return { me: undefined, opponent: undefined };
  }
  return {
    me: cards.find((card) => normalizeAtlasBattlefieldZone(card.zone) === zones.me),
    opponent: cards.find((card) => normalizeAtlasBattlefieldZone(card.zone) === zones.opponent)
  };
}

function normalizeAtlasBattlefieldZone(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
