export type AtlasEmptyShellRecoveryIgnoreReason =
  | "active-match"
  | "already-consumed"
  | "not-atlas";

export type AtlasEmptyShellRecoveryDecision =
  | {
      action: "schedule-reload";
      navigationKey: string;
      recoveryKey: string;
    }
  | {
      action: "ignore";
      navigationKey: string;
      reason: AtlasEmptyShellRecoveryIgnoreReason;
    };

interface GuestNavigationState {
  generation: number;
  navigationKey: string;
  url: string;
}

type RecoveryAttemptState =
  | { status: "idle" }
  | {
      status: "scheduled";
      guestId: number;
      navigationKey: string;
      recoveryKey: string;
    }
  | {
      status: "consumed";
      recoveryKey: string;
      targetGuestId?: number;
      targetNavigationKey?: string;
      bindNextAtlasNavigation: boolean;
    };

/**
 * Owns the main-process Atlas recovery budget for one RiftLite app session.
 *
 * Guest/navigation keys prevent a delayed reload from targeting a replacement
 * webview. The separate app-session attempt state intentionally survives guest
 * destruction and navigation so a renderer remount cannot start a reload loop.
 */
export class AtlasEmptyShellMainRecoveryGuard {
  private readonly guestNavigations = new Map<number, GuestNavigationState>();
  private attempt: RecoveryAttemptState = { status: "idle" };
  private nextRecoveryId = 0;

  beginNavigation(guestId: number, url: string): string {
    const previous = this.guestNavigations.get(guestId);
    const generation = (previous?.generation ?? 0) + 1;
    const navigationKey = `${guestId}:${generation}`;
    this.guestNavigations.set(guestId, {
      generation,
      navigationKey,
      url: normalizeNavigationUrl(url)
    });
    if (this.attempt.status === "consumed") {
      const followsBoundRepair = this.attempt.targetGuestId === guestId && Boolean(this.attempt.targetNavigationKey);
      const startsRepair = hasAtlasRepairToken(url);
      if (isAtlasUrl(url) && (followsBoundRepair || startsRepair || this.attempt.bindNextAtlasNavigation)) {
        this.attempt = {
          ...this.attempt,
          targetGuestId: guestId,
          targetNavigationKey: navigationKey,
          bindNextAtlasNavigation: false
        };
      }
    }
    return navigationKey;
  }

  considerEmptyShell(guestId: number, url: string, activeAtlasMatch: boolean): AtlasEmptyShellRecoveryDecision {
    const navigation = this.currentNavigation(guestId, url);
    if (!isAtlasUrl(url)) {
      return { action: "ignore", navigationKey: navigation.navigationKey, reason: "not-atlas" };
    }
    if (activeAtlasMatch) {
      return { action: "ignore", navigationKey: navigation.navigationKey, reason: "active-match" };
    }
    if (this.attempt.status !== "idle") {
      return { action: "ignore", navigationKey: navigation.navigationKey, reason: "already-consumed" };
    }

    const recoveryKey = `atlas-empty-shell:${++this.nextRecoveryId}`;
    this.attempt = {
      status: "scheduled",
      guestId,
      navigationKey: navigation.navigationKey,
      recoveryKey
    };
    return {
      action: "schedule-reload",
      navigationKey: navigation.navigationKey,
      recoveryKey
    };
  }

  /**
   * Confirms that the scheduled guest and navigation are still current, then
   * consumes the app-session recovery budget. A cancelled delay never started
   * a repair, so it must not prevent a later genuine blank shell from healing.
   */
  commitScheduledReload(recoveryKey: string, guestId: number, navigationKey: string): boolean {
    if (this.attempt.status !== "scheduled" || this.attempt.recoveryKey !== recoveryKey) {
      return false;
    }
    const scheduled = this.attempt;
    const current = this.guestNavigations.get(guestId);
    const canCommit = scheduled.guestId === guestId &&
      scheduled.navigationKey === navigationKey &&
      current?.navigationKey === navigationKey;
    if (!canCommit) {
      this.attempt = { status: "idle" };
      return false;
    }
    this.attempt = {
      status: "consumed",
      recoveryKey,
      targetGuestId: guestId,
      targetNavigationKey: navigationKey,
      bindNextAtlasNavigation: false
    };
    return true;
  }

