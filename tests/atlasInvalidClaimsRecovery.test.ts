import { describe, expect, it } from "vitest";

import { AtlasInvalidClaimsRecoveryBudget } from "../src/shared/atlasInvalidClaimsRecovery.js";

describe("Atlas invalid-claims recovery budget", () => {
  it("refreshes once, resets only sign-in once, then stops across replacement guests", () => {
    const budget = new AtlasInvalidClaimsRecoveryBudget();

    expect(budget.next(1_000)).toBe("refresh-token");
    expect(budget.next(2_000)).toBe("reset-sign-in");
    expect(budget.next(3_000)).toBe("stop");
    expect(budget.next(4_000)).toBe("stop");
  });

  it("reopens recovery after a proven healthy match boundary", () => {
    const budget = new AtlasInvalidClaimsRecoveryBudget();
    budget.next(1_000);
    budget.next(2_000);
    budget.markHealthy();

    expect(budget.next(3_000)).toBe("refresh-token");
  });

  it("expires an abandoned recovery window without needing an app reset", () => {
    const budget = new AtlasInvalidClaimsRecoveryBudget(5_000);
    budget.next(1_000);
    budget.next(2_000);
    expect(budget.next(6_999)).toBe("stop");
    expect(budget.next(7_000)).toBe("refresh-token");
  });
});
