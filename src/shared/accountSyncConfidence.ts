import type {
  AccountCloudSyncStatus,
  AccountConnectionStatus,
  MatchDraft,
  SavedDeck,
  UserSettings
} from "./types.js";

export type AccountSyncChoice = "keep-local" | "restore-cloud";

export interface AccountSyncSnapshot {
  available: boolean;
  matches: number;
  decks: number;
  activeDeckTitle: string;
  updatedAt: string;
  deviceName: string;
}

export interface AccountSyncChoicePreview {
  choice: AccountSyncChoice;
  title: string;
  actionLabel: string;
  consequence: string;
  local: AccountSyncSnapshot;
  cloud: AccountSyncSnapshot;
}

export interface ActiveDeckSyncConfidence {
  title: string;
  state: "none" | "local-only" | "choice-required" | "waiting" | "synced";
  label: string;
  detail: string;
}

export interface AccountMigrationProgress {
  current: number;
  total: number;
  percent: number;
  label: string;
  detail: string;
  tone: "neutral" | "working" | "warning" | "ready";
}

export function localAccountSyncSnapshot(
  matches: readonly MatchDraft[],
  decks: readonly SavedDeck[],
  settings: Pick<UserSettings, "activeDeckId" | "accountCloudSyncDeviceName">
): AccountSyncSnapshot {
  const activeDeck = decks.find((deck) => deck.id === settings.activeDeckId);
  return {
    available: true,
    matches: matches.filter((match) => !match.deletedAt).length,
    decks: decks.length,
    activeDeckTitle: activeDeck?.title ?? "",
    updatedAt: "",
    deviceName: settings.accountCloudSyncDeviceName || "This device"
  };
}

export function cloudAccountSyncSnapshot(status: AccountCloudSyncStatus | null): AccountSyncSnapshot {
  return {
    available: Boolean(status?.hasRemoteBackup),
    matches: status?.remoteCounts.matches ?? 0,
    decks: status?.remoteCounts.decks ?? 0,
    // Older manifests do not expose the selected deck. We intentionally avoid
    // guessing from the deck count; the local selection is still backed up.
    activeDeckTitle: "",
    updatedAt: status?.remoteUpdatedAt ?? "",
    deviceName: status?.remoteDeviceName || "Cloud backup"
  };
}

export function buildAccountSyncChoicePreview(
  choice: AccountSyncChoice,
  local: AccountSyncSnapshot,
  cloud: AccountSyncSnapshot
): AccountSyncChoicePreview {
  if (choice === "keep-local") {
    return {
      choice,
      title: "Keep this device's data?",
      actionLabel: "Keep local and replace cloud",
      consequence: "This device's match history, decks, notebooks and settings (including the active-deck selection) will replace the current cloud backup.",
      local,
      cloud
    };
  }
  return {
    choice,
    title: "Restore the cloud backup?",
    actionLabel: "Restore cloud on this device",
    consequence: "The cloud backup will replace local match history, decks, notebooks and settings. Your sign-in and local replay video files stay on this device.",
    local,
    cloud
  };
}

export function activeDeckSyncConfidence(
  settings: Pick<UserSettings, "activeDeckId" | "accountCloudSyncEnabled" | "accountCloudSyncLastSyncedAt">,
  decks: readonly SavedDeck[],
  status: AccountCloudSyncStatus | null
): ActiveDeckSyncConfidence {
  const activeDeck = decks.find((deck) => deck.id === settings.activeDeckId);
  if (!activeDeck) {
    return {
      title: "No active deck",
      state: "none",
      label: "Not selected",
      detail: "Choose an active deck in Deck Library to include that selection in your account backup."
    };
  }
  if (!status?.enabled && status?.hasRemoteBackup) {
    return {
      title: activeDeck.title,
      state: "choice-required",
      label: "Waiting for data choice",
      detail: "Choose whether to keep this device's data or restore the cloud backup before automatic backup can include the active-deck selection."
    };
  }
  if (!(status?.enabled ?? settings.accountCloudSyncEnabled)) {
    return {
      title: activeDeck.title,
      state: "local-only",
      label: "Local only",
      detail: "The active-deck selection is currently stored only on this device."
    };
  }
  if (!status?.hasRemoteBackup || !(status.lastSyncedAt || settings.accountCloudSyncLastSyncedAt)) {
    return {
      title: activeDeck.title,
      state: "waiting",
      label: "Waiting for first backup",
      detail: "Back up now to include this deck and the active-deck selection in the account backup."
    };
  }
  return {
    title: activeDeck.title,
    state: "synced",
    label: "Included in account backup",
    detail: "RiftLite includes both this deck and the active-deck selection in account backups."
  };
}

export function accountMigrationProgress(
  status: AccountConnectionStatus | null,
  accountLinked: boolean
): AccountMigrationProgress {
  const total = 4;
  if (!accountLinked) {
    return {
      current: 0,
      total,
      percent: 0,
      label: "Not started",
      detail: "Sign in to begin linking account history.",
      tone: "neutral"
    };
  }
  if (!status) {
    return {
      current: 1,
      total,
      percent: 25,
      label: "Checking account",
      detail: "RiftLite is checking the website identity for this device.",
      tone: "working"
    };
  }
  if (!status.verified) {
    return {
      current: 1,
      total,
      percent: 25,
      label: "Verification needed",
      detail: status.message || "Reconnect this device to continue.",
      tone: "warning"
    };
  }
  if (status.migrationState === "attention") {
    return {
      current: 3,
      total,
      percent: 75,
      label: "Older data needs attention",
      detail: status.migrationMessage || "Repair older account links to finish migration.",
      tone: "warning"
    };
  }
  if (status.migrationState === "pending") {
    return {
      current: 3,
      total,
      percent: 75,
      label: "Linking older data",
      detail: status.migrationMessage || "The account is ready while older records finish linking.",
      tone: "working"
    };
  }
  return {
    current: total,
    total,
    percent: 100,
    label: "Migration complete",
    detail: "Website identity, desktop history, and account ownership are linked.",
    tone: "ready"
  };
}
