import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createSingleUseDisplayMediaResponder,
  displayMediaRequestIsTrusted,
  isTrustedRiftLiteAppOrigin,
  preparedDisplayMediaTargetForRequester,
  type DisplayMediaRequestEvidence,
  type ReplayVideoDisplayTarget
} from "../src/main/services/displayMediaRequest";

describe("display-media response settlement", () => {
  it("uses Electron's native null denial and settles the callback once", () => {
    const received: Array<Electron.Streams | null> = [];
    const callback = (streams: Electron.Streams) => {
      received.push(streams);
    };
    const respond = createSingleUseDisplayMediaResponder(callback);

    expect(respond(null)).toBe(true);
    expect(respond({ video: {} as Electron.WebFrameMain })).toBe(false);
    expect(received).toEqual([null]);
  });

  it("contains a callback exception without retrying a consumed one-shot callback", () => {
    const callback = vi.fn((_streams: Electron.Streams) => {
      throw new TypeError("callback rejected response");
    });
    const onError = vi.fn();
    const respond = createSingleUseDisplayMediaResponder(callback, onError);

    expect(() => respond(null)).not.toThrow();
    expect(respond(null)).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });
});

describe("display-media requester policy", () => {
  it("accepts packaged file origins and only the two local development origins", () => {
    expect(isTrustedRiftLiteAppOrigin("file://", false)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("file:///", false)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("file:///C:/Program%20Files/RiftLite/index.html", false)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("file://localhost/C:/RiftLite/index.html", false)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("file://server/share/index.html", false)).toBe(false);
    expect(isTrustedRiftLiteAppOrigin("http://127.0.0.1:5173", true)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("http://localhost:5173", true)).toBe(true);
    expect(isTrustedRiftLiteAppOrigin("http://127.0.0.1:5173", false)).toBe(false);
    expect(isTrustedRiftLiteAppOrigin("https://www.riftlite.com", true)).toBe(false);
    expect(isTrustedRiftLiteAppOrigin("null", true)).toBe(false);
  });

  it("fails closed unless requester, top frame, origin, and media shape all match", () => {
    const valid: DisplayMediaRequestEvidence = {
      requesterWebContentsId: 41,
      trustedAppWebContentsIds: [41, 42],
      requesterIsTrustedApp: true,
      requesterIsMainFrame: true,
      originIsTrusted: true,
      videoRequested: true,
      audioRequested: false
    };
    expect(displayMediaRequestIsTrusted(valid)).toBe(true);

    const rejected: DisplayMediaRequestEvidence[] = [
      { ...valid, requesterWebContentsId: null },
      { ...valid, requesterWebContentsId: 99 },
      { ...valid, requesterIsTrustedApp: false },
      { ...valid, requesterIsMainFrame: false },
      { ...valid, originIsTrusted: false },
      { ...valid, videoRequested: false },
      { ...valid, audioRequested: true }
    ];
    for (const evidence of rejected) {
      expect(displayMediaRequestIsTrusted(evidence)).toBe(false);
    }
  });

  it("binds a prepared target to the trusted IPC sender and expiry window", () => {
    const target: ReplayVideoDisplayTarget = {
      platform: "atlas",
      mode: "game-frame",
      expiresAt: 10_000,
      requesterWebContentsId: 41
    };

    expect(preparedDisplayMediaTargetForRequester(target, 41, 9_999)).toBe(target);
    expect(preparedDisplayMediaTargetForRequester(target, 42, 9_999)).toBeNull();
    expect(preparedDisplayMediaTargetForRequester(target, 41, 10_000)).toBeNull();
    expect(preparedDisplayMediaTargetForRequester(null, 41, 9_999)).toBeNull();
  });
});

describe("display-media main-process integration", () => {
  const mainSource = readFileSync(join(process.cwd(), "src", "main", "main.ts"), "utf8");

  it("never denies a requested video with an invalid empty Streams object", () => {
    expect(mainSource).not.toContain("callback({})");
    expect(mainSource).toContain("createSingleUseDisplayMediaResponder(callback");
  });

  it("resolves the native requesting frame and binds targets to the IPC sender", () => {
    expect(mainSource).toContain("electronWebContents.fromFrame(request.frame)");
    expect(mainSource).toContain("trustedAppWebContentsIds: knownAppContents.map");
    expect(mainSource).toContain("preparedDisplayMediaTargetForRequester(");
    expect(mainSource).toContain("prepareReplayVideoDisplayTarget(event.sender.id, platform, mode)");
  });

  it("settles each display-media handler once after response resolution", () => {
    const defaultHandler = mainSource.match(
      /electronSession\.defaultSession\.setDisplayMediaRequestHandler\([\s\S]*?\}, \{ useSystemPicker: false \}\);/
    )?.[0] ?? "";
    const replayHandler = mainSource.match(
      /replaySession\.setDisplayMediaRequestHandler\([\s\S]*?\n  \}\);/
    )?.[0] ?? "";

    expect(defaultHandler).not.toBe("");
    expect(replayHandler).not.toBe("");
    expect(defaultHandler.match(/\brespond\(/g)).toHaveLength(1);
    expect(replayHandler.match(/\brespond\(/g)).toHaveLength(1);
  });
});
