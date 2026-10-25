import { describe, expect, it } from "vitest";
import { AtlasObserverTiming } from "../src/main/services/atlasObserverTiming.js";

function fixture() {
  let mono = 10_000;
  const timing = new AtlasObserverTiming(() => mono);
  return { timing, at(value: number) { mono = value; } };
}

describe("Atlas CDP source/observer timing", () => {
  it("waits for paired source clocks and includes delay already present on the first handshake", () => {
    const f = fixture();
    expect(f.timing.observe({ timestamp: 100 }, 1_000_000)).toBeNull();
    expect(f.timing.observe({ timestamp: 100, wallTime: 998 }, 1_000_000))
      .toEqual({ epoch: 1, sourceMs: 100_000, deliveryLagMs: 2_000 });
    f.at(20_000);
    expect(f.timing.observe({ timestamp: 109 }, 1_010_000)?.deliveryLagMs).toBe(3_000);
  });

  it("distinguishes a ten-second observer queue from ten seconds of source silence", () => {
    const f = fixture();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    f.at(20_000);
    expect(f.timing.observe({ timestamp: 100.025 }, 1_010_000)?.deliveryLagMs).toBe(9_975);
    expect(f.timing.observe({ timestamp: 110 }, 1_010_000)?.deliveryLagMs).toBe(0);
  });

  it("keeps a shared anchor across reconnects so a delayed replacement handshake is visible", () => {
    const f = fixture();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    f.at(30_000);
    expect(f.timing.observe({ timestamp: 110, wallTime: 1010 }, 1_020_000))
      .toEqual({ epoch: 1, sourceMs: 110_000, deliveryLagMs: 10_000 });
  });

  it.each([-60_000, 60_000])("does not confuse a %ims wall-clock adjustment with delivery lag", (jump) => {
    const f = fixture();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    f.at(11_000);
    expect(f.timing.observe({ timestamp: 101, wallTime: 1001 + jump / 1000 }, 1_001_000 + jump))
      .toEqual({ epoch: 1, sourceMs: 101_000, deliveryLagMs: 0 });
    f.at(12_000);
    expect(f.timing.observe({ timestamp: 102 }, 1_002_000 + jump)?.deliveryLagMs).toBe(0);
  });

  it("reanchors when a new target uses a different monotonic clock", () => {
    const f = fixture();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    f.at(11_000);
    expect(f.timing.observe({ timestamp: 1, wallTime: 1001 }, 1_001_000))
      .toEqual({ epoch: 2, sourceMs: 1_000, deliveryLagMs: 0 });
  });

  it("clear requires a fresh anchor and cannot reuse a prior attachment's clock", () => {
    const f = fixture();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    f.timing.clear();
    expect(f.timing.observe({ timestamp: 101 }, 1_001_000)).toBeNull();
    expect(f.timing.observe({ timestamp: 1, wallTime: 1001 }, 1_001_000)?.epoch).toBe(1);
  });

  it("rejects invalid, distant-future and unbounded timestamps", () => {
    const f = fixture();
    for (const timestamp of [-1, NaN, Infinity, Number.MAX_VALUE, "100"])
      expect(f.timing.observe({ timestamp, wallTime: 1000 }, 1_000_000)).toBeNull();
    expect(f.timing.observe({ timestamp: 100, wallTime: 1010 }, 1_000_000)).toBeNull();
    f.timing.observe({ timestamp: 100, wallTime: 1000 }, 1_000_000);
    expect(f.timing.observe({ timestamp: 102 }, 1_000_000)).toBeNull();
    f.at(700_001);
    expect(f.timing.observe({ timestamp: 100 }, 1_690_001)).toBeNull();
  });
});
