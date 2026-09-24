import { describe, expect, it } from "vitest";
import {
  embeddedWebviewPolicy,
  isAllowedEmbeddedNavigation,
  isAllowedEmbeddedPermission,
  RIFTLITE_OPENING_LAB_URL,
  RIFTLITE_TRAINING_WEBVIEW_PARTITION,
} from "../src/shared/embeddedContentSecurity.js";

describe("desktop opening training isolation", () => {
  it("accepts only the dedicated training origin, path and partition", () => {
    const policy = embeddedWebviewPolicy(
      RIFTLITE_OPENING_LAB_URL,
      RIFTLITE_TRAINING_WEBVIEW_PARTITION,
    )!;
    expect(policy).toEqual({
      kind: "training",
      origin: "https://www.riftlite.com",
    });
    for (const url of [
      "https://evil.example/app/opening-lab",
      "https://www.riftlite.com/replays",
      "https://www.riftlite.com/app/opening-lab/other",
      "http://www.riftlite.com/app/opening-lab",
      "https://user@www.riftlite.com/app/opening-lab",
    ])
      expect(isAllowedEmbeddedNavigation(policy, url)).toBe(false);
    expect(
      embeddedWebviewPolicy(
        RIFTLITE_OPENING_LAB_URL,
        "persist:riftlite-replay",
      ),
    ).toBeNull();
  });
  it("permits only the fixed loopback preview in development and pins navigation to that origin", () => {
    const url = "http://127.0.0.1:4201/app/opening-lab";
    expect(
      embeddedWebviewPolicy(url, RIFTLITE_TRAINING_WEBVIEW_PARTITION),
    ).toBeNull();
    const policy = embeddedWebviewPolicy(
      url,
      RIFTLITE_TRAINING_WEBVIEW_PARTITION,
      true,
    )!;
    expect(policy.kind).toBe("training");
    expect(isAllowedEmbeddedNavigation(policy, url)).toBe(true);
    expect(isAllowedEmbeddedNavigation(policy, RIFTLITE_OPENING_LAB_URL)).toBe(
      false,
    );
    expect(
      embeddedWebviewPolicy(
        url.replace("4201", "5174"),
        RIFTLITE_TRAINING_WEBVIEW_PARTITION,
        true,
      ),
    ).toBeNull();
  });
  it("does not grant capture, clipboard or media permissions", () => {
    const policy = embeddedWebviewPolicy(
      RIFTLITE_OPENING_LAB_URL,
      RIFTLITE_TRAINING_WEBVIEW_PARTITION,
    )!;
    for (const permission of [
      "media",
      "display-capture",
      "clipboard-sanitized-write",
    ])
      expect(
        isAllowedEmbeddedPermission(
          policy,
          RIFTLITE_OPENING_LAB_URL,
          permission,
          new Set([permission]),
        ),
      ).toBe(false);
  });
});
