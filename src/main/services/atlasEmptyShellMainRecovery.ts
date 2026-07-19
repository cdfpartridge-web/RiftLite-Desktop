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
      status: "scheduled" | "consumed";
      guestId: number;
      navigationKey: string;
      recoveryKey: string;
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
   * Consumes a scheduled recovery and confirms that its original guest and
   * navigation are still current. A mismatch still consumes the app-session
   * budget so a replacement guest cannot turn the fallback into a reload loop.
   */
  commitScheduledReload(recoveryKey: string, guestId: number, navigationKey: string): boolean {
    if (this.attempt.status !== "scheduled" || this.attempt.recoveryKey !== recoveryKey) {
      return false;
    }
    const scheduled = this.attempt;
    this.attempt = { ...scheduled, status: "consumed" };
    const current = this.guestNavigations.get(guestId);
    return scheduled.guestId === guestId &&
      scheduled.navigationKey === navigationKey &&
      current?.navigationKey === navigationKey;
  }

  abandonScheduledReload(recoveryKey: string): void {
    if (this.attempt.status === "scheduled" && this.attempt.recoveryKey === recoveryKey) {
      this.attempt = { ...this.attempt, status: "consumed" };
    }
  }

  markAtlasShellReady(): void {
    this.attempt = { status: "idle" };
  }

  resetAfterExplicitRepair(): void {
    this.attempt = { status: "idle" };
  }

  forgetGuest(guestId: number): void {
    this.guestNavigations.delete(guestId);
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
    return `${url.origin}${url.pathname}`;
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
