export interface AtlasPlayerIdentityCandidate {
  name: string;
  side?: "me" | "opponent" | "unknown" | string;
  source?: string;
  score?: number;
  top?: number;
  left?: number;
}

export function atlasPlayerIdentitySourceRank(source: string): number {
  const normalized = source.trim().toLowerCase();
  if (normalized === "data-opponent-name") return 70;
  if (/^data-(?:player-name|username|user-name)$/.test(normalized)) return 65;
  if (normalized === "identity-dom") return 60;
  if (normalized === "presence-dom") return 55;
  if (normalized === "opponent-dom") return 45;
  if (normalized === "player-dom") return 40;
  if (normalized === "aria-label") return 15;
  if (normalized === "title" || normalized === "data-name") return 10;
  return 0;
}

export function compareAtlasPlayerIdentityCandidates(
  left: AtlasPlayerIdentityCandidate,
  right: AtlasPlayerIdentityCandidate
): number {
  const sourceDifference = atlasPlayerIdentitySourceRank(right.source ?? "") -
    atlasPlayerIdentitySourceRank(left.source ?? "");
  if (sourceDifference) return sourceDifference;

  const scoreDifference = finiteScore(right.score) - finiteScore(left.score);
  if (scoreDifference) return scoreDifference;

  const topDifference = finitePosition(left.top) - finitePosition(right.top);
  if (topDifference) return topDifference;

  const leftDifference = finitePosition(left.left) - finitePosition(right.left);
  if (leftDifference) return leftDifference;

  return normalizeAtlasPlayerIdentityName(left.name)
    .localeCompare(normalizeAtlasPlayerIdentityName(right.name));
}

export function chooseAtlasOpponentIdentityName<T extends AtlasPlayerIdentityCandidate>(
  candidates: T[],
  localName: string,
  excludedNames: string[] = []
): string {
  const localKey = normalizeAtlasPlayerIdentityName(localName);
  const excludedKeys = new Set(excludedNames.map(normalizeAtlasPlayerIdentityName).filter(Boolean));
  const usable = candidates
    .filter((candidate) => {
      const key = normalizeAtlasPlayerIdentityName(candidate.name);
      return key &&
        key !== localKey &&
        !excludedKeys.has(key) &&
        finiteScore(candidate.score) >= 3 &&
        !isAtlasPlayerIdentityUiControlCandidate(candidate);
    })
    .sort(compareAtlasPlayerIdentityCandidates);
  return usable.find((candidate) => candidate.side === "opponent")?.name ??
    (usable.length === 1 ? usable[0].name : "");
}

export function isAtlasPlayerIdentityUiControlCandidate(candidate: AtlasPlayerIdentityCandidate): boolean {
  if (isAtlasPlayerIdentityUiControlValue(candidate.name)) {
    return true;
  }
  if (isReliableAtlasPlayerIdentityCandidate(candidate)) {
    return false;
  }
  const source = (candidate.source ?? "").trim().toLowerCase();
  const compact = normalizeAtlasPlayerIdentityName(candidate.name).replace(/[^a-z0-9]+/g, "");
  return compact === "start" ||
    compact === "starts" ||
    ((source === "aria-label" || source === "title") && /^[a-z]$/i.test(candidate.name.trim()));
}

export function isAtlasPlayerIdentityUiControlValue(value: string): boolean {
  const compact = normalizeAtlasPlayerIdentityName(value).replace(/[^a-z0-9]+/g, "");
  if (!compact) {
    return false;
  }
  return isStructurallyImpossibleAtlasPlayerIdentity(value) ||
    compact === "lookat" ||
    compact === "lookatmore" ||
    compact === "rewind" ||
    compact === "rewindthelastaction" ||
    compact === "undoyourlastrewind" ||
    compact === "nextgame";
}

export function isReliableAtlasPlayerIdentityCandidate(candidate: AtlasPlayerIdentityCandidate): boolean {
  return atlasPlayerIdentitySourceRank(candidate.source ?? "") >= 40;
}

export function normalizeAtlasPlayerIdentityName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isStructurallyImpossibleAtlasPlayerIdentity(value: string): boolean {
  const compact = normalizeAtlasPlayerIdentityName(value).replace(/[^a-z0-9]+/g, "");
  return compact.startsWith("hidepopoverdeckpeek") ||
    compact.startsWith("hidepopovertrashcard");
}

function finiteScore(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finitePosition(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}
