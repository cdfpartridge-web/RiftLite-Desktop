import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveRiftLiteSmokePaths,
  riftLiteSmokeNetworkRequestAllowed
} from "../src/main/services/smokeIsolation.js";

describe("packaged smoke isolation", () => {
  const root = resolve("C:/riftlite-test/smoke-run");

  it("ignores smoke-only environment paths outside smoke mode", () => {
    expect(resolveRiftLiteSmokePaths(false, {
      RIFTLITE_SMOKE_ROOT_PATH: root,
      RIFTLITE_UI_SNAPSHOT_PATH: join(root, "snapshot.png")
    })).toBeNull();
  });

  it("fails closed when the smoke root is absent or relative", () => {
    expect(() => resolveRiftLiteSmokePaths(true, {})).toThrow(/requires an explicit absolute/i);
    expect(() => resolveRiftLiteSmokePaths(true, {
      RIFTLITE_SMOKE_ROOT_PATH: "relative-smoke"
    })).toThrow(/absolute path/i);
  });

  it("redirects all writable Electron paths below the explicit root", () => {
    const paths = resolveRiftLiteSmokePaths(true, {
      RIFTLITE_SMOKE_ROOT_PATH: root,
      RIFTLITE_UI_SNAPSHOT_PATH: join(root, "artifacts", "snapshot.png")
    });

    expect(paths).toMatchObject({
      root,
      userData: join(root, "UserData"),
      documents: join(root, "Documents"),
      pictures: join(root, "Pictures"),
      temp: join(root, "Temp"),
      snapshotPath: join(root, "artifacts", "snapshot.png")
    });
    for (const path of Object.values(paths ?? {}).filter(Boolean)) {
      expect(path.startsWith(root)).toBe(true);
    }
  });

  it("rejects snapshots that escape the smoke root", () => {
    expect(() => resolveRiftLiteSmokePaths(true, {
      RIFTLITE_SMOKE_ROOT_PATH: root,
      RIFTLITE_UI_SNAPSHOT_PATH: resolve("C:/riftlite-test/outside.png")
    })).toThrow(/must stay inside/i);
  });

  it("supports the legacy explicit smoke path without allowing a fallback", () => {
    expect(resolveRiftLiteSmokePaths(true, {
      RIFTLITE_SMOKE_USER_DATA_PATH: root
    })?.root).toBe(root);
  });

  it("allows only local or non-network renderer resources", () => {
    for (const url of [
      "http://127.0.0.1:5173/src/renderer/App.tsx",
      "ws://localhost:5173/?token=test",
      "file:///C:/RiftLite/dist/index.html",
      "data:image/png;base64,AA==",
      "blob:http://127.0.0.1:5173/id"
    ]) {
      expect(riftLiteSmokeNetworkRequestAllowed(url)).toBe(true);
    }
    for (const url of [
      "https://www.riftlite.com/api/app/home",
      "https://img.youtube.com/video.jpg",
      "wss://remote.example/socket",
      "not a url"
    ]) {
      expect(riftLiteSmokeNetworkRequestAllowed(url)).toBe(false);
    }
  });
});
