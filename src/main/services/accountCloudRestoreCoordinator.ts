export interface AccountCloudRestoreDeckTracker {
  invalidateDeckLibrary(): void;
  prepareForRestore?(): Promise<void> | void;
  refreshAfterRestore?(): Promise<void> | void;
  finishRestore?(): Promise<void> | void;
}

/**
 * Account restore replaces the deck tables beneath long-lived main-process
 * services. Invalidate deck-dependent state only after the restore commits.
 */
export async function runAccountCloudRestore<T>(
  restore: () => Promise<T>,
  deckTracker: AccountCloudRestoreDeckTracker
): Promise<T> {
  try {
    await deckTracker.prepareForRestore?.();
    const result = await restore();
    deckTracker.invalidateDeckLibrary();
    await deckTracker.refreshAfterRestore?.();
    return result;
  } finally {
    await deckTracker.finishRestore?.();
  }
}
