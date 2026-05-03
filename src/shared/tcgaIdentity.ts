export function readTcgaProfileName(value: unknown): string {
  return readProfileName(value, 0);
}

export function readTcgaLocalPlayerName(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["preferences", "profile", "user", "account", "player", "localPlayer", "currentUser"]) {
    const match = readProfileName(record[key], 1);
    if (match) {
      return match;
    }
  }
  for (const key of ["pseudo", "username", "userName", "displayName", "playerName"]) {
    const match = readString(record[key]);
    if (match) {
      return match;
    }
  }
  const name = readString(record.name);
  return name && !looksLikeTcgaCatalogEntry(record) ? name : "";
}

function readProfileName(value: unknown, depth: number): string {
  if (depth > 8 || !value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;

  for (const key of ["preferences", "profile", "user", "account", "player", "localPlayer", "currentUser"]) {
    const match = readProfileName(record[key], depth + 1);
    if (match) {
      return match;
    }
  }

  for (const key of ["pseudo", "username", "userName", "displayName", "playerName"]) {
    const match = readString(record[key]);
    if (match) {
      return match;
    }
  }

  const name = readString(record.name);
  if (name && !looksLikeTcgaCatalogEntry(record)) {
    return name;
  }

  for (const [key, nested] of Object.entries(record)) {
    if (["games", "decks", "cards", "collection"].includes(key)) {
      continue;
    }
    const match = readProfileName(nested, depth + 1);
    if (match) {
      return match;
    }
  }
  return "";
}

function looksLikeTcgaCatalogEntry(record: Record<string, unknown>): boolean {
  return Boolean(
    readString(record.name) &&
      (readString(record.url) || readString(record.image) || readString(record.code) || readString(record.uuid))
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