  abandonScheduledReload(recoveryKey: string): void {
    if (this.attempt.status === "scheduled" && this.attempt.recoveryKey === recoveryKey) {
      this.attempt = { status: "idle" };
    }
  }

  isCurrentNavigation(guestId: number, url: string): boolean {
    const current = this.guestNavigations.get(guestId);
    return Boolean(current && isAtlasUrl(url) && current.url === normalizeNavigationUrl(url));
  }

  canFinishCommittedReload(recoveryKey: string, guestId: number, navigationKey: string): boolean {
    const current = this.guestNavigations.get(guestId);
    return this.attempt.status === "consumed" &&
      this.attempt.recoveryKey === recoveryKey &&
      this.attempt.targetGuestId === guestId &&
      this.attempt.targetNavigationKey === navigationKey &&
      current?.navigationKey === navigationKey;
  }

  /**
   * Cancels a pending reload once the current Atlas document is usable. A
   * repair that already ran is only refunded when the lobby itself proves its
   * launch controls are present. Authentication pages are healthy documents,
   * but accepting them as a repaired lobby would let an OAuth redirect reopen
   * the recovery budget before the original failure was actually fixed.
   */
  markAtlasShellReady(guestId: number, url: string, provesLobbyReady = false): boolean {
    const current = this.guestNavigations.get(guestId);
    if (!current || !this.isCurrentNavigation(guestId, url)) {
      return false;
    }
    if (this.attempt.status === "scheduled") {
      this.attempt = { status: "idle" };
      return true;
    }
    if (
      this.attempt.status === "consumed" &&
      provesLobbyReady &&
      this.attempt.targetGuestId === guestId &&
      this.attempt.targetNavigationKey === current.navigationKey
    ) {
      this.attempt = { status: "idle" };
      return true;
    }
    return false;
  }

  markExplicitRepairConsumed(): void {
    const recoveryKey = `atlas-explicit-repair:${++this.nextRecoveryId}`;
    this.attempt = {
      status: "consumed",
      recoveryKey,
      bindNextAtlasNavigation: false
    };
  }

  forgetGuest(guestId: number): void {
    this.guestNavigations.delete(guestId);
    if (this.attempt.status === "scheduled" && this.attempt.guestId === guestId) {
      this.attempt = { status: "idle" };
      return;
    }
    if (this.attempt.status === "consumed" && this.attempt.targetGuestId === guestId) {
      this.attempt = {
        ...this.attempt,
        targetGuestId: undefined,
        targetNavigationKey: undefined,
        bindNextAtlasNavigation: true
      };
    }
  }

  private currentNavigation(guestId: number, url: string): GuestNavigationState {
    const current = this.guestNavigations.get(guestId);
    if (current?.url === normalizeNavigationUrl(url)) {
      return current;
    }
    this.beginNavigation(guestId, url);
    return this.guestNavigations.get(guestId)!;
  }
}

function normalizeNavigationUrl(value: string): string {
  try {
    const url = new URL(value);
    const repairToken = url.searchParams.get("riftlite_repair");
    return `${url.origin}${url.pathname}${repairToken === null ? "" : `?riftlite_repair=${repairToken}`}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function isAtlasUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === "play.riftatlas.com";
  } catch {
    return false;
  }
}

function hasAtlasRepairToken(value: string): boolean {
  try {
    const url = new URL(value);
    return isAtlasUrl(value) && url.searchParams.has("riftlite_repair");
  } catch {
    return false;
  }
}
