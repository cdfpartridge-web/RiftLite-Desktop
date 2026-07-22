import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pack, type Packable } from "peerjs-js-binarypack";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TcgaWebReplayCaptureService,
  type TcgaWebReplayBindingEvent,
  type TcgaWebReplayFinishContext,
  type TcgaWebReplayPreparedCapture
} from "../src/main/services/tcgaWebReplayCaptureService";

const BASE_TIME = Date.parse("2026-07-20T14:00:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-live-"));
  temporaryDirectories.push(directory);
  return directory;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

function at(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function hookEvent(
  documentId: string,
  offsetMs: number,
  kind: "hook-ready" | "hook-resumed" = "hook-ready"
): TcgaWebReplayBindingEvent {
  return {
    kind,
    capturedAt: at(offsetMs),
    documentId,
    payload: {}
  };
}

function playerState(playerId: string, setupStep: number) {
  return {
    setupStep,
    visibleCards: [
      {
        id: `${playerId}-legend`,
        owner: playerId,
        position: { section: "Legend", index: 0 },
        cardData: { id: `${playerId}-LEGEND-CODE`, name: `${playerId} Legend` }
      },
      ...(setupStep > 0 ? [{
        id: `${playerId}-battlefield`,
        owner: playerId,
        position: { section: "Battlefields", index: 0 },
        cardData: { id: `${playerId}-BF-CODE`, name: `${playerId} Battlefield` }
      }] : [])
    ]
  };
}

function channelEvent(
  generation: number,
  captureChannelId: string,
  event: "observed" | "open" | "close",
  offsetMs: number
): TcgaWebReplayBindingEvent {
  return {
    kind: "rtc-channel",
    capturedAt: at(offsetMs),
    documentGeneration: generation,
    payload: {
      event,
      channel: { captureChannelId, label: "game", id: 1 }
    }
  };
}

function dataEvent(
  generation: number,
  captureChannelId: string,
  direction: "in" | "out",
  transportSequence: number,
  offsetMs: number,
  bytes: Uint8Array
): TcgaWebReplayBindingEvent {
  return {
    kind: "rtc-data",
    capturedAt: at(offsetMs),
    documentGeneration: generation,
    payload: {
      transportSequence,
      transportCapturedAt: at(offsetMs),
      direction,
      channel: { captureChannelId, label: "game", id: 1 },
      data: {
        encoding: "base64",
        data: Buffer.from(bytes).toString("base64"),
        byteLength: bytes.byteLength,
        truncated: false
      }
    }
  };
}

interface FinishIdentity extends TcgaWebReplayFinishContext {
  localMatchId: string;
  capturedAt: string;
  completedAt: string;
  match: {
    result: "win" | "loss" | "draw" | "incomplete";
    games: Array<{
      perspectivePoints?: number;
      opponentPoints?: number;
    }>;
  };
}

function finishIdentity(result: FinishIdentity["match"]["result"] = "loss"): FinishIdentity {
  return {
    localMatchId: "local-match-1",
    capturedAt: at(10_000),
    completedAt: at(80_000),
    match: {
      result,
      games: [{ perspectivePoints: 7, opponentPoints: 7 }]
    }
  };
}

function quickDisconnectFinishIdentity(): FinishIdentity {
  return {
    ...finishIdentity(),
    capturedAt: at(1_000),
    completedAt: at(6_000)
  };
}

async function addQuickDisconnect(
  service: TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>,
  generation: number,
  sequenceStart = 1
): Promise<void> {
  const channel = "channel-quick";
  expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "open", 1_000))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "out", sequenceStart, 2_000, await packed({
    type: "PLAYER_DATA",
    gameId: "QUICK-LOCAL",
    payload: { setupStep: 0 }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "in", sequenceStart + 1, 3_000, await packed({
    type: "PLAYER_DATA",
    gameId: "QUICK-OPPONENT",
    payload: { setupStep: 0 }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "out", sequenceStart + 2, 5_000, await packed({
    type: "LEAVING",
    gameId: "QUICK-LOCAL"
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "close", 6_000))).toBe(true);
}

async function addReplayReadyChannel(
  service: TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>,
  generation: number,
  channel: string,
  sequenceStart: number,
  offsetStart: number,
  localId: string
): Promise<void> {
  const opponentId = `${localId}-OPPONENT`;
  expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "open", offsetStart))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "in", sequenceStart, offsetStart + 500, await packed({
    type: "NEWCOMMER_GAMEDATA",
    payload: {
      players: {
        [localId]: playerState(localId, 0),
        [opponentId]: playerState(opponentId, 0)
      },
      general: { turnCount: 1 }
    }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "out", sequenceStart + 1, offsetStart + 1_000, await packed({
    type: "PLAYER_DATA",
    gameId: localId,
    payload: playerState(localId, 1)
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "in", sequenceStart + 2, offsetStart + 2_000, await packed({
    type: "PLAYER_DATA",
    gameId: opponentId,
    payload: playerState(opponentId, 1)
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "out", sequenceStart + 3, offsetStart + 2_500, await packed({
    type: "GAME_DATA",
    gameId: localId,
    payload: {
      playerData: playerState(localId, 4),
      newToHistory: {
        id: `${localId}-mulligan`,
        playerId: localId,
        text: "play.logs.game.mulligan.complete"
      }
    }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "out", sequenceStart + 4, offsetStart + 3_000, await packed({
    type: "GAME_DATA",
    gameId: localId,
    payload: {
      playerData: playerState(localId, 10),
      setupStep: 10,
      turnCount: 13,
      currentPlayer: localId,
      newToHistory: {
        id: `${localId}-draw`,
        playerId: localId,
        text: "play.logs.player.draw"
      },
      privateCard: "SENSITIVE-HIDDEN-CARD"
    }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, dataEvent(generation, channel, "in", sequenceStart + 5, offsetStart + 4_000, await packed({
    type: "GAME_DATA",
    gameId: opponentId,
    payload: {
      playerData: playerState(opponentId, 10),
      turnCount: 13,
      currentPlayer: localId
    }
  })))).toBe(true);
  expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "close", offsetStart + 60_000))).toBe(true);
}

function pauseAwaitingPersistence(
  service: TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>
) {
  const entered = deferred<void>();
  const resume = deferred<void>();
  let pinnedAccountUid = "";
  const internals = service as unknown as {
    persistAwaitingResult: (...args: unknown[]) => Promise<unknown>;
  };
  const original = internals.persistAwaitingResult.bind(service);
  internals.persistAwaitingResult = async (...args: unknown[]) => {
    pinnedAccountUid = typeof args[2] === "string" ? args[2] : "";
    entered.resolve();
    await resume.promise;
    return original(...args);
  };
  return {
    entered: entered.promise,
    resume: () => resume.resolve(),
    pinnedAccountUid: () => pinnedAccountUid
  };
}

describe("TCGA Web Replay capture service", () => {
  it("rejects a quick disconnect even when its channel exactly matches the saved match window", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addQuickDisconnect(service, generation);

    const result = await service.finalize(quickDisconnectFinishIdentity(), { id: "replay-1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "no-replay-ready-candidate",
      consideredCandidates: 1,
      readyCandidates: 0,
      rejectionCounts: {
        "missing-setup-progression": 1,
        "missing-mulligan-evidence": 1,
        "missing-in-game-state": 1,
        "missing-game-history": 1,
        "missing-legend-identities": 1,
        "missing-battlefield-identities": 1
      }
    });
    expect(register).not.toHaveBeenCalled();
    expect(await readdir(directory).catch(() => [])).toEqual([]);
  });

  it("registers the sole complete replay-ready match channel", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async (
      capture: TcgaWebReplayPreparedCapture,
      identity: FinishIdentity,
      replay: { id: string } | undefined
    ) => `${identity.localMatchId}:${replay?.id}:${capture.captureSessionId}`);
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);

    await addQuickDisconnect(service, generation);
    await addReplayReadyChannel(service, generation, "channel-real", 20, 12_000, "REAL-LOCAL");

    const identity = finishIdentity();
    const result = await service.finalize(identity, { id: "replay-1" });

    expect(result.status).toBe("registered");
    if (result.status !== "registered") throw new Error("Expected registration");
    expect(result.capture).toMatchObject({
      platform: "tcga",
      artifactEncoding: "gzip",
      expectedAccountUid: "account-1",
      messageCount: 6,
      frameCount: 6
    });
    expect(result.capture.captureSessionId).toMatch(/^tcga_[a-f0-9]{48}$/);
    expect(register).toHaveBeenCalledWith(result.capture, identity, { id: "replay-1" });

    const compressed = await readFile(result.capture.localPath);
    expect(result.capture.compressedBytes).toBe(compressed.byteLength);
    expect(result.capture.sha256).toBe(createHash("sha256").update(compressed).digest("hex"));
    const raw = JSON.parse(gunzipSync(compressed).toString("utf8")) as Record<string, any>;
    expect(raw).toMatchObject({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {
        identity: { perspectivePlayerId: "REAL-LOCAL" },
        source: { schema: "riftlite-tcga-web-replay", version: 1 },
        match: { result: "loss", perspectivePoints: 7, opponentPoints: 7 }
      },
      transport: { frames: 6, incompleteChunkGroups: 0 }
    });
    expect(raw.messages.map((message: Record<string, any>) => message.parsed.type)).toEqual([
      "NEWCOMMER_GAMEDATA",
      "PLAYER_DATA",
      "PLAYER_DATA",
      "GAME_DATA",
      "GAME_DATA",
      "GAME_DATA"
    ]);
    expect(JSON.stringify(raw)).not.toContain("QUICK-LOCAL");
    expect(JSON.stringify(result)).not.toContain("REAL-LOCAL");
  });

  it("keeps a resolved automatic draft private until the confirmation call", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-await-confirm", 1, 12_000, "LOCAL-CONFIRM");
    const automatic = finishIdentity("win");
    automatic.confirmedResult = false;

    const awaiting = await service.finalize(automatic, { id: "draft-replay" });

    expect(awaiting.status).toBe("awaiting-result");
    expect(register).not.toHaveBeenCalled();

    const confirmed = await service.finalize(finishIdentity("win"), { id: "confirmed-replay" });

    expect(confirmed.status).toBe("registered");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent finalization so one capture is registered only once", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "registered";
    });
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-single-finalize", 1, 12_000, "LOCAL-ONCE");

    const results = await Promise.all([
      service.finalize(finishIdentity("win"), { id: "replay-a" }),
      service.finalize(finishIdentity("win"), { id: "replay-b" })
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["registered", "skipped"]);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("taints an otherwise complete channel when the page hook reports an invalid ingress frame", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-tainted", 1, 12_000, "LOCAL-TAINTED");

    expect(service.ingestBindingEvent(41, {
      kind: "rtc-data",
      capturedAt: at(74_000),
      documentGeneration: generation,
      payload: {
        transportSequence: 99,
        transportCapturedAt: at(74_000),
        direction: "in",
        channel: { captureChannelId: "channel-tainted", label: "game", id: 1 },
        data: {
          encoding: "base64",
          data: "AA==",
          byteLength: 1,
          truncated: true
        }
      }
    })).toBe(false);

    const result = await service.finalize(finishIdentity(), { id: "replay-1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "no-replay-ready-candidate",
      consideredCandidates: 1,
      readyCandidates: 0,
      rejectionCounts: { "invalid-ingress-frame": 1 }
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("emits match points only as a complete validated pair", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-unpaired-score", 1, 12_000, "LOCAL-UNPAIRED");
    const identity = finishIdentity("win");
    identity.match.games[0].opponentPoints = undefined;

    const result = await service.finalize(identity, { id: "replay-1" });

    expect(result.status).toBe("registered");
    if (result.status !== "registered") throw new Error("Expected registration");
    const raw = JSON.parse(gunzipSync(await readFile(result.capture.localPath)).toString("utf8")) as Record<string, any>;
    expect(raw.capture.match).toEqual({ result: "win" });
  });

  it("persists an unconfirmed match without uploading and resolves it after restart", async () => {
    const directory = await temporaryDirectory();
    const firstRegister = vi.fn(async () => "unexpected");
    const firstService = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      firstRegister
    );
    await firstService.setEnabled("account-1", ["hub-b", "hub-a"]);
    const generation = firstService.beginDocument(41);
    await addReplayReadyChannel(firstService, generation, "channel-awaiting", 1, 12_000, "LOCAL-AWAITING");

    const awaiting = await firstService.finalize(finishIdentity("incomplete"), { id: "draft-replay" });

    expect(awaiting.status).toBe("awaiting-result");
    if (awaiting.status !== "awaiting-result") throw new Error("Expected awaiting-result capture");
    expect(firstRegister).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(expect.arrayContaining([
      expect.stringMatching(/\.candidate\.json\.gz$/),
      expect.stringMatching(/\.sidecar\.json$/)
    ]));
    expect((await readdir(directory)).some((name) => name.startsWith("tcga-web-replay-"))).toBe(false);
    const sidecarText = await readFile(awaiting.capture.sidecarPath, "utf8");
    expect(sidecarText).not.toContain("account-1");
    expect(sidecarText).not.toContain("LOCAL-AWAITING");
    expect(sidecarText).not.toContain("SENSITIVE-HIDDEN-CARD");
    const pendingRaw = JSON.parse(gunzipSync(await readFile(awaiting.capture.candidatePath)).toString("utf8"));
    expect(pendingRaw.schema).toBe("riftlite-tcga-awaiting-result-capture");
    expect(pendingRaw.capture.source.schema).toBe("riftlite-tcga-awaiting-result");
    expect(pendingRaw.capture).not.toHaveProperty("match");

    const secondRegister = vi.fn(async (
      capture: TcgaWebReplayPreparedCapture,
      identity: FinishIdentity
    ) => `${identity.match.result}:${capture.captureSessionId}`);
    const restarted = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      secondRegister
    );
    await restarted.setEnabled("account-1", ["hub-a", "hub-new"]);
    const resolvedIdentity = finishIdentity("loss");
    const resolved = await restarted.finalize(resolvedIdentity, { id: "confirmed-replay" });

    expect(resolved.status).toBe("registered");
    if (resolved.status !== "registered") throw new Error("Expected registered capture");
    expect(resolved.capture.discordShareHubIds).toEqual(["hub-a", "hub-b"]);
    expect(secondRegister).toHaveBeenCalledTimes(1);
    expect(secondRegister).toHaveBeenCalledWith(resolved.capture, resolvedIdentity, { id: "confirmed-replay" });
    const productRaw = JSON.parse(gunzipSync(await readFile(resolved.capture.localPath)).toString("utf8"));
    expect(productRaw.capture).toMatchObject({
      captureSessionId: awaiting.capture.captureSessionId,
      source: { schema: "riftlite-tcga-web-replay", version: 1 },
      match: { result: "loss", perspectivePoints: 7, opponentPoints: 7 }
    });
    expect(await readFile(awaiting.capture.sidecarPath).catch(() => null)).toBeNull();
    expect(await readFile(awaiting.capture.candidatePath).catch(() => null)).toBeNull();
  });

  it("fails closed when an awaiting-result payload is tampered with", async () => {
    const directory = await temporaryDirectory();
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-protected", 1, 12_000, "LOCAL-PROTECTED");
    const awaiting = await service.finalize(finishIdentity("incomplete"), { id: "draft" });
    expect(awaiting.status).toBe("awaiting-result");
    if (awaiting.status !== "awaiting-result") throw new Error("Expected awaiting-result capture");

    await writeFile(awaiting.capture.candidatePath, Buffer.from("tampered"));
    const originalAccountRegister = vi.fn(async () => "unexpected");
    const originalAccount = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      originalAccountRegister
    );
    await originalAccount.setEnabled("account-1");
    expect(await originalAccount.finalize(finishIdentity("loss"), { id: "confirmed" })).toMatchObject({
      status: "skipped",
      reason: "invalid-pending-artifact"
    });
    expect(originalAccountRegister).not.toHaveBeenCalled();
  });

  it("purges stale pending pairs from another account after restart without touching the current account", async () => {
    const directory = await temporaryDirectory();
    const accountA = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await accountA.setEnabled("account-1");
    const accountAGeneration = accountA.beginDocument(41);
    await addReplayReadyChannel(accountA, accountAGeneration, "channel-account-a", 1, 12_000, "LOCAL-ACCOUNT-A");
    const accountAAwaiting = await accountA.finalize(finishIdentity("incomplete"), { id: "draft-a" });
    expect(accountAAwaiting.status).toBe("awaiting-result");
    if (accountAAwaiting.status !== "awaiting-result") throw new Error("Expected account A pending capture");
    const [accountACandidate, accountASidecar] = await Promise.all([
      readFile(accountAAwaiting.capture.candidatePath),
      readFile(accountAAwaiting.capture.sidecarPath)
    ]);

    const accountB = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await accountB.configure(directory, "account-2");
    const accountBGeneration = accountB.beginDocument(41);
    await addReplayReadyChannel(accountB, accountBGeneration, "channel-account-b", 20, 12_000, "LOCAL-ACCOUNT-B");
    const accountBAwaiting = await accountB.finalize(finishIdentity("incomplete"), { id: "draft-b" });
    expect(accountBAwaiting.status).toBe("awaiting-result");
    if (accountBAwaiting.status !== "awaiting-result") throw new Error("Expected account B pending capture");

    // Recreate the account A pair to model a crash after the account switch was
    // committed but before the old process finished its queued consent cleanup.
    await Promise.all([
      writeFile(accountAAwaiting.capture.candidatePath, accountACandidate),
      writeFile(accountAAwaiting.capture.sidecarPath, accountASidecar)
    ]);

    const register = vi.fn(async () => "registered-account-b");
    const restartedAsB = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      register
    );
    await restartedAsB.configure(directory, "account-2");

    expect(await readFile(accountAAwaiting.capture.sidecarPath).catch(() => null)).toBeNull();
    expect(await readFile(accountAAwaiting.capture.candidatePath).catch(() => null)).toBeNull();
    expect(await readFile(accountBAwaiting.capture.sidecarPath).catch(() => null)).not.toBeNull();
    expect(await readFile(accountBAwaiting.capture.candidatePath).catch(() => null)).not.toBeNull();
    await expect(restartedAsB.finalize(finishIdentity("win"), { id: "confirmed-b" })).resolves.toMatchObject({
      status: "registered",
      registration: "registered-account-b",
      capture: { captureSessionId: accountBAwaiting.capture.captureSessionId }
    });
    expect(register).toHaveBeenCalledOnce();
  });

  it("purges stale pending pairs when a restarted app has TCGA replay consent disabled", async () => {
    const directory = await temporaryDirectory();
    const firstService = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await firstService.setEnabled("account-1");
    const generation = firstService.beginDocument(41);
    await addReplayReadyChannel(firstService, generation, "channel-disabled-restart", 1, 12_000, "LOCAL-DISABLED");
    expect((await firstService.finalize(finishIdentity("incomplete"), { id: "draft" })).status).toBe("awaiting-result");

    const restartedDisabled = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await restartedDisabled.configure(directory, "");

    expect((await readdir(directory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    await expect(restartedDisabled.finalize(finishIdentity("loss"), { id: "confirmed" })).resolves.toMatchObject({
      status: "skipped",
      reason: "capture-disabled"
    });
  });

  it("migrates pending state when the private replay directory changes", async () => {
    const oldDirectory = await temporaryDirectory();
    const newDirectory = await temporaryDirectory();
    const register = vi.fn()
      .mockRejectedValueOnce(new Error("temporary registration failure"))
      .mockResolvedValue("registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(oldDirectory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-move", 1, 12_000, "LOCAL-MOVE");
    expect((await service.finalize(finishIdentity("incomplete"), { id: "draft" })).status).toBe("awaiting-result");

    expect(await service.setOutputDirectory(newDirectory)).toEqual({ migrated: 1, leftBehind: 0 });
    expect((await readdir(oldDirectory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    await expect(service.finalize(finishIdentity("win"), { id: "first-confirm-attempt" }))
      .rejects.toThrow("temporary registration failure");
    expect((await readdir(newDirectory)).some((name) => name.endsWith(".sidecar.json"))).toBe(true);
    expect((await readdir(newDirectory)).some((name) => name.startsWith("tcga-web-replay-"))).toBe(false);
    const resolved = await service.finalize(finishIdentity("win"), { id: "confirmed" });

    expect(resolved.status).toBe("registered");
    if (resolved.status !== "registered") throw new Error("Expected registered capture");
    expect(resolved.capture.localPath.startsWith(newDirectory)).toBe(true);
    expect((await readdir(newDirectory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("deletes awaiting-result material when TCGA replay consent is withdrawn", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "unexpected");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-withdraw", 1, 12_000, "LOCAL-WITHDRAW");
    expect((await service.finalize(finishIdentity("incomplete"), { id: "draft" })).status).toBe("awaiting-result");

    expect(await service.withdrawConsent()).toBe(2);
    expect((await readdir(directory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    expect(await service.finalize(finishIdentity("loss"), { id: "confirmed" })).toMatchObject({
      status: "skipped",
      reason: "capture-disabled"
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("rejects multi-game saved matches until series attribution is supported", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-series", 1, 12_000, "LOCAL-SERIES");
    const identity = finishIdentity("win");
    identity.match.games.push({ perspectivePoints: 8, opponentPoints: 5 });

    const result = await service.finalize(identity, { id: "replay-1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "unsupported-multi-game-match",
      consideredCandidates: 0,
      readyCandidates: 0
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("fails closed when two replay-ready channels match the same saved match", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-a", 1, 12_000, "LOCAL-A");
    await addReplayReadyChannel(service, generation, "channel-b", 20, 30_000, "LOCAL-B");

    const result = await service.finalize(finishIdentity(), { id: "replay-1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "ambiguous-replay-candidate",
      consideredCandidates: 2,
      readyCandidates: 2
    });
    expect(register).not.toHaveBeenCalled();
    expect(await readdir(directory).catch(() => [])).toEqual([]);
  });

  it("rejects transport defects and a channel without a sole outbound perspective", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-corrupt", 10, 12_000, "LOCAL-CORRUPT");
    expect(service.ingestBindingEvent(41, dataEvent(
      generation,
      "channel-corrupt",
      "in",
      99,
      18_000,
      new Uint8Array([0xd9])
    ))).toBe(true);

    const missingPerspective = "channel-no-perspective";
    expect(service.ingestBindingEvent(41, channelEvent(generation, missingPerspective, "open", 30_000))).toBe(true);
    expect(service.ingestBindingEvent(41, dataEvent(generation, missingPerspective, "in", 110, 31_000, await packed({
      type: "PLAYER_DATA",
      gameId: "INBOUND-ONE",
      payload: { setupStep: 10 }
    })))).toBe(true);
    expect(service.ingestBindingEvent(41, dataEvent(generation, missingPerspective, "in", 111, 32_000, await packed({
      type: "PLAYER_DATA",
      gameId: "INBOUND-TWO",
      payload: { setupStep: 10 }
    })))).toBe(true);
    expect(service.ingestBindingEvent(41, dataEvent(generation, missingPerspective, "in", 112, 33_000, await packed({
      type: "GAME_DATA",
      gameId: "INBOUND-TWO",
      payload: { turnCount: 2 }
    })))).toBe(true);

    const result = await service.finalize(finishIdentity(), { id: "replay-1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "no-replay-ready-candidate",
      consideredCandidates: 2,
      readyCandidates: 0,
      rejectionCounts: {
        "transport-issues": 1,
        "missing-perspective": 1
      }
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("rejects a delayed old-document RTC payload after navigation", async () => {
    const directory = await temporaryDirectory();
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "registered"
    );
    await service.setEnabled("account-1");
    const firstGeneration = service.beginDocument(41, at(0));
    expect(service.ingestBindingEvent(41, hookEvent("document-old", 1))).toBe(true);
    const firstOpen = channelEvent(firstGeneration, "channel-old", "open", 2);
    firstOpen.documentId = "document-old";
    delete firstOpen.documentGeneration;
    expect(service.ingestBindingEvent(41, firstOpen)).toBe(true);

    const secondGeneration = service.beginDocument(41, at(10_000));
    expect(service.ingestBindingEvent(41, hookEvent("document-new", 10_001))).toBe(true);
    const delayedBlob = dataEvent(
      firstGeneration,
      "channel-old",
      "in",
      1,
      10_100,
      await packed({ type: "GAME_DATA", gameId: "OLD", payload: { turnCount: 2 } })
    );
    delayedBlob.documentId = "document-old";
    delete delayedBlob.documentGeneration;
    expect(service.ingestBindingEvent(41, delayedBlob)).toBe(false);

    const newOpen = channelEvent(secondGeneration, "channel-new", "open", 10_200);
    newOpen.documentId = "document-new";
    delete newOpen.documentGeneration;
    expect(service.ingestBindingEvent(41, newOpen)).toBe(true);
  });

  it("keeps a replay-ready rejoin isolated from the prior disconnected document", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const disconnectedGeneration = service.beginDocument(41, at(0));
    await addQuickDisconnect(service, disconnectedGeneration);

    const rejoinedGeneration = service.beginDocument(41, at(10_000));
    await addReplayReadyChannel(service, rejoinedGeneration, "channel-rejoined", 20, 12_000, "LOCAL-REJOINED");
    const result = await service.finalize(finishIdentity("win"), { id: "rejoined-replay" });

    expect(result.status).toBe("registered");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("ages abandoned documents so more than 32 navigations cannot exhaust channel capacity", async () => {
    const directory = await temporaryDirectory();
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "registered"
    );
    await service.setEnabled("account-1");

    for (let index = 0; index < 40; index += 1) {
      const generation = service.beginDocument(41, at(index * 1_000));
      expect(service.ingestBindingEvent(41, channelEvent(
        generation,
        `channel-navigation-${index}`,
        "observed",
        index * 1_000 + 1
      ))).toBe(true);
    }
  });

  it("evicts closed disconnect channels so repeated same-document rejoins cannot exhaust capacity", async () => {
    const directory = await temporaryDirectory();
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "registered"
    );
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);

    for (let index = 0; index < 40; index += 1) {
      const channel = `channel-rejoin-${index}`;
      const offset = index * 1_000;
      expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "open", offset + 1))).toBe(true);
      expect(service.ingestBindingEvent(41, dataEvent(
        generation,
        channel,
        "in",
        index,
        offset + 2,
        new Uint8Array([index % 255 || 1])
      ))).toBe(true);
      expect(service.ingestBindingEvent(41, channelEvent(generation, channel, "close", offset + 3))).toBe(true);
    }
  });

  it("requires a confirmed saved result and keeps old-document events isolated", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const firstGeneration = service.beginDocument(41);
    await addReplayReadyChannel(service, firstGeneration, "channel-1", 1, 12_000, "LOCAL-FIRST");
    const secondGeneration = service.beginDocument(41);

    expect(service.ingestBindingEvent(41, channelEvent(
      firstGeneration,
      "delayed-old-channel",
      "open",
      20_000
    ))).toBe(false);
    await addReplayReadyChannel(service, secondGeneration, "channel-1", 20, 30_000, "LOCAL-SECOND");

    const incomplete = await service.finalize(finishIdentity("incomplete"), { id: "replay-1" });
    expect(incomplete).toMatchObject({ status: "skipped", reason: "ambiguous-replay-candidate" });
    expect(register).not.toHaveBeenCalled();

    const completed = await service.finalize(finishIdentity("win"), { id: "replay-1" });
    expect(completed).toMatchObject({
      status: "skipped",
      reason: "ambiguous-replay-candidate",
      readyCandidates: 2
    });
  });

  it("pins an in-flight awaiting-result capture to its starting account before applying setEnabled", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-account-switch", 1, 12_000, "LOCAL-SWITCH");
    const pause = pauseAwaitingPersistence(service);

    const finalization = service.finalize(finishIdentity("incomplete"), { id: "draft" });
    await pause.entered;
    let switchFinished = false;
    const accountSwitch = service.setEnabled("account-2").then(() => {
      switchFinished = true;
    });
    await Promise.resolve();

    expect(pause.pinnedAccountUid()).toBe("account-1");
    expect(switchFinished).toBe(false);
    expect(service.ingestBindingEvent(41, channelEvent(generation, "late-account-1", "open", 75_000))).toBe(false);

    pause.resume();
    expect(await finalization).toMatchObject({ status: "awaiting-result" });
    await accountSwitch;

    expect((await readdir(directory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    expect(await service.finalize(finishIdentity("loss"), { id: "confirmed" })).toMatchObject({
      status: "skipped",
      reason: "no-match-window-candidate"
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("waits for in-flight finalization before withdrawal purges its pending files", async () => {
    const directory = await temporaryDirectory();
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(
      directory,
      async () => "unexpected"
    );
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-withdraw-race", 1, 12_000, "LOCAL-WITHDRAW-RACE");
    const pause = pauseAwaitingPersistence(service);

    const finalization = service.finalize(finishIdentity("incomplete"), { id: "draft" });
    await pause.entered;
    let withdrawalFinished = false;
    const withdrawal = service.withdrawConsent().then((removed) => {
      withdrawalFinished = true;
      return removed;
    });
    await Promise.resolve();

    expect(withdrawalFinished).toBe(false);
    expect(service.ingestBindingEvent(41, channelEvent(generation, "late-withdrawn", "open", 75_000))).toBe(false);

    pause.resume();
    expect(await finalization).toMatchObject({ status: "awaiting-result" });
    expect(await withdrawal).toBe(2);
    expect((await readdir(directory)).filter((name) => name.startsWith("tcga-awaiting-result-"))).toEqual([]);
    expect(await service.finalize(finishIdentity("loss"), { id: "confirmed" })).toMatchObject({
      status: "skipped",
      reason: "capture-disabled"
    });
  });

  it("serializes configure behind registration without rebinding the prepared capture", async () => {
    const directory = await temporaryDirectory();
    const nextDirectory = await temporaryDirectory();
    const registrationEntered = deferred<TcgaWebReplayPreparedCapture>();
    const resumeRegistration = deferred<void>();
    const register = vi.fn(async (capture: TcgaWebReplayPreparedCapture) => {
      registrationEntered.resolve(capture);
      await resumeRegistration.promise;
      return "registered";
    });
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-configure-race", 1, 12_000, "LOCAL-CONFIGURE");

    const finalization = service.finalize(finishIdentity("win"), { id: "confirmed" });
    const prepared = await registrationEntered.promise;
    let configureFinished = false;
    const configuration = service.configure(nextDirectory, "account-2").then(() => {
      configureFinished = true;
    });
    await Promise.resolve();

    expect(prepared.expectedAccountUid).toBe("account-1");
    expect(configureFinished).toBe(false);
    expect(service.ingestBindingEvent(41, channelEvent(generation, "late-configure", "open", 75_000))).toBe(false);

    resumeRegistration.resolve();
    const result = await finalization;
    expect(result).toMatchObject({
      status: "registered",
      capture: { expectedAccountUid: "account-1" },
      registration: "registered"
    });
    await configuration;

    const nextGeneration = service.beginDocument(42);
    expect(service.ingestChannel({
      webContentsId: 42,
      documentGeneration: nextGeneration,
      captureChannelId: "account-2-channel",
      capturedAt: at(90_000),
      event: "open"
    })).toBe(true);
  });

  it("stops accepting data and discards buffered private state when consent changes", async () => {
    const directory = await temporaryDirectory();
    const register = vi.fn(async () => "registered");
    const service = new TcgaWebReplayCaptureService<FinishIdentity, { id: string }, string>(directory, register);
    await service.setEnabled("account-1");
    const generation = service.beginDocument(41);
    await addReplayReadyChannel(service, generation, "channel-real", 1, 12_000, "LOCAL-ONE");

    await service.setEnabled("account-2");
    const result = await service.finalize(finishIdentity(), { id: "replay-1" });

    expect(result).toMatchObject({ status: "skipped", reason: "no-match-window-candidate" });
    expect(register).not.toHaveBeenCalled();
    await service.setEnabled("");
    expect(service.ingestBindingEvent(41, channelEvent(generation, "new", "open", 40_000))).toBe(false);
  });
});
