import { isAbsolute, join, parse, relative, resolve } from "node:path";

export type RiftLiteSmokePaths = {
  root: string;
  userData: string;
  documents: string;
  downloads: string;
  pictures: string;
  videos: string;
  temp: string;
  crashDumps: string;
  snapshotPath: string;
};

const SMOKE_ROOT_VARIABLES = [
  "RIFTLITE_SMOKE_ROOT_PATH",
  "RIFTLITE_SMOKE_USER_DATA_PATH",
  "RIFTLITE_UI_DEV_USER_DATA_PATH"
] as const;

/**
 * Resolves every writable Electron path used by an automated smoke run beneath
 * one explicit root. Smoke mode deliberately fails closed: silently falling
 * back to the normal RiftLite profile could upload replays or mutate user data.
 */
export function resolveRiftLiteSmokePaths(
  enabled: boolean,
  environment: NodeJS.ProcessEnv
): RiftLiteSmokePaths | null {
  if (!enabled) {
    return null;
  }

  const configuredRoot = SMOKE_ROOT_VARIABLES
    .map((name) => environment[name]?.trim() ?? "")
    .find(Boolean) ?? "";
  if (!configuredRoot) {
    throw new Error(
      "--riftlite-smoke-test requires an explicit absolute RIFTLITE_SMOKE_ROOT_PATH."
    );
  }
  if (!isAbsolute(configuredRoot)) {
    throw new Error("The RiftLite smoke root must be an absolute path.");
  }

  const root = resolve(configuredRoot);
  if (root === parse(root).root) {
    throw new Error("The RiftLite smoke root cannot be a filesystem root.");
  }

  const configuredSnapshot = environment.RIFTLITE_UI_SNAPSHOT_PATH?.trim() ?? "";
  if (configuredSnapshot && !isAbsolute(configuredSnapshot)) {
    throw new Error("RIFTLITE_UI_SNAPSHOT_PATH must be absolute in smoke mode.");
  }
  const snapshotPath = configuredSnapshot ? resolve(configuredSnapshot) : "";
  if (snapshotPath && !pathIsInside(root, snapshotPath)) {
    throw new Error("RIFTLITE_UI_SNAPSHOT_PATH must stay inside the RiftLite smoke root.");
  }

  return {
    root,
    userData: join(root, "UserData"),
    documents: join(root, "Documents"),
    downloads: join(root, "Downloads"),
    pictures: join(root, "Pictures"),
    videos: join(root, "Videos"),
    temp: join(root, "Temp"),
    crashDumps: join(root, "CrashDumps"),
    snapshotPath
  };
}

/** Allows only renderer resources that cannot leave the machine in smoke mode. */
export function riftLiteSmokeNetworkRequestAllowed(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (["file:", "data:", "blob:", "about:", "devtools:", "chrome-extension:"].includes(parsed.protocol)) {
      return true;
    }
    return ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

function pathIsInside(root: string, candidate: string): boolean {
  const childPath = relative(root, candidate);
  return childPath !== "" && childPath !== ".." && !childPath.startsWith(`..\\`) && !childPath.startsWith("../") && !isAbsolute(childPath);
}
