import { describe, expect, it } from "vitest";
import { communitySpotlightTarget } from "../src/shared/communitySpotlightNavigation";

describe("communitySpotlightTarget", () => {
  const ids = ["riftlab", "frodan", "daemonxgg", "ritualtcg", "maskedswan", "arg0ntcg", "tronisbad", "zelonius"] as const;

  it("opens an available creator profile directly", () => {
    expect(communitySpotlightTarget("daemonxgg", ids)).toBe("daemonxgg");
    expect(communitySpotlightTarget("frodan", ids)).toBe("frodan");
    expect(communitySpotlightTarget("maskedswan", ids)).toBe("maskedswan");
    expect(communitySpotlightTarget("arg0ntcg", ids)).toBe("arg0ntcg");
    expect(communitySpotlightTarget("tronisbad", ids)).toBe("tronisbad");
    expect(communitySpotlightTarget("zelonius", ids)).toBe("zelonius");
    expect(communitySpotlightTarget("bloody", ids)).toBe("");
  });

  it("falls back to the creator overview for missing or unknown profiles", () => {
    expect(communitySpotlightTarget("", ids)).toBe("");
    expect(communitySpotlightTarget("unknown", ids)).toBe("");
    expect(communitySpotlightTarget(null, ids)).toBe("");
  });
});
