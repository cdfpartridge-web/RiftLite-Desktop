export interface AtlasLogRowObservationInput {
  fingerprint: string;
  explicitId?: string;
  instanceHint?: string;
}

export interface AtlasLogRowObservation {
  key: string;
  identity: string;
  fingerprint: string;
  explicitId?: string;
  instanceHint?: string;
  observedAt: string;
}

const MAX_TRACKED_SEQUENCE = 120;
const MAX_TRACKED_IDENTITIES = 600;

/**
 * Gives visible Atlas log rows stable, room-scoped identities even when the
 * page rerenders or trims old DOM rows from the front of its log window.
 */
export class AtlasLogRowObservationTracker {
  private scope = "";
  private generation = 0;
  private nextOccurrence = 1;
  private previous: AtlasLogRowObservation[] = [];
  private readonly byIdentity = new Map<string, AtlasLogRowObservation>();

  reset(): void {
    this.scope = "";
    this.generation += 1;
    this.previous = [];
    this.byIdentity.clear();
  }

  observe(
    scope: string,
    rows: AtlasLogRowObservationInput[],
    clock: () => string
  ): AtlasLogRowObservation[] {
    if (scope !== this.scope) {
      this.reset();
      this.scope = scope;
    }

    const identityScope = `${scope}\u241fgeneration:${this.generation}`;
    const current = rows.slice(-MAX_TRACKED_SEQUENCE);
    const result = new Array<AtlasLogRowObservation | undefined>(current.length);
    const claimed = new Set<string>();
    const previousByHint = new Map(
      this.previous
        .filter((row) => row.instanceHint)
        .map((row) => [row.instanceHint!, row] as const)
    );

    current.forEach((row, index) => {
      if (!row.instanceHint) return;
      const previous = previousByHint.get(row.instanceHint);
      if (!previous || previous.fingerprint !== row.fingerprint || claimed.has(previous.identity)) return;
      result[index] = { ...previous, explicitId: row.explicitId, instanceHint: row.instanceHint };
      claimed.add(previous.identity);
    });

    current.forEach((row, index) => {
      if (result[index] || !row.explicitId) return;
      const identity = explicitIdentity(identityScope, row.explicitId, row.fingerprint);
      const previous = this.byIdentity.get(identity);
      if (!previous || claimed.has(previous.identity)) return;
      result[index] = { ...previous, explicitId: row.explicitId, instanceHint: row.instanceHint };
      claimed.add(previous.identity);
    });

    const previousTokens = this.previous.map(observationToken);
    const currentTokens = current.map(inputToken);
    const overlap = longestSuffixPrefixOverlap(previousTokens, currentTokens);
    const previousStart = this.previous.length - overlap;
    for (let offset = 0; offset < overlap; offset += 1) {
      const currentIndex = offset;
      const previous = this.previous[previousStart + offset];
      const row = current[currentIndex];
      if (result[currentIndex] || claimed.has(previous.identity)) continue;
      result[currentIndex] = { ...previous, explicitId: row.explicitId, instanceHint: row.instanceHint };
      claimed.add(previous.identity);
    }

    current.forEach((row, index) => {
      if (result[index]) return;
      const occurrence = this.nextOccurrence;
      this.nextOccurrence += 1;
      const identity = row.explicitId
        ? explicitIdentity(identityScope, row.explicitId, row.fingerprint)
        : `${identityScope}\u241esemantic:${row.fingerprint}\u241foccurrence:${occurrence}`;
      const observation: AtlasLogRowObservation = {
        key: row.explicitId
          ? `riftlite-log:g${this.generation}:dom:${occurrence}:${row.explicitId}`.slice(0, 180)
          : `riftlite-log:g${this.generation}:semantic:${occurrence}:${row.fingerprint}`.slice(0, 180),
        identity,
        fingerprint: row.fingerprint,
        explicitId: row.explicitId,
        instanceHint: row.instanceHint,
        observedAt: clock()
      };
      result[index] = observation;
      this.byIdentity.set(identity, observation);
      while (this.byIdentity.size > MAX_TRACKED_IDENTITIES) {
        const oldest = this.byIdentity.keys().next().value as string | undefined;
        if (!oldest) break;
        this.byIdentity.delete(oldest);
      }
    });

    const observations = result.filter((row): row is AtlasLogRowObservation => Boolean(row));
    this.previous = observations;
    return observations;
  }
}

function explicitIdentity(scope: string, explicitId: string, fingerprint: string): string {
  return `${scope}\u241edom:${explicitId}\u241ffingerprint:${fingerprint}`;
}

function observationToken(row: AtlasLogRowObservation): string {
  return row.explicitId ? `dom:${row.explicitId}\u241f${row.fingerprint}` : `semantic:${row.fingerprint}`;
}

function inputToken(row: AtlasLogRowObservationInput): string {
  return row.explicitId ? `dom:${row.explicitId}\u241f${row.fingerprint}` : `semantic:${row.fingerprint}`;
}

function longestSuffixPrefixOverlap(previous: string[], current: string[]): number {
  const limit = Math.min(previous.length, current.length);
  for (let length = limit; length > 0; length -= 1) {
    const previousStart = previous.length - length;
    let matches = true;
    for (let offset = 0; offset < length; offset += 1) {
      if (previous[previousStart + offset] !== current[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
}
