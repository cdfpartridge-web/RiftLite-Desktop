import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const development = process.argv.includes("--development");
const packaged = process.argv.includes("--packaged");
if (development === packaged) {
  throw new Error("Use exactly one of --development or --packaged.");
}

const smokeRoot = await mkdtemp(join(tmpdir(), "riftlite-smoke-"));
const snapshotPath = join(smokeRoot, "artifacts", "home.png");
const readinessPath = `${snapshotPath}.json`;
const smokeEnvironment = { ...process.env };
for (const key of [
  "RIFTLITE_SMOKE_ROOT_PATH",
  "RIFTLITE_SMOKE_USER_DATA_PATH",
  "RIFTLITE_UI_DEV_USER_DATA_PATH",
  "RIFTLITE_UI_SNAPSHOT_PATH",
  "RIFTLITE_UI_SNAPSHOT_TOUR_ACTION",
  "RIFTLITE_UI_SNAPSHOT_VIEW",
  "RIFTLITE_UI_SNAPSHOT_PLATFORM",
  "RIFTLITE_UI_SNAPSHOT_COLLAPSED",
  "RIFTLITE_UI_SNAPSHOT_ATLAS_WAIT_MS",
  "RIFTLITE_OPEN_DEVTOOLS",
  "RIFTLITE_SIM_EVENTS",
  "RIFTLITE_SEND_DEV_USAGE"
]) {
  delete smokeEnvironment[key];
}
Object.assign(smokeEnvironment, {
  NODE_ENV: development ? "development" : "production",
  RIFTLITE_SMOKE_ROOT_PATH: smokeRoot,
  RIFTLITE_UI_SNAPSHOT_PATH: snapshotPath,
  RIFTLITE_UI_SNAPSHOT_TOUR_ACTION: "finish",
  RIFTLITE_UI_SNAPSHOT_VIEW: "home"
});

let viteProcess;
let electronProcess;
let succeeded = false;
try {
  if (development) {
    const viteEntry = join(projectDirectory, "node_modules", "vite", "bin", "vite.js");
    if (!existsSync(viteEntry)) {
      throw new Error(`Vite entry point is missing: ${viteEntry}`);
    }
    viteProcess = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--strictPort"], {
      cwd: projectDirectory,
      env: smokeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    pipeWithPrefix(viteProcess, "vite");
    await waitForHttp("http://127.0.0.1:5173", 30_000, viteProcess, "<title>RiftLite</title>");
    if (viteProcess.exitCode !== null) {
      throw new Error(`The dedicated RiftLite Vite server exited with code ${viteProcess.exitCode}.`);
    }
  }

  const executable = development
    ? require("electron")
    : packagedExecutable();
  if (!existsSync(executable)) {
    throw new Error(`Smoke-test executable is missing: ${executable}`);
  }
  const args = development
    ? [projectDirectory, "--riftlite-smoke-test"]
    : ["--riftlite-smoke-test"];
  electronProcess = spawn(executable, args, {
    cwd: projectDirectory,
    env: smokeEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  pipeWithPrefix(electronProcess, "electron");
  const exit = await waitForExit(electronProcess, 60_000);
  if (exit.code !== 0) {
    throw new Error(`RiftLite smoke process exited with code ${exit.code} and signal ${exit.signal ?? "none"}.`);
  }
  if (!existsSync(snapshotPath) || statSync(snapshotPath).size < 1_000) {
    throw new Error("RiftLite smoke test did not create a valid UI snapshot.");
  }
  if (!existsSync(readinessPath)) {
    throw new Error("RiftLite smoke test did not create its renderer-readiness result.");
  }
  const readiness = JSON.parse(readFileSync(readinessPath, "utf8"));
  if (readiness?.version !== 1 || readiness?.rendererReady !== true || readiness?.bridgeAvailable !== true) {
    throw new Error(`RiftLite renderer-readiness result is invalid: ${JSON.stringify(readiness)}`);
  }

  const startupLogPath = join(smokeRoot, "UserData", "riftlite-startup.log");
  if (!existsSync(startupLogPath)) {
    throw new Error("RiftLite smoke test did not create its isolated startup log.");
  }
  const startupLog = readFileSync(startupLogPath, "utf8");
  if (!startupLog.includes("startup complete")) {
    throw new Error("RiftLite smoke startup did not reach completion.");
  }
  if (/fatal startup failure|unhandled rejection|uncaught exception|renderer did-fail-load|renderer process gone|app preload error|child process gone/i.test(startupLog)) {
    throw new Error("RiftLite smoke startup log contains a fatal error.");
  }
  if (/UI snapshot failed|Renderer readiness check failed/i.test(startupLog)) {
    throw new Error("RiftLite smoke startup log contains a renderer failure.");
  }

  succeeded = true;
  console.log(`RiftLite ${development ? "development" : "packaged"} smoke passed.`);
} finally {
  stopProcess(electronProcess);
  stopProcess(viteProcess);
  if (succeeded && dirname(smokeRoot) === resolve(tmpdir()) && basename(smokeRoot).startsWith("riftlite-smoke-")) {
    await rm(smokeRoot, { recursive: true, force: true });
  } else if (!succeeded) {
    console.error(`Failed smoke artifacts were preserved at ${smokeRoot}`);
  }
}

function packagedExecutable() {
  if (process.platform === "win32") {
    return join(projectDirectory, "release", "win-unpacked", "RiftLite Beta 0.9.exe");
  }
  if (process.platform === "darwin") {
    const archDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
    return join(projectDirectory, "release", archDirectory, "RiftLite Beta 0.9.app", "Contents", "MacOS", "RiftLite Beta 0.9");
  }
  throw new Error(`Packaged smoke is not configured for ${process.platform}.`);
}

function pipeWithPrefix(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

async function waitForHttp(url, timeoutMs, child, expectedMarker) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The dedicated RiftLite Vite server exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes(expectedMarker)) return;
    } catch {
      // Vite has not opened its listener yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      stopProcess(child);
      rejectExit(new Error(`RiftLite smoke process exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

function stopProcess(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
}
