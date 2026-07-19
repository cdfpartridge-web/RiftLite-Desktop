import { describe, expect, it } from "vitest";

import {
  accountMigrationProgress,
  activeDeckSyncConfidence,
  buildAccountSyncChoicePreview,
  cloudAccountSyncSnapshot,
  localAccountSyncSnapshot
} from "../src/shared/accountSyncConfidence.js";
import type {
  AccountCloudSyncStatus,
  AccountConnectionStatus,
  MatchDraft,
  SavedDeck,
  UserSettings
} from "../src/shared/types.js";

const localDeck: SavedDeck = {
  id: "deck-local",
  sourceUrl: "https://piltoverarchive.com/decks/view/local",
  sourceKey: "local",
  title: "Irelia Tempo",
  legend: "Irelia",
  snapshotJson: "{}",
  lastImportedAt: "2026-07-19T09:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function settings(patch: Partial<UserSettings> = {}): UserSettings {
  return {
    activeDeckId: localDeck.id,
    accountCloudSyncEnabled: false,
    accountCloudSyncLastSyncedAt: "",
    accountCloudSyncDeviceName: "Gaming PC",
    ...patch
  } as UserSettings;
}

function cloudStatus(patch: Partial<AccountCloudSyncStatus> = {}): AccountCloudSyncStatus {
  return {
    enabled: false,
    signedIn: true,
    hasRemoteBackup: true,
    lastSyncedAt: "",
    lastRestoredAt: "",
    remoteUpdatedAt: "2026-07-18T20:00:00.000Z",
    remoteDeviceName: "MacBook",
    remoteAppVersion: "0.8.5",
    remoteBytes: 1234,
    remoteCounts: { matches: 18, decks: 4, notebooks: 4, replays: 0 },
    message: "Account cloud backup found.",
    ...patch
  };
}

function match(id: string, deleted = false): MatchDraft {
  return {
    id,
    status: "saved",
    result: "Win",
    ...(deleted ? { deletedAt: "2026-07-19T10:00:00.000Z" } : {})
  } as MatchDraft;
}

describe("account sync confidence", () => {
  it("shows separately counted local and cloud data", () => {
    const local = localAccountSyncSnapshot(
      [match("one"), match("deleted", true)],
      [localDeck],
      settings()
    );
    const cloud = cloudAccountSyncSnapshot(cloudStatus());

    expect(local).toMatchObject({ matches: 1, decks: 1, activeDeckTitle: "Irelia Tempo", deviceName: "Gaming PC" });
    expect(cloud).toMatchObject({ available: true, matches: 18, decks: 4, deviceName: "MacBook" });
  });

  it("requires an explicit two-device direction and previews the data that becomes authoritative", () => {
    const local = localAccountSyncSnapshot([match("local")], [localDeck], settings());
    const cloud = cloudAccountSyncSnapshot(cloudStatus());

    const keepLocal = buildAccountSyncChoicePreview("keep-local", local, cloud);
    const restoreCloud = buildAccountSyncChoicePreview("restore-cloud", local, cloud);

    expect(keepLocal.actionLabel).toBe("Keep local and replace cloud");
    expect(keepLocal.local.matches).toBe(1);
    expect(keepLocal.cloud.matches).toBe(18);
    expect(keepLocal.consequence).toContain("This device becomes the source of truth");

    expect(restoreCloud.actionLabel).toBe("Restore cloud on this device");
    expect(restoreCloud.local.decks).toBe(1);
    expect(restoreCloud.cloud.decks).toBe(4);
    expect(restoreCloud.consequence).toContain("cloud copy becomes the source of truth");
  });

  it("explains whether the active deck is local, waiting for a choice, or included in sync", () => {
    expect(activeDeckSyncConfidence(settings(), [localDeck], null)).toMatchObject({
      title: "Irelia Tempo",
      state: "local-only",
      label: "Local only"
    });
    expect(activeDeckSyncConfidence(settings(), [localDeck], cloudStatus())).toMatchObject({
      state: "choice-required",
      label: "Waiting for data choice"
    });
    expect(activeDeckSyncConfidence(
      settings({ accountCloudSyncEnabled: true, accountCloudSyncLastSyncedAt: "2026-07-19T10:00:00.000Z" }),
      [localDeck],
      cloudStatus({ enabled: true, lastSyncedAt: "2026-07-19T10:00:00.000Z" })
    )).toMatchObject({ state: "synced", label: "Included in device sync" });
  });

  it("turns account migration states into visible four-stage progress", () => {
    const base = {
      connected: true,
      verified: true,
      migrationMessage: "",
      message: ""
    } as AccountConnectionStatus;

    expect(accountMigrationProgress(null, false)).toMatchObject({ current: 0, total: 4, percent: 0 });
    expect(accountMigrationProgress(null, true)).toMatchObject({ current: 1, percent: 25, tone: "working" });
    expect(accountMigrationProgress({ ...base, migrationState: "pending" }, true)).toMatchObject({ current: 3, percent: 75, tone: "working" });
    expect(accountMigrationProgress({ ...base, migrationState: "attention" }, true)).toMatchObject({ current: 3, percent: 75, tone: "warning" });
    expect(accountMigrationProgress({ ...base, migrationState: "ready" }, true)).toMatchObject({ current: 4, percent: 100, tone: "ready" });
  });
});
