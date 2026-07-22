import { describe, expect, it } from "vitest";
import { communitySpotlightTarget } from "../src/shared/communitySpotlightNavigation";

describe("communitySpotlightTarget", () => {
  const ids = ["riftlab", "daemonxgg", "ritualtcg", "maskedswan", "arg0ntcg"] as const;

  it("opens an available creator profile directly", () => {
    expect(communitySpotlightTarget("daemonxgg", ids)).toBe("daemonxgg");
    expect(communitySpotlightTarget("maskedswan", ids)).toBe("maskedswan");
    expect(communitySpotlightTarget("arg0ntcg", ids)).toBe("arg0ntcg");
  });

  it("falls back to the creator overview for missing or unknown profiles", () => {
    expect(communitySpotlightTarget("", ids)).toBe("");
    expect(communitySpotlightTarget("unknown", ids)).toBe("");
    expect(communitySpotlightTarget(null, ids)).toBe("");
  });
});
