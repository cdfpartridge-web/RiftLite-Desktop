export interface AccountCloudRestoreDeckTracker {
  invalidateDeckLibrary(): void;
}

/**
 * Account restore replaces the deck tables beneath long-lived main-process
 * services. Invalidate deck-dependent state only after the restore commits.
 */
export async function runAccountCloudRestore<T>(
  restore: () => Promise<T>,
  deckTracker: AccountCloudRestoreDeckTracker
): Promise<T> {
  const result = await restore();
  deckTracker.invalidateDeckLibrary();
  return result;
}
