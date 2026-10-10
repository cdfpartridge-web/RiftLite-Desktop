import { describe, expect, it } from "vitest";
import { ReplayMp4VideoTimeline } from "../src/main/services/replayMp4VideoTimeline.js";

function read(lines: string[]): number {
  const timeline = new ReplayMp4VideoTimeline();
  for (const line of lines) timeline.consumeLine(line);
  return timeline.durationMs;
}

describe("MP4 presentation timeline", () => {
  it("counts the displayed end of reordered frames rather than the final DTS or PTS", () => {
    expect(read([
      "#tb 0: 1/24",
      "0, -2, 0, 1, 700, 0x1234",
      "0, -1, 4, 1, 70, 0x1234",
      "0, 0, 2, 1, 70, 0x1234",
      "0, 1, 1, 1, 70, 0x1234",
      "0, 2, 3, 1, 70, 0x1234"
    ])).toBe(208);
  });

  it("includes the final packet duration at fractional frame rates", () => {
    expect(read(["#tb 0: 1001/24000", "0, 0, 0, 1, 12, 0x0", "0, 23, 23, 1, 12, 0x0"]))
      .toBe(1001);
  });

  it.each([10_000, -10_000])("normalizes a %s-tick origin without shortening the presentation span", (origin) => {
    expect(read(["#tb 0: 1/1000", `0, 0, ${origin}, 40, 12, 0x0`, `0, 0, ${origin + 4_960}, 40, 12, 0x0`]))
      .toBe(5000);
  });

  it("preserves variable frame intervals and ignores unrelated streams and progress", () => {
    expect(read([
      "#tb 0: 1/1000", "#media_type 0: video", "#dimensions 0: 1920x1080",
      "0, 0, 0, 40, 12, 0x0", "0, 40, 40, 100, 12, 0x0", "0, 140, 140, 60, 12, 0x0, F=0x0",
      "1, 0, 5000, 40, 12, 0x0", "out_time=00:00:50.000000", "progress=end"
    ])).toBe(200);
  });

  it.each([
    [],
    ["#tb 0: 1/24"],
    ["0, 0, 0, 1, 12, 0x0"],
    ["#tb 0: 1/0", "0, 0, 0, 1, 12, 0x0"],
    ["#tb 0: 0/24", "0, 0, 0, 1, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, 0, 0, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, 0, -1, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, NOPTS, 1, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, -9223372036854775808, 1, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, , 1, 12, 0x0"],
    ["#tb 0: 1/24", "0, 0, 0, 1, 12, 0x0", "#tb 0: 1/1000"],
    ["#tb 0: 1/24", "0, 0, 0, 1, 12, 0x0", "0, 1, 1, 0, 12, 0x0"]
  ])("fails closed for missing or invalid packet timing (%j)", (...lines) => {
    expect(read(lines as string[])).toBe(0);
  });
});
